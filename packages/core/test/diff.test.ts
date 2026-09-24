import { describe, expect, it } from "vitest";
import { analyzeChangeImpact } from "../src/analysis/change-impact.js";
import { diffBackends } from "../src/analysis/diff.js";
import type { BackendManifest, EnumInfo } from "../src/ir/types.js";
import { renderChangeReportMarkdown } from "../src/report/markdown.js";
import { access, backend, call, dto, endpoint, fn, frontend, t } from "./builders.js";

function withEnum(manifest: BackendManifest, values: string[]): BackendManifest {
  const status: EnumInfo = { id: "Status", name: "Status", values, location: { file: "Status.java", line: 1, column: 1 } };
  return { ...manifest, enums: [status] };
}

const USER_V1 = dto("User", {
  name: t.scalar("String"),
  age: [t.scalar("int"), false],
  score: [t.scalar("Integer"), false],
  status: t.enumRef("Status"),
  tags: t.array(t.scalar("String")),
  profile: [t.dto("Profile"), false],
});
const USER_V2 = dto("User", {
  username: t.scalar("String"),
  age: [t.scalar("String"), false],
  score: [t.scalar("Long"), false],
  status: t.enumRef("Status"),
  tags: t.scalar("String"),
  profile: [t.dto("Profile"), true],
});
const PROFILE = dto("Profile", { email: [t.scalar("String"), false] });
const CREATE_V1 = dto("Create", { name: [t.scalar("String"), false], nick: t.scalar("String") });
const CREATE_V2 = dto("Create", { name: [t.scalar("String"), false], password: [t.scalar("String"), false] });
const ENVELOPE = dto("Envelope", { data: t.param("T") }, ["T"]);

function v1(): BackendManifest {
  return withEnum(
    backend(
      [
        endpoint("GET", "/users/{id}", t.dto("User")),
        endpoint("GET", "/users", t.dto("Envelope", t.array(t.dto("User"))), {
          requestParams: [{ name: "q", type: t.scalar("String"), required: false, source: "query" }],
        }),
        endpoint("POST", "/users", t.dto("User"), { requestBody: { type: t.dto("Create"), required: true } }),
        endpoint("PUT", "/users/{id}", null, { handler: "UserController#update" }),
        endpoint("DELETE", "/users/{id}", null),
      ],
      [USER_V1, PROFILE, CREATE_V1, ENVELOPE],
    ),
    ["A", "B"],
  );
}

function v2(): BackendManifest {
  return withEnum(
    backend(
      [
        endpoint("GET", "/users/{id}", t.dto("User")),
        endpoint("GET", "/users", t.dto("Envelope", t.array(t.dto("User"))), {
          requestParams: [
            { name: "q", type: t.scalar("String"), required: true, source: "query" },
            { name: "tenant", type: t.scalar("String"), required: true, source: "query" },
          ],
        }),
        endpoint("POST", "/users", t.dto("User"), { requestBody: { type: t.dto("Create"), required: true } }),
        endpoint("PUT", "/users/{id}/profile", null, { handler: "UserController#update" }),
        endpoint("GET", "/health", null),
      ],
      [USER_V2, PROFILE, CREATE_V2, ENVELOPE],
    ),
    ["A", "C"],
  );
}

describe("diffBackends", () => {
  const diff = diffBackends(v1(), v2());
  const changes = (id: string) => diff.endpoints.find((e) => e.endpointId === id)!.changes;
  const kinds = (id: string) => changes(id).map((c) => `${c.kind} ${c.path.join(".")}${c.breaking ? " !" : ""}`);

  it("classifies endpoints as added, removed, moved or changed", () => {
    expect(diff.endpoints.map((e) => `${e.endpointId} ${e.status}${e.movedTo ? ` → ${e.movedTo}` : ""}`)).toEqual([
      "DELETE /users/{id} removed",
      "GET /health added",
      "GET /users changed",
      "GET /users/{id} changed",
      "POST /users changed",
      "PUT /users/{id} changed → PUT /users/{id}/profile",
    ]);
    expect(diff.counts).toMatchObject({ added: 1, removed: 1, changed: 4 });
  });

  it("describes response changes as body-relative paths", () => {
    expect(kinds("GET /users/{id}")).toEqual([
      "field-removed name !",
      "field-type-changed age !",
      "field-type-changed score",
      "enum-value-removed status !",
      "enum-value-added status",
      "shape-changed tags !",
      "field-nullable-changed profile !",
      "field-added username",
    ]);
  });

  it("follows generics and arrays", () => {
    expect(kinds("GET /users")).toContain("field-removed data.[].name !");
  });

  it("treats same-JSON-type changes as non-breaking", () => {
    const score = changes("GET /users/{id}").find((c) => c.path[0] === "score")!;
    expect(score).toMatchObject({ before: "Integer", after: "Long", breaking: false });
  });

  it("compares request params and bodies from the caller's point of view", () => {
    expect(kinds("GET /users")).toEqual(
      expect.arrayContaining(["param-required-changed q !", "param-added tenant !"]),
    );
    expect(kinds("POST /users")).toEqual(expect.arrayContaining(["field-removed nick", "field-added password !"]));
  });
});

describe("analyzeChangeImpact", () => {
  const fe = frontend(
    [
      call("c:get", "GET", "/users/{param}", { file: "src/User.tsx", callerFunctionId: "UserPage" }),
      call("c:list", "GET", "/users", { file: "src/List.tsx", request: { queryKeys: ["q"], bodyKeys: [] } }),
      call("c:create", "POST", "/users", { file: "src/Form.tsx", request: { queryKeys: [], bodyKeys: ["name"] } }),
      call("c:update", "PUT", "/users/{param}", { file: "src/api.ts" }),
      call("c:update-via", "PUT", "/users/{param}", { file: "src/Edit.tsx", resolution: "wrapper", wrapperFunctionId: "updateUser" }),
      call("c:delete", "DELETE", "/users/{param}", { file: "src/api.ts" }),
    ],
    [
      access("a:name", "c:get", ["name"], { file: "src/User.tsx", containingComponent: "UserPage", containingFunctionId: "UserPage" }),
      access("a:derived", "c:get", ["name"], { file: "src/User.tsx", flow: "derived" }),
      access("a:age", "c:get", ["age"], { file: "src/User.tsx" }),
      access("a:score", "c:get", ["score"], { file: "src/User.tsx" }),
      access("a:tags", "c:get", ["tags", "[]"], { file: "src/User.tsx" }),
      access("a:email", "c:get", ["profile", "email"], { file: "src/Card.tsx" }),
      access("a:status", "c:get", ["status"], { file: "src/User.tsx" }),
      access("a:list-name", "c:list", ["data", "[]", "name"], { file: "src/List.tsx" }),
    ],
    [fn("UserPage", "src/User.tsx", "UserPage"), fn("updateUser", "src/api.ts")],
  );
  const report = analyzeChangeImpact(fe, v1(), v2());
  const sites = (id: string) =>
    report.endpoints.find((e) => e.endpointId === id)!.sites.map((s) => `${s.confidence} ${s.accessId ?? s.apiCallId}`);

  it("grades every affected read and call", () => {
    expect(sites("GET /users/{id}")).toEqual([
      "DEFINITE a:name",
      "DEFINITE a:tags",
      "LIKELY a:email",
      "LIKELY a:age",
      "POSSIBLE a:derived",
      "POSSIBLE a:status",
    ]);
    expect(sites("GET /users")).toEqual(["DEFINITE c:list", "DEFINITE a:list-name"]);
    expect(sites("POST /users")).toEqual(["DEFINITE c:create"]);
    expect(sites("DELETE /users/{id}")).toEqual(["DEFINITE c:delete"]);
    expect(sites("PUT /users/{id}")).toEqual(["DEFINITE c:update", "POSSIBLE c:update-via"]);
  });

  it("does not flag non-breaking changes", () => {
    const all = report.endpoints.flatMap((e) => e.sites.map((s) => s.accessId));
    expect(all).not.toContain("a:score");
  });

  it("merges several changes at one location into one site with every reason", () => {
    const list = report.endpoints.find((e) => e.endpointId === "GET /users")!.sites[0];
    expect(list.reason).toContain("`tenant`");
  });

  it("summarizes the result like the spec's report", () => {
    expect(report.result).toBe("FAIL");
    expect(report.counts).toMatchObject({ changedApis: 6, DEFINITE: 7, LIKELY: 2, POSSIBLE: 3 });
    expect(report.endpoints.find((e) => e.endpointId === "GET /health")!.result).toBe("PASS");
  });

  it("renders Markdown for PR comments", () => {
    const md = renderChangeReportMarkdown(report);
    expect(md).toContain("## ApiLens: backend API change report: FAIL");
    expect(md).toContain("| `PUT /users/{id}` | moved → `PUT /users/{id}/profile` |");
    expect(md).toContain("| DEFINITE | `src/User.tsx:20` UserPage | `x.name` |");
  });

  it("passes when the frontend does not use what changed", () => {
    const unrelated = frontend([call("c", "GET", "/health", { file: "src/a.ts" })]);
    expect(analyzeChangeImpact(unrelated, v1(), v2()).result).toBe("PASS");
  });
});
