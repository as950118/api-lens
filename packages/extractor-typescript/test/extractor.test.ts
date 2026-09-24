import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FrontendManifest, PropertyAccessInfo } from "@apilens/core";
import { extractTypeScriptManifest, loadConfig } from "../src/index.js";

const fixtures = fileURLToPath(new URL("../../../test/fixtures/", import.meta.url));

function accessesAt(m: FrontendManifest, file: string, line: number): PropertyAccessInfo[] {
  return m.propertyAccesses.filter((a) => a.file === file && a.location.line === line);
}

function callAt(m: FrontendManifest, file: string, line: number) {
  const call = m.apiCalls.find((c) => c.file === file && c.location.line === line);
  if (!call) throw new Error(`no api call at ${file}:${line}`);
  return call;
}

describe("extractTypeScriptManifest (fixture frontend)", () => {
  let manifest: FrontendManifest;

  beforeAll(() => {
    manifest = extractTypeScriptManifest(
      join(fixtures, "frontend"),
      loadConfig(join(fixtures, "apilens.config.json")),
    );
  });

  it("collects files with imports and exports", () => {
    const page = manifest.files.find((f) => f.path === "src/pages/User.tsx");
    expect(page?.exports).toEqual(expect.arrayContaining(["UserPage", "loadProfile"]));
    expect(page?.imports).toContainEqual(
      expect.objectContaining({ source: "../api/user", specifiers: ["getUser", "userApi"] }),
    );
  });

  it("collects functions and marks React components", () => {
    const userPage = manifest.functions.find((f) => f.name === "UserPage");
    expect(userPage).toMatchObject({
      file: "src/pages/User.tsx",
      containingComponent: "UserPage",
      params: [{ name: "{ id }", type: "{ id: number }" }],
    });
    expect(manifest.functions.find((f) => f.name === "getUser")).toMatchObject({
      returnType: "Promise<UserResponse>",
      containingComponent: null,
      calls: ["axios.get"],
    });
  });

  describe("API calls", () => {
    it("resolves axios calls with template literal and string concatenation URLs", () => {
      expect(callAt(manifest, "src/api/user.ts", 6)).toMatchObject({
        method: "GET",
        endpointPattern: "/users/{param}",
        resolution: "direct",
      });
      expect(callAt(manifest, "src/api/user.ts", 11)).toMatchObject({
        method: "GET",
        endpointPattern: "/users/{param}",
        code: 'axios.get<UserResponse>("/users/" + id)',
      });
    });

    it("resolves axios.create() instances imported from another module", () => {
      expect(callAt(manifest, "src/api/user.ts", 12)).toMatchObject({
        method: "PUT",
        endpointPattern: "/users/{param}",
        calleeExpression: "api.put",
      });
    });

    it("resolves fetch with and without an explicit method", () => {
      expect(callAt(manifest, "src/api/user.ts", 16)).toMatchObject({
        method: "GET",
        endpointPattern: "/users",
      });
      expect(callAt(manifest, "src/api/user.ts", 21)).toMatchObject({
        method: "DELETE",
        endpointPattern: "/users/{param}",
      });
    });

    it("infers wrapper functions and API client objects without configuration", () => {
      expect(callAt(manifest, "src/pages/User.tsx", 26)).toMatchObject({
        calleeExpression: "getUser",
        resolution: "wrapper",
        method: "GET",
        endpointPattern: "/users/{param}",
      });
      expect(callAt(manifest, "src/pages/User.tsx", 27)).toMatchObject({
        calleeExpression: "userApi.getUser",
        resolution: "wrapper",
        endpointPattern: "/users/{param}",
      });
    });

    it("uses apiClientMap for clients whose endpoint cannot be inferred", () => {
      expect(callAt(manifest, "src/pages/Product.tsx", 4)).toMatchObject({
        calleeExpression: "productApi.getProduct",
        resolution: "config",
        method: "GET",
        endpointPattern: "/products/{param}",
      });
    });

    it("records the calling function", () => {
      const call = callAt(manifest, "src/pages/User.tsx", 26);
      const caller = manifest.functions.find((f) => f.id === call.callerFunctionId);
      expect(caller?.name).toBe("loadProfile");
    });
  });

  describe("property accesses", () => {
    it("tracks user.name in JSX through useState + .then(setUser)", () => {
      const call = callAt(manifest, "src/pages/User.tsx", 11);
      expect(accessesAt(manifest, "src/pages/User.tsx", 18)).toEqual([
        expect.objectContaining({
          apiCallId: call.id,
          object: "user",
          path: ["name"],
          flow: "direct",
          code: "user.name",
          containingComponent: "UserPage",
        }),
      ]);
    });

    it("tracks destructuring: const { name } = await getUser(id)", () => {
      expect(accessesAt(manifest, "src/pages/User.tsx", 26)).toEqual([
        expect.objectContaining({ path: ["name"], flow: "direct" }),
      ]);
    });

    it("tracks optional chaining and nested paths: user?.profile.email", () => {
      expect(accessesAt(manifest, "src/pages/User.tsx", 28)).toEqual([
        expect.objectContaining({ path: ["profile", "email"], code: "user?.profile.email" }),
      ]);
    });

    it("marks values passed through unknown functions as derived", () => {
      expect(accessesAt(manifest, "src/pages/User.tsx", 30)).toEqual([
        expect.objectContaining({ object: "value", path: ["name"], flow: "derived" }),
      ]);
    });

    it("follows values passed as JSX props into child components", () => {
      const call = callAt(manifest, "src/pages/User.tsx", 11);
      expect(accessesAt(manifest, "src/components/UserCard.tsx", 4)).toEqual([
        expect.objectContaining({
          apiCallId: call.id,
          path: ["name"],
          containingComponent: "UserCard",
        }),
      ]);
    });

    it("tracks array elements of list responses via useQuery + .map", () => {
      const paths = accessesAt(manifest, "src/pages/UserList.tsx", 9).map((a) => a.path);
      expect(paths).toEqual([
        ["[]", "name"],
        ["[]", "age"],
      ]);
    });

    it("links every access to an indexed API call", () => {
      const ids = new Set(manifest.apiCalls.map((c) => c.id));
      expect(manifest.propertyAccesses.every((a) => ids.has(a.apiCallId))).toBe(true);
    });
  });
});

describe("extractTypeScriptManifest (edge cases)", () => {
  let dir: string;

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), "apilens-ts-"));
  });

  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  function extract(files: Record<string, string>): FrontendManifest {
    const root = mkdtempSync(join(dir, "case-"));
    for (const [name, content] of Object.entries(files)) {
      writeFileSync(join(root, name), content);
    }
    return extractTypeScriptManifest(root);
  }

  it("works without a tsconfig.json", () => {
    const m = extract({
      "a.ts": `import axios from "axios";
export async function load() {
  const { data } = await axios.get("/orders");
  return data.total;
}`,
    });
    expect(m.apiCalls).toHaveLength(1);
    expect(m.propertyAccesses.map((a) => a.path)).toEqual([["total"]]);
  });

  it("does not link a shadowed variable with the same name", () => {
    const m = extract({
      "a.ts": `import axios from "axios";
export async function withApi() {
  const res = await axios.get("/users/1");
  return res.data.name;
}
export function withoutApi(res: { data: { name: string } }) {
  return res.data.name;
}`,
    });
    expect(m.propertyAccesses).toHaveLength(1);
    expect(m.propertyAccesses[0].location.line).toBe(4);
  });

  it("does not guess an endpoint for a fully dynamic URL", () => {
    const m = extract({
      "a.ts": `import axios from "axios";
export function load(url: string) { return axios.get(url); }`,
    });
    expect(m.apiCalls).toEqual([expect.objectContaining({ endpointPattern: null, method: "GET" })]);
  });

  it("substitutes a wrapper's URL parameter at the call site", () => {
    const m = extract({
      "a.ts": `import axios from "axios";
function request(url: string) { return axios.get(url).then((r) => r.data); }
export async function load(id: number) {
  const order = await request(\`/orders/\${id}\`);
  return order.total;
}`,
    });
    const wrapperCall = m.apiCalls.find((c) => c.resolution === "wrapper");
    expect(wrapperCall).toMatchObject({ endpointPattern: "/orders/{param}", method: "GET" });
    expect(m.propertyAccesses).toEqual([
      expect.objectContaining({ apiCallId: wrapperCall!.id, path: ["total"] }),
    ]);
  });

  it("ignores method calls on accessed fields", () => {
    const m = extract({
      "a.ts": `import axios from "axios";
export async function load() {
  const { data } = await axios.get("/users/1");
  return data.name.toUpperCase();
}`,
    });
    expect(m.propertyAccesses.map((a) => a.path)).toEqual([["name"]]);
  });
});
