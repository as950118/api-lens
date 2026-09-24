import type { DtoInfo, EnumInfo, TypeRef } from "../ir/types.js";

export interface TypeLookup {
  dtos: Map<string, DtoInfo>;
  enums: Map<string, EnumInfo>;
}

export type PathCheck =
  | { status: "ok"; type: TypeRef }
  | {
      status: "missing";
      /** Index of the segment that does not exist. */
      at: number;
      reason: "no-such-field" | "not-an-array" | "not-an-object";
      parentType: string;
      available: string[];
    }
  | { status: "unverifiable"; at: number; typeName: string };

type Bindings = Map<string, TypeRef>;

const STRING_LIKE = new Set(["String", "CharSequence", "char", "Character"]);

/**
 * Walks a body-relative access path (as recorded by frontend extractors, "[]"
 * = array element) through a backend response type.
 */
export function checkPath(root: TypeRef, path: string[], lookup: TypeLookup): PathCheck {
  let current = root;
  let bindings: Bindings = new Map();

  for (let i = 0; i < path.length; i++) {
    const segment = path[i];
    const type = resolve(current, bindings);

    switch (type.kind) {
      case "dto": {
        const dto = lookup.dtos.get(type.dtoId);
        if (!dto) return { status: "unverifiable", at: i, typeName: type.dtoId };
        if (segment === "[]") {
          return missing(i, "not-an-array", type, lookup, dto.fields.map((f) => f.name));
        }
        const field = dto.fields.find((f) => f.name === segment);
        if (!field) return missing(i, "no-such-field", type, lookup, dto.fields.map((f) => f.name));
        bindings = bindTypeParameters(dto, type.typeArguments, bindings);
        current = field.type;
        break;
      }
      case "array":
        if (segment === "[]") {
          current = type.element;
        } else if (segment === "length") {
          return { status: "ok", type: { kind: "scalar", name: "int" } };
        } else {
          return missing(i, "not-an-object", type, lookup, []);
        }
        break;
      case "map":
        if (segment === "[]") return missing(i, "not-an-array", type, lookup, []);
        current = type.value;
        break;
      case "scalar":
      case "enum": {
        const stringLike = type.kind === "enum" || STRING_LIKE.has(type.name);
        if (segment === "length" && stringLike) return { status: "ok", type: { kind: "scalar", name: "int" } };
        return missing(i, segment === "[]" ? "not-an-array" : "not-an-object", type, lookup, []);
      }
      case "typeParameter":
      case "unknown":
        return { status: "unverifiable", at: i, typeName: type.name };
    }
  }
  return { status: "ok", type: resolve(current, bindings) };
}

function resolve(type: TypeRef, bindings: Bindings): TypeRef {
  return type.kind === "typeParameter" ? bindings.get(type.name) ?? type : type;
}

function bindTypeParameters(dto: DtoInfo, args: TypeRef[], outer: Bindings): Bindings {
  const bindings: Bindings = new Map();
  dto.typeParameters.forEach((name, i) => {
    if (args[i]) bindings.set(name, resolve(args[i], outer));
  });
  return bindings;
}

function missing(
  at: number,
  reason: "no-such-field" | "not-an-array" | "not-an-object",
  type: TypeRef,
  lookup: TypeLookup,
  available: string[],
): PathCheck {
  return { status: "missing", at, reason, parentType: describeType(type, lookup), available };
}

/** Human readable form of a TypeRef, e.g. "ApiResponse<UserResponse>", "UserResponse[]". */
export function describeType(type: TypeRef, lookup?: TypeLookup): string {
  switch (type.kind) {
    case "dto": {
      const name = lookup?.dtos.get(type.dtoId)?.name ?? type.dtoId.split(".").pop()!;
      const args = type.typeArguments.map((t) => describeType(t, lookup));
      return args.length ? `${name}<${args.join(", ")}>` : name;
    }
    case "enum":
      return lookup?.enums.get(type.enumId)?.name ?? type.enumId.split(".").pop()!;
    case "array":
      return `${describeType(type.element, lookup)}[]`;
    case "map":
      return `Map<string, ${describeType(type.value, lookup)}>`;
    default:
      return type.name;
  }
}

/**
 * All body-relative paths at which `targetDtoId` appears inside `root`
 * (following generics and arrays), e.g. ["data"] for ApiResponse<UserResponse>.
 */
export function pathsToDto(root: TypeRef, targetDtoId: string, lookup: TypeLookup): string[][] {
  const results: string[][] = [];
  const walk = (type: TypeRef, bindings: Bindings, path: string[], visiting: Set<string>): void => {
    const t = resolve(type, bindings);
    if (t.kind === "array") return walk(t.element, bindings, [...path, "[]"], visiting);
    if (t.kind === "map") return;
    if (t.kind !== "dto") return;
    if (t.dtoId === targetDtoId) results.push(path);
    if (visiting.has(t.dtoId)) return;
    const dto = lookup.dtos.get(t.dtoId);
    if (!dto) return;
    const inner = bindTypeParameters(dto, t.typeArguments, bindings);
    const next = new Set(visiting).add(t.dtoId);
    for (const field of dto.fields) walk(field.type, inner, [...path, field.name], next);
  };
  walk(root, new Map(), [], new Set());
  return results;
}
