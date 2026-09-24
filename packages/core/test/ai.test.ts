import { describe, expect, it } from "vitest";
import { analyzeChangeImpact } from "../src/analysis/change-impact.js";
import { buildVerificationPrompt } from "../src/ai/prompt.js";
import { renderJsonShape } from "../src/ai/schema-render.js";
import type { AiProvider, AiVerificationRequest, AiVerificationResponse } from "../src/ai/types.js";
import { evidenceIsInSnippets, verifyChangeReport } from "../src/ai/verify.js";
import type { BackendManifest } from "../src/ir/types.js";
import { renderChangeReportMarkdown } from "../src/report/markdown.js";
import { access, backend, call, dto, endpoint, frontend, t } from "./builders.js";

const SOURCE: Record<string, string> = {
  "src/User.tsx": [
    "import { getUser } from './api';",
    "export async function show(id) {",
    "  const user = await getUser(id);",
    "  const label = `${user.age}`;",
    "  const years = user.age + 1;",
    "  return user.name;",
    "}",
  ].join("\n"),
};

function manifests(): { before: BackendManifest; after: BackendManifest } {
  const before = backend(
    [endpoint("GET", "/users/{id}", t.dto("User")), endpoint("GET", "/other", t.dto("Other"))],
    [
      dto("User", { name: t.scalar("String"), age: [t.scalar("int"), false], status: t.enumRef("Status") }),
      dto("Other", { x: t.scalar("String") }),
    ],
  );
  const after = backend(
    [endpoint("GET", "/users/{id}", t.dto("User")), endpoint("GET", "/other", t.dto("Other"))],
    [
      dto("User", { username: t.scalar("String"), age: [t.scalar("String"), false], status: t.enumRef("Status") }),
      dto("Other", { x: t.scalar("String") }),
    ],
  );
  return { before, after };
}

const fe = frontend(
  [
    call("c:user", "GET", "/users/{param}", { file: "src/User.tsx", location: { file: "src/User.tsx", line: 3, column: 22 } }),
    call("c:other", "GET", "/other", { file: "src/Other.tsx" }),
  ],
  [
    access("a:label", "c:user", ["age"], { file: "src/User.tsx", location: { file: "src/User.tsx", line: 4, column: 20 }, code: "user.age" }),
    access("a:years", "c:user", ["age"], { file: "src/User.tsx", location: { file: "src/User.tsx", line: 5, column: 17 }, code: "user.age" }),
    access("a:name", "c:user", ["name"], { file: "src/User.tsx", location: { file: "src/User.tsx", line: 6, column: 10 }, code: "user.name" }),
    access("a:x", "c:other", ["x"], { file: "src/Other.tsx", location: { file: "src/Other.tsx", line: 2, column: 1 }, code: "o.x" }),
  ],
);

class FakeProvider implements AiProvider {
  readonly name = "fake";
  readonly model = "fake-model";
  readonly requests: AiVerificationRequest[] = [];
  constructor(private readonly answer: (r: AiVerificationRequest) => AiVerificationResponse | Error) {}
  async verify(request: AiVerificationRequest): Promise<AiVerificationResponse> {
    this.requests.push(request);
    const result = this.answer(request);
    if (result instanceof Error) throw result;
    return result;
  }
}

async function run(provider: FakeProvider) {
  const { before, after } = manifests();
  const report = analyzeChangeImpact(fe, before, after);
  return verifyChangeReport(report, { frontend: fe, before, after }, provider, {
    readFile: (path) => SOURCE[path] ?? null,
    contextLines: 2,
  });
}

describe("renderJsonShape", () => {
  it("renders the JSON the frontend receives, with nullability and enum values", () => {
    const { before } = manifests();
    const lookup = { dtos: new Map(before.dtos.map((d) => [d.id, d])), enums: new Map(before.enums.map((e) => [e.id, e])) };
    expect(renderJsonShape(t.array(t.dto("User")), lookup)).toBe(
      '{\n  name: string | null;\n  age: number;\n  status: "A" | null;\n}[]',
    );
    expect(renderJsonShape(null, lookup)).toBe("(no response body)");
  });
});

describe("buildVerificationPrompt", () => {
  it("contains only the endpoint, schemas, candidates and numbered snippets", async () => {
    const provider = new FakeProvider(() => ({ model: "m", verdicts: [] }));
    await run(provider);
    const request = provider.requests.find((r) => r.endpointId === "GET /users/{id}")!;
    const { system, user } = buildVerificationPrompt(request);
    expect(system).toContain("must cite evidence");
    expect(user).toContain("<endpoint>GET /users/{id}");
    expect(user).toContain("age: string;");
    expect(user).toMatch(/4 \| {3}const label = `\$\{user\.age\}`;/);
    expect(request.candidates.map((c) => c.line)).toEqual([4, 5]); // the DEFINITE read (line 6) is not a candidate
    expect(provider.requests).toHaveLength(1); // unchanged endpoints are never sent
  });
});

describe("verifyChangeReport", () => {
  it("never sends DEFINITE findings and keeps them failing", async () => {
    const provider = new FakeProvider((r) => ({
      model: "m",
      verdicts: r.candidates.map((c) => ({ id: c.id, result: "PASS", confidence: 0.9, reason: "fine", evidence: [{ file: c.file, line: c.line, code: c.code }] })),
    }));
    const report = await run(provider);
    const sent = provider.requests.flatMap((r) => r.candidates.map((c) => `${c.file}:${c.line}`));
    expect(sent).not.toContain("src/User.tsx:6");
    const user = report.endpoints.find((e) => e.endpointId === "GET /users/{id}")!;
    expect(user.result).toBe("FAIL");
    expect(user.sites.find((s) => s.line === 6)!.ai).toBeNull();
  });

  it("lets the AI clear or confirm undecided findings, with evidence from the provided code", async () => {
    const provider = new FakeProvider((r) => ({
      model: "claude-test",
      verdicts: r.candidates.map((c) =>
        c.line === 4
          ? { id: c.id, result: "PASS", confidence: 0.8, reason: "Only interpolated into a string.", evidence: [{ file: c.file, line: 4, code: "`${user.age}`" }] }
          : { id: c.id, result: "FAIL", confidence: 0.95, reason: "String + 1 concatenates.", evidence: [{ file: c.file, line: 5, code: "user.age + 1" }] },
      ),
    }));
    const report = await run(provider);
    const sites = report.endpoints.find((e) => e.endpointId === "GET /users/{id}")!.sites;
    expect(sites.find((s) => s.line === 4)!.ai).toMatchObject({ result: "PASS", confidence: 0.8 });
    expect(sites.find((s) => s.line === 5)!.ai).toMatchObject({ result: "FAIL", evidence: [{ line: 5 }] });
    expect(report.ai).toMatchObject({ model: "claude-test", verified: 2, discarded: 0, counts: { PASS: 1, FAIL: 1, WARNING: 0, UNKNOWN: 0 } });
  });

  it("downgrades verdicts whose evidence is not in the provided code", async () => {
    const provider = new FakeProvider((r) => ({
      model: "m",
      verdicts: r.candidates.map((c) => ({ id: c.id, result: "FAIL", confidence: 1, reason: "made up", evidence: [{ file: c.file, line: c.line, code: "user.age.toFixed(2)" }] })),
    }));
    const report = await run(provider);
    const site = report.endpoints.find((e) => e.endpointId === "GET /users/{id}")!.sites.find((s) => s.line === 4)!;
    expect(site.ai).toMatchObject({ result: "UNKNOWN", evidence: [] });
    expect(site.ai!.reason).toContain("discarded");
    expect(report.ai.discarded).toBe(2);
  });

  it("marks missing verdicts UNKNOWN and turns an all-PASS endpoint green", async () => {
    const provider = new FakeProvider(() => ({ model: "m", verdicts: [] }));
    const report = await run(provider);
    expect(report.endpoints.find((e) => e.endpointId === "GET /users/{id}")!.sites.find((s) => s.line === 4)!.ai!.result).toBe("UNKNOWN");
  });

  it("records provider errors without losing the static result", async () => {
    const provider = new FakeProvider(() => new Error("rate limited"));
    const report = await run(provider);
    expect(report.ai.errors).toEqual(["GET /users/{id}: rate limited"]);
    expect(report.result).toBe("FAIL");
    expect(report.staticResult).toBe("FAIL");
  });

  it("renders AI verdicts in Markdown", async () => {
    const provider = new FakeProvider((r) => ({
      model: "claude-test",
      verdicts: r.candidates.map((c) => ({ id: c.id, result: "PASS", confidence: 0.7, reason: "ok", evidence: [{ file: c.file, line: c.line, code: c.code }] })),
    }));
    const md = renderChangeReportMarkdown(await run(provider));
    expect(md).toContain("AI verification (fake, `claude-test`)");
    expect(md).toContain("| Confidence | AI | Location | Code | Why |");
    expect(md).toContain("| LIKELY | PASS (0.70) |");
  });
});

describe("evidenceIsInSnippets", () => {
  const snippets = [{ file: "a.ts", startLine: 10, lines: ["const a = user.age;", "return a  +  1;"] }];
  it.each([
    [{ file: "a.ts", line: 11, code: "a + 1" }, true],
    [{ file: "a.ts", line: 10, code: "a + 1" }, true],
    [{ file: "a.ts", line: 30, code: "a + 1" }, false],
    [{ file: "b.ts", line: 10, code: "user.age" }, false],
    [{ file: "a.ts", line: 10, code: "user.name" }, false],
    [{ file: "a.ts", line: 10, code: " " }, false],
  ])("%j -> %s", (evidence, expected) => {
    expect(evidenceIsInSnippets(evidence, snippets)).toBe(expected);
  });
});
