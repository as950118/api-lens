import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { IndexStore } from "@apilens/core";
import { DEFAULT_JAR_PATH } from "@apilens/extractor-java";
import { runExtractBackendCommand } from "../src/commands/extract-backend-command.js";
import { runIndexCommand } from "../src/commands/index-command.js";

const repoRoot = fileURLToPath(new URL("../../../", import.meta.url));
const fixtures = join(repoRoot, "test/fixtures");

describe("apilens index", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "apilens-cli-"));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("builds a queryable index from a frontend project", async () => {
    const dbPath = join(dir, "nested/index.db");
    const { summary } = await runIndexCommand(join(fixtures, "frontend"), {
      config: join(fixtures, "apilens.config.json"),
      out: dbPath,
    });
    expect(summary.files).toBe(8);
    expect(summary.apiCalls).toBe(summary.resolvedApiCalls);

    const store = IndexStore.open(dbPath);
    try {
      const calls = store.findApiCallsByEndpoint("GET", "/users/{param}");
      const getUserCall = calls.find(
        (c) => c.file === "src/pages/User.tsx" && c.location.line === 11,
      );
      expect(getUserCall).toBeDefined();

      const accesses = store.findPropertyAccessesForApiCall(getUserCall!.id);
      expect(accesses.map((a) => `${a.file}:${a.location.line} ${a.path.join(".")}`)).toEqual([
        "src/components/UserCard.tsx:4 name",
        "src/pages/User.tsx:18 name",
        "src/pages/User.tsx:19 age",
      ]);
      expect(store.findApiCallsByEndpoint("GET", "/products/{param}")).toHaveLength(1);
      expect(store.getMeta("language")).toBe("typescript");
    } finally {
      store.close();
    }
  });

  it("writes the manifest JSON when requested", async () => {
    const manifestPath = join(dir, "manifest.json");
    await runIndexCommand(join(fixtures, "frontend"), {
      config: join(fixtures, "apilens.config.json"),
      out: join(dir, "index.db"),
      manifest: manifestPath,
    });
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
    expect(manifest.language).toBe("typescript");
    expect(manifest.propertyAccesses.length).toBeGreaterThan(0);
  });

  it("rejects a missing frontend directory", async () => {
    await expect(
      runIndexCommand(join(dir, "does-not-exist"), { out: join(dir, "index.db") }),
    ).rejects.toThrow("Frontend directory not found");
  });

  it.skipIf(!existsSync(join(repoRoot, "packages/cli/dist/bin.js")))(
    "runs as a CLI binary",
    () => {
      const out = execFileSync(
        process.execPath,
        [
          join(repoRoot, "packages/cli/dist/bin.js"),
          "index",
          join(fixtures, "frontend"),
          "--config",
          join(fixtures, "apilens.config.json"),
          "--out",
          join(dir, "index.db"),
        ],
        { encoding: "utf8" },
      );
      expect(out).toContain("ApiLens index written to");
      expect(out).toMatch(/API calls:\s+10 \(10 with resolved endpoint\)/);
    },
  );
});

describe("apilens extract-backend", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "apilens-cli-backend-"));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it.skipIf(!existsSync(DEFAULT_JAR_PATH))("writes the backend manifest", async () => {
    const out = join(dir, "backend.json");
    const manifest = await runExtractBackendCommand(join(fixtures, "backend"), { out });
    expect(manifest.endpoints).toHaveLength(10);
    expect(JSON.parse(readFileSync(out, "utf8")).endpoints).toHaveLength(10);
  });

  it("rejects a missing backend directory", async () => {
    await expect(
      runExtractBackendCommand(join(dir, "missing"), { out: join(dir, "b.json") }),
    ).rejects.toThrow("Backend directory not found");
  });
});
