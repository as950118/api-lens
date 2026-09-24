export const PARAM_PLACEHOLDER = "{param}";

/**
 * Normalizes a path so frontend and backend patterns can be compared:
 * "{id}", "{id:\\d+}", ":id" and template substitutions all become "{param}",
 * query strings are dropped, and duplicate/trailing slashes are removed.
 */
export function normalizePath(path: string): string {
  const withoutQuery = path.split("?")[0];
  const normalized = withoutQuery
    .replace(/\{[^}/]*\}/g, PARAM_PLACEHOLDER)
    .replace(/:[A-Za-z_][A-Za-z0-9_]*/g, PARAM_PLACEHOLDER)
    .replace(/\/{2,}/g, "/");
  const withSlash = normalized.startsWith("/") ? normalized : `/${normalized}`;
  return withSlash.length > 1 ? withSlash.replace(/\/$/, "") : withSlash;
}

export function joinPath(base: string | undefined, path: string): string {
  if (!base) return path;
  return normalizePath(`${base}/${path}`);
}

/** Display form of a body-relative access path: ["content", "[]", "name"] -> "content[].name". */
export function formatAccessPath(path: string[]): string {
  return path.reduce((out, segment) => (segment === "[]" ? `${out}[]` : out ? `${out}.${segment}` : segment), "");
}
