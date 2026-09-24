import { execFileSync, spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DEFAULT_JAR_PATH } from "@apilens/extractor-java";
import { ApiLensWorkspace } from "../src/workspace.js";

const repoRoot = fileURLToPath(new URL("../../../", import.meta.url));
const fixtures = join(repoRoot, "test/fixtures");
const bin = join(repoRoot, "packages/cli/dist/bin.js");
const hasJar = existsSync(DEFAULT_JAR_PATH);

let dir: string;
beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "apilens-cli-"));
});
afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

function copyFrontend(name: string): string {
  const target = join(dir, name);
  cpSync(join(fixtures, "frontend"), target, { recursive: true });
  cpSync(join(fixtures, "apilens.config.json"), join(target, "apilens.config.json"));
  return target;
}

describe("ApiLensWorkspace.indexFrontend", () => {
  it("builds the index and reports every file on the first run", async () => {
    const ws = new ApiLensWorkspace(join(dir, "full.db"));
    const result = await ws.indexFrontend(join(fixtures, "frontend"), {
      configPath: join(fixtures, "apilens.config.json"),
    });
    expect(result.summary).toMatchObject({ files: 9, apiCalls: 15, resolvedApiCalls: 15 });
    expect(result.changedFiles).toHaveLength(9);
    expect(result.scope).toBeNull();
  });

  it("rewrites only the changed file and lists the APIs it uses", async () => {
    const frontend = copyFrontend("incremental");
    const ws = new ApiLensWorkspace(join(dir, "incremental.db"));
    await ws.indexFrontend(frontend);

    const card = join(frontend, "src/components/UserCard.tsx");
    writeFileSync(card, readFileSync(card, "utf8").replace("user.name", "user.username"));
    const result = await ws.indexFrontend(frontend, { files: [card] });
    expect(result.scope).toEqual(["src/components/UserCard.tsx"]);
    expect(result.changedFiles).toEqual(["src/components/UserCard.tsx"]);
    expect(result.apis.map((a) => a.apiKey)).toEqual(["GET /users/{param}"]);
  });

  it("rejects a missing frontend directory", async () => {
    await expect(new ApiLensWorkspace(join(dir, "x.db")).indexFrontend(join(dir, "missing"))).rejects.toThrow(
      "Frontend directory not found",
    );
  });

  it("explains how to recover when the index is empty", () => {
    expect(() => new ApiLensWorkspace(join(dir, "empty.db")).model()).toThrow("Run `apilens index");
  });
});

describe.skipIf(!hasJar)("with the backend contract", () => {
  let ws: ApiLensWorkspace;

  beforeAll(async () => {
    ws = new ApiLensWorkspace(join(dir, "contract.db"));
    await ws.indexFrontend(join(fixtures, "frontend"), { configPath: join(fixtures, "apilens.config.json") });
    await ws.extractBackend(join(fixtures, "backend"));
  });

  it("finds every planted contract violation and nothing else", () => {
    const report = ws.check();
    expect(report.result).toBe("FAIL");
    expect(report.issues.map((i) => `${i.code} ${i.file}:${i.line}`)).toEqual([
      "ENDPOINT_NOT_FOUND src/pages/UserAdmin.tsx:5",
      "METHOD_MISMATCH src/pages/UserAdmin.tsx:10",
      "FIELD_NOT_FOUND src/pages/UserAdmin.tsx:19",
      "FIELD_NOT_FOUND src/pages/UserAdmin.tsx:24",
      "NOT_AN_OBJECT src/pages/UserAdmin.tsx:24",
      "UNKNOWN_BODY_FIELD src/pages/UserAdmin.tsx:14",
      "UNKNOWN_QUERY_PARAM src/pages/UserAdmin.tsx:18",
    ]);
  });

  it("passes for files that use the API correctly", () => {
    const report = ws.check({ files: ["src/pages/User.tsx", "src/components/UserCard.tsx"] });
    expect(report.result).toBe("PASS");
    expect(report.apis.map((a) => a.apiKey)).toEqual(["GET /users/{id}"]);
  });

  it("answers impact questions from the index", () => {
    const analyzer = ws.impact();
    expect(analyzer.impactOfApi("GET /users/{id}")[0].files).toEqual([
      "src/api/user.ts",
      "src/components/UserCard.tsx",
      "src/pages/User.tsx",
      "src/pages/UserAdmin.tsx",
    ]);
    expect(analyzer.impactOfFile("src/api/user.ts").blastRadius.files).toHaveLength(5);
    expect(analyzer.summary().unusedEndpoints).toEqual([
      "DELETE /admin/users/{id}/sessions",
      "GET /users/summary",
      "PATCH /users/{id}/status",
    ]);
  });
});

describe.skipIf(!hasJar || !existsSync(bin))("apilens CLI", () => {
  const run = (...args: string[]) =>
    spawnSync(process.execPath, [bin, "-i", join(dir, "cli.db"), ...args], { encoding: "utf8" });

  beforeAll(() => {
    expect(run("index", join(fixtures, "frontend"), "-c", join(fixtures, "apilens.config.json")).status).toBe(0);
    expect(run("extract-backend", join(fixtures, "backend")).status).toBe(0);
  });

  it("exits 1 when the contract check fails and 0 with --fail-on never", () => {
    const failing = run("check");
    expect(failing.status).toBe(1);
    expect(failing.stdout).toContain("ApiLens contract check: FAIL");
    expect(failing.stdout).toContain("Did you mean `name`?");
    expect(run("check", "--fail-on", "never").status).toBe(0);
  });

  it("prints JSON for machine consumers", () => {
    const report = JSON.parse(run("check", "--format", "json", "--files", "src/pages/Product.tsx").stdout);
    expect(report).toMatchObject({ result: "PASS", scope: ["src/pages/Product.tsx"] });
  });

  it("renders impact as text, Mermaid and HTML", () => {
    expect(run("impact", "--api", "GET /users/{id}").stdout).toContain("Affects 4 files");
    expect(run("impact", "--field", "UserResponse.name", "-f", "mermaid").stdout).toMatch(/^flowchart LR/);
    const html = join(dir, "graph.html");
    expect(run("graph", "-o", html).status).toBe(0);
    expect(readFileSync(html, "utf8")).toContain("<title>ApiLens impact graph</title>");
  });

  it("checks only the files changed since a git ref", () => {
    const frontend = copyFrontend("git");
    const git = (...args: string[]) => execFileSync("git", ["-C", frontend, ...args], { encoding: "utf8" });
    git("init", "-q");
    git("add", "-A");
    git("-c", "user.email=t@example.com", "-c", "user.name=t", "commit", "-qm", "base");
    const product = join(frontend, "src/pages/Product.tsx");
    writeFileSync(product, readFileSync(product, "utf8").replace("product.price", "product.cost"));

    const index = spawnSync(process.execPath, [bin, "-i", join(dir, "git.db"), "index", frontend], { encoding: "utf8" });
    expect(index.status).toBe(0);
    spawnSync(process.execPath, [bin, "-i", join(dir, "git.db"), "extract-backend", join(fixtures, "backend")]);
    const check = spawnSync(
      process.execPath,
      [bin, "-i", join(dir, "git.db"), "index", frontend, "--changed-since", "HEAD", "--check"],
      { encoding: "utf8" },
    );
    expect(check.status).toBe(1);
    expect(check.stdout).toContain("src/pages/Product.tsx");
    expect(check.stdout).toContain("ProductResponse has no field `cost`");
    expect(check.stdout).toContain("scope: 1 file");
  });
});
