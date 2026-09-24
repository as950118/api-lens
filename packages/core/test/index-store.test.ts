import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { IndexStore } from "../src/index-store/index-store.js";
import type { FrontendManifest } from "../src/ir/types.js";

function buildManifest(): FrontendManifest {
  return {
    language: "typescript",
    rootDir: "/frontend",
    generatedAt: new Date().toISOString(),
    files: [
      { path: "src/pages/User.tsx", imports: [], exports: ["UserPage"] },
    ],
    functions: [
      {
        id: "fn:User.tsx:UserPage",
        name: "UserPage",
        file: "src/pages/User.tsx",
        params: [],
        returnType: "JSX.Element",
        calls: ["getUser"],
        location: { file: "src/pages/User.tsx", line: 5, column: 1 },
        containingComponent: "UserPage",
      },
    ],
    apiCalls: [
      {
        id: "call:User.tsx:12",
        endpointPattern: "/users/{param}",
        method: "GET",
        calleeExpression: "userApi.getUser",
        resolution: "wrapper",
        callerFunctionId: "fn:User.tsx:UserPage",
        file: "src/pages/User.tsx",
        location: { file: "src/pages/User.tsx", line: 12, column: 20 },
        arguments: ["id"],
        returnVarType: "UserResponse",
        code: "userApi.getUser(id)",
      },
    ],
    propertyAccesses: [
      {
        id: "prop:User.tsx:42",
        apiCallId: "call:User.tsx:12",
        object: "user",
        path: ["name"],
        flow: "direct",
        file: "src/pages/User.tsx",
        location: { file: "src/pages/User.tsx", line: 42, column: 15 },
        containingFunctionId: "fn:User.tsx:UserPage",
        containingComponent: "UserPage",
        code: "user.name",
      },
    ],
  };
}

describe("IndexStore", () => {
  let dir: string;
  let dbPath: string;
  let store: IndexStore;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "apilens-index-store-"));
    dbPath = join(dir, "index.db");
    store = IndexStore.open(dbPath);
  });

  afterEach(() => {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it("writes a manifest and reports an accurate summary", () => {
    const summary = store.writeManifest(buildManifest());
    expect(summary).toEqual({
      files: 1,
      functions: 1,
      apiCalls: 1,
      resolvedApiCalls: 1,
      propertyAccesses: 1,
    });
  });

  it("finds api calls by normalized endpoint + method", () => {
    store.writeManifest(buildManifest());
    const calls = store.findApiCallsByEndpoint("GET", "/users/{param}");
    expect(calls).toHaveLength(1);
    expect(calls[0].calleeExpression).toBe("userApi.getUser");
    expect(calls[0].file).toBe("src/pages/User.tsx");
    expect(calls[0].location.line).toBe(12);
  });

  it("finds property accesses linked to an api call", () => {
    store.writeManifest(buildManifest());
    const accesses = store.findPropertyAccessesForApiCall("call:User.tsx:12");
    expect(accesses).toHaveLength(1);
    expect(accesses[0].object).toBe("user");
    expect(accesses[0].path).toEqual(["name"]);
  });

  it("clears previous data on re-index", () => {
    store.writeManifest(buildManifest());
    const empty: FrontendManifest = {
      language: "typescript",
      rootDir: "/frontend",
      generatedAt: new Date().toISOString(),
      files: [],
      functions: [],
      apiCalls: [],
      propertyAccesses: [],
    };
    const summary = store.writeManifest(empty);
    expect(summary.files).toBe(0);
    expect(store.listFiles()).toHaveLength(0);
  });

  it("persists meta information about the index", () => {
    store.writeManifest(buildManifest());
    expect(store.getMeta("language")).toBe("typescript");
    expect(store.getMeta("rootDir")).toBe("/frontend");
    expect(store.getMeta("schemaVersion")).toBe("1");
  });
});
