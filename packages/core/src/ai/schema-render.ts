import type { TypeLookup } from "../analysis/type-path.js";
import type { TypeRef } from "../ir/types.js";

const NUMBERS = new Set([
  "int", "long", "short", "byte", "float", "double", "Integer", "Long", "Short", "Byte", "Float", "Double",
  "BigDecimal", "BigInteger", "Number", "AtomicInteger", "AtomicLong",
]);

/**
 * Renders a response type as the JSON shape the frontend receives, in
 * TypeScript syntax (what a frontend-focused reader, human or model, expects):
 * `{ name: string; profile: { email: string | null } }`.
 */
export function renderJsonShape(type: TypeRef | null, lookup: TypeLookup, maxDepth = 5): string {
  if (type === null) return "(no response body)";
  return render(type, lookup, new Map(), 0, maxDepth, new Set());
}

function render(
  type: TypeRef,
  lookup: TypeLookup,
  bindings: Map<string, TypeRef>,
  depth: number,
  maxDepth: number,
  visiting: Set<string>,
): string {
  const t = type.kind === "typeParameter" ? bindings.get(type.name) ?? type : type;
  switch (t.kind) {
    case "scalar":
      if (NUMBERS.has(t.name)) return "number";
      if (t.name === "boolean" || t.name === "Boolean") return "boolean";
      return "string";
    case "enum": {
      const values = lookup.enums.get(t.enumId)?.values;
      return values?.length ? values.map((v) => JSON.stringify(v)).join(" | ") : "string";
    }
    case "array": {
      const element = render(t.element, lookup, bindings, depth, maxDepth, visiting);
      return element.includes(" ") && !element.startsWith("{") ? `(${element})[]` : `${element}[]`;
    }
    case "map":
      return `Record<string, ${render(t.value, lookup, bindings, depth, maxDepth, visiting)}>`;
    case "dto": {
      const dto = lookup.dtos.get(t.dtoId);
      if (!dto) return "unknown";
      if (depth >= maxDepth || visiting.has(t.dtoId)) return `${dto.name} /* … */`;
      const inner = new Map<string, TypeRef>();
      dto.typeParameters.forEach((name, i) => {
        const arg = t.typeArguments[i];
        if (arg) inner.set(name, arg.kind === "typeParameter" ? bindings.get(arg.name) ?? arg : arg);
      });
      const next = new Set(visiting).add(t.dtoId);
      const indent = "  ".repeat(depth + 1);
      const fields = dto.fields.map((f) => {
        const value = render(f.type, lookup, inner, depth + 1, maxDepth, next);
        return `${indent}${f.name}: ${value}${f.nullable ? " | null" : ""};`;
      });
      return fields.length ? `{\n${fields.join("\n")}\n${"  ".repeat(depth)}}` : "{}";
    }
    default:
      return "unknown";
  }
}
