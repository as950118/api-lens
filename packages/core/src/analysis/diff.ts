import type { BackendManifest, DtoInfo, EndpointInfo, EnumInfo, ParamInfo, TypeRef } from "../ir/types.js";
import { formatAccessPath } from "../path.js";
import { describeType, type TypeLookup } from "./type-path.js";

export type ChangeKind =
  | "endpoint-added"
  | "endpoint-removed"
  | "endpoint-moved"
  | "param-added"
  | "param-removed"
  | "param-type-changed"
  | "param-required-changed"
  | "body-added"
  | "body-removed"
  | "response-added"
  | "response-removed"
  | "field-added"
  | "field-removed"
  | "field-type-changed"
  | "field-nullable-changed"
  | "shape-changed"
  | "enum-value-added"
  | "enum-value-removed";

export interface ApiChange {
  kind: ChangeKind;
  /** The endpoint as the frontend knew it (before the change). */
  endpointId: string;
  where: "endpoint" | "param" | "request" | "response";
  /** Body-relative path for request/response changes ("[]" array element, "*" map value); param name for params. */
  path: string[];
  before: string | null;
  after: string | null;
  /** Can this break existing frontend code? */
  breaking: boolean;
  message: string;
}

export interface EndpointDiff {
  endpointId: string;
  status: "added" | "removed" | "changed";
  /** For moved endpoints: the new id. */
  movedTo: string | null;
  handler: string;
  changes: ApiChange[];
}

export interface BackendDiff {
  endpoints: EndpointDiff[];
  counts: { added: number; removed: number; changed: number; breaking: number };
}

type Side = TypeLookup;
type Bindings = Map<string, TypeRef>;
type Direction = "request" | "response";

const MAX_DEPTH = 16;

/** Structural diff of two backend contracts, expressed in the same body-relative paths the frontend index uses. */
export function diffBackends(before: BackendManifest, after: BackendManifest): BackendDiff {
  const b = lookupOf(before);
  const a = lookupOf(after);
  const beforeById = new Map(before.endpoints.map((e) => [e.id, e]));
  const afterById = new Map(after.endpoints.map((e) => [e.id, e]));
  const diffs: EndpointDiff[] = [];

  const removed = before.endpoints.filter((e) => !afterById.has(e.id));
  const added = after.endpoints.filter((e) => !beforeById.has(e.id));
  const addedByHandler = new Map(added.map((e) => [`${e.method} ${e.handler}`, e]));
  const moved = new Set<string>();

  for (const old of removed) {
    const target = addedByHandler.get(`${old.method} ${old.handler}`);
    if (target) {
      moved.add(target.id);
      const changes: ApiChange[] = [
        change("endpoint-moved", old.id, "endpoint", [], old.path, target.path, true, `Moved to ${target.id}`),
        ...diffEndpoint(old, target, b, a),
      ];
      diffs.push({ endpointId: old.id, status: "changed", movedTo: target.id, handler: old.handler, changes });
    } else {
      diffs.push({
        endpointId: old.id,
        status: "removed",
        movedTo: null,
        handler: old.handler,
        changes: [change("endpoint-removed", old.id, "endpoint", [], old.id, null, true, `${old.id} was removed`)],
      });
    }
  }
  for (const endpoint of added.filter((e) => !moved.has(e.id))) {
    diffs.push({
      endpointId: endpoint.id,
      status: "added",
      movedTo: null,
      handler: endpoint.handler,
      changes: [change("endpoint-added", endpoint.id, "endpoint", [], null, endpoint.id, false, `${endpoint.id} was added`)],
    });
  }
  for (const old of before.endpoints) {
    const current = afterById.get(old.id);
    if (!current) continue;
    const changes = diffEndpoint(old, current, b, a);
    if (changes.length) {
      diffs.push({ endpointId: old.id, status: "changed", movedTo: null, handler: old.handler, changes });
    }
  }

  diffs.sort((x, y) => x.endpointId.localeCompare(y.endpointId));
  const all = diffs.flatMap((d) => d.changes);
  return {
    endpoints: diffs,
    counts: {
      added: diffs.filter((d) => d.status === "added").length,
      removed: diffs.filter((d) => d.status === "removed").length,
      changed: diffs.filter((d) => d.status === "changed").length,
      breaking: all.filter((c) => c.breaking).length,
    },
  };
}

function diffEndpoint(before: EndpointInfo, after: EndpointInfo, b: Side, a: Side): ApiChange[] {
  const id = before.id;
  const changes: ApiChange[] = [];

  const key = (p: ParamInfo) => `${p.source}:${p.name}`;
  const afterParams = new Map(after.requestParams.map((p) => [key(p), p]));
  const beforeParams = new Map(before.requestParams.map((p) => [key(p), p]));
  for (const p of before.requestParams) {
    const next = afterParams.get(key(p));
    const label = `${p.source} parameter \`${p.name}\``;
    if (!next) {
      changes.push(change("param-removed", id, "param", [p.name], describeType(p.type, b), null, false, `${label} was removed`));
      continue;
    }
    if (describeType(p.type, b) !== describeType(next.type, a)) {
      const breaking = category(p.type, b) !== category(next.type, a);
      changes.push(change("param-type-changed", id, "param", [p.name], describeType(p.type, b), describeType(next.type, a), breaking,
        `${label} type changed: ${describeType(p.type, b)} → ${describeType(next.type, a)}`));
    }
    if (!p.required && next.required) {
      changes.push(change("param-required-changed", id, "param", [p.name], "optional", "required", true, `${label} is now required`));
    }
  }
  for (const p of after.requestParams) {
    if (beforeParams.has(key(p))) continue;
    changes.push(change("param-added", id, "param", [p.name], null, describeType(p.type, a), p.required,
      `${p.required ? "Required" : "Optional"} ${p.source} parameter \`${p.name}\` was added`));
  }

  if (before.requestBody && !after.requestBody) {
    changes.push(change("body-removed", id, "request", [], describeType(before.requestBody.type, b), null, false, "Request body is no longer read"));
  } else if (!before.requestBody && after.requestBody) {
    changes.push(change("body-added", id, "request", [], null, describeType(after.requestBody.type, a), after.requestBody.required,
      `Request body ${describeType(after.requestBody.type, a)} was added${after.requestBody.required ? " (required)" : ""}`));
  } else if (before.requestBody && after.requestBody) {
    compareType(before.requestBody.type, after.requestBody.type, [], "request", id, b, a, new Map(), new Map(), new Set(), changes);
  }

  if (before.response && !after.response) {
    changes.push(change("response-removed", id, "response", [], describeType(before.response, b), null, true, "Response body was removed"));
  } else if (!before.response && after.response) {
    changes.push(change("response-added", id, "response", [], null, describeType(after.response, a), false, "Response body was added"));
  } else if (before.response && after.response) {
    compareType(before.response, after.response, [], "response", id, b, a, new Map(), new Map(), new Set(), changes);
  }
  return changes;
}

function compareType(
  before: TypeRef,
  after: TypeRef,
  path: string[],
  direction: Direction,
  id: string,
  b: Side,
  a: Side,
  bBindings: Bindings,
  aBindings: Bindings,
  visiting: Set<string>,
  out: ApiChange[],
): void {
  if (path.length > MAX_DEPTH) return;
  const x = resolve(before, bBindings);
  const y = resolve(after, aBindings);
  const where = direction;
  const at = path.length ? `\`${formatAccessPath(path)}\`` : "body";
  const bDesc = describeType(x, b);
  const aDesc = describeType(y, a);

  const xArray = x.kind === "array";
  const yArray = y.kind === "array";
  if (xArray !== yArray) {
    out.push(change("shape-changed", id, where, path, bDesc, aDesc, true,
      `${cap(direction)} ${at} changed from ${xArray ? "an array" : "an object/value"} to ${yArray ? "an array" : "an object/value"} (${bDesc} → ${aDesc})`));
    return;
  }
  if (x.kind === "array" && y.kind === "array") {
    compareType(x.element, y.element, [...path, "[]"], direction, id, b, a, bBindings, aBindings, visiting, out);
    return;
  }
  if (x.kind === "map" && y.kind === "map") {
    compareType(x.value, y.value, [...path, "*"], direction, id, b, a, bBindings, aBindings, visiting, out);
    return;
  }
  if (x.kind === "dto" && y.kind === "dto") {
    const pair = `${x.dtoId}|${y.dtoId}|${path.join(".")}`;
    const recursion = `${x.dtoId}|${y.dtoId}`;
    if (visiting.has(recursion) || visiting.has(pair)) return;
    const bd = b.dtos.get(x.dtoId);
    const ad = a.dtos.get(y.dtoId);
    if (!bd || !ad) return;
    compareFields(bd, ad, bind(bd, x.typeArguments, bBindings), bind(ad, y.typeArguments, aBindings), path, direction, id, b, a,
      new Set(visiting).add(recursion), out);
    return;
  }
  if (x.kind === "enum" && y.kind === "enum") {
    compareEnums(b.enums.get(x.enumId), a.enums.get(y.enumId), path, direction, id, out);
    return;
  }
  if (bDesc !== aDesc) {
    const breaking = category(x, b) !== category(y, a);
    out.push(change("field-type-changed", id, where, path, bDesc, aDesc, breaking,
      `${cap(direction)} ${at} type changed: ${bDesc} → ${aDesc}${breaking ? "" : " (same JSON type)"}`));
  }
}

function compareFields(
  before: DtoInfo,
  after: DtoInfo,
  bBindings: Bindings,
  aBindings: Bindings,
  path: string[],
  direction: Direction,
  id: string,
  b: Side,
  a: Side,
  visiting: Set<string>,
  out: ApiChange[],
): void {
  const afterFields = new Map(after.fields.map((f) => [f.name, f]));
  const beforeNames = new Set(before.fields.map((f) => f.name));
  for (const field of before.fields) {
    const fieldPath = [...path, field.name];
    const at = `\`${formatAccessPath(fieldPath)}\``;
    const next = afterFields.get(field.name);
    if (!next) {
      // Extra request fields are ignored by Spring's default Jackson setup; missing response fields break readers.
      out.push(change("field-removed", id, direction, fieldPath, describeType(resolve(field.type, bBindings), b), null,
        direction === "response", `${cap(direction)} field ${at} was removed`));
      continue;
    }
    if (field.nullable !== next.nullable) {
      const breaking = direction === "response" ? next.nullable : !next.nullable;
      out.push(change("field-nullable-changed", id, direction, fieldPath, field.nullable ? "nullable" : "non-null",
        next.nullable ? "nullable" : "non-null", breaking,
        direction === "response"
          ? `Response field ${at} ${next.nullable ? "may now be null" : "is now never null"}`
          : `Request field ${at} ${next.nullable ? "is now optional" : "is now required"}`));
    }
    compareType(field.type, next.type, fieldPath, direction, id, b, a, bBindings, aBindings, visiting, out);
  }
  for (const field of after.fields) {
    if (beforeNames.has(field.name)) continue;
    const fieldPath = [...path, field.name];
    const required = direction === "request" && !field.nullable;
    out.push(change("field-added", id, direction, fieldPath, null, describeType(resolve(field.type, aBindings), a), required,
      `${cap(direction)} field \`${formatAccessPath(fieldPath)}\` was added${required ? " (required)" : ""}`));
  }
}

function compareEnums(
  before: EnumInfo | undefined,
  after: EnumInfo | undefined,
  path: string[],
  direction: Direction,
  id: string,
  out: ApiChange[],
): void {
  if (!before || !after) return;
  const at = path.length ? `\`${formatAccessPath(path)}\`` : "body";
  for (const value of before.values.filter((v) => !after.values.includes(v))) {
    out.push(change("enum-value-removed", id, direction, path, value, null, true,
      `${before.name} value "${value}" (${direction} ${at}) was removed`));
  }
  for (const value of after.values.filter((v) => !before.values.includes(v))) {
    out.push(change("enum-value-added", id, direction, path, null, value, false,
      `${after.name} value "${value}" (${direction} ${at}) was added`));
  }
}

/** JSON-level category: changing within one (Integer → Long) does not change what the frontend receives. */
function category(type: TypeRef, side: Side): string {
  switch (type.kind) {
    case "scalar":
      return scalarCategory(type.name);
    case "enum":
      return "string";
    case "dto":
      return side.dtos.has(type.dtoId) ? "object" : `unknown:${type.dtoId}`;
    case "array":
      return "array";
    case "map":
      return "object";
    default:
      return `unknown:${type.name}`;
  }
}

const NUMBERS = new Set([
  "int", "long", "short", "byte", "float", "double", "Integer", "Long", "Short", "Byte", "Float", "Double",
  "BigDecimal", "BigInteger", "Number", "AtomicInteger", "AtomicLong",
]);

function scalarCategory(name: string): string {
  if (NUMBERS.has(name)) return "number";
  if (name === "boolean" || name === "Boolean") return "boolean";
  // Strings, chars, UUIDs, and java.time types (ISO strings with Spring Boot's defaults).
  return "string";
}

function resolve(type: TypeRef, bindings: Bindings): TypeRef {
  return type.kind === "typeParameter" ? bindings.get(type.name) ?? type : type;
}

function bind(dto: DtoInfo, args: TypeRef[], outer: Bindings): Bindings {
  const bindings: Bindings = new Map();
  dto.typeParameters.forEach((name, i) => {
    if (args[i]) bindings.set(name, resolve(args[i], outer));
  });
  return bindings;
}

function lookupOf(manifest: BackendManifest): Side {
  return {
    dtos: new Map(manifest.dtos.map((d) => [d.id, d])),
    enums: new Map(manifest.enums.map((e) => [e.id, e])),
  };
}

function change(
  kind: ChangeKind,
  endpointId: string,
  where: ApiChange["where"],
  path: string[],
  before: string | null,
  after: string | null,
  breaking: boolean,
  message: string,
): ApiChange {
  return { kind, endpointId, where, path, before, after, breaking, message };
}

function cap(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}
