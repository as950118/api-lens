import { Node, SyntaxKind } from "ts-morph";

export const PARAM_PLACEHOLDER = "{param}";

/**
 * Normalizes a path so frontend and backend patterns can be compared:
 * "{id}", ":id" and template substitutions all become "{param}", query
 * strings are dropped, and duplicate/trailing slashes are removed.
 */
export function normalizePath(path: string): string {
  const withoutQuery = path.split("?")[0];
  const normalized = withoutQuery
    .replace(/\{[^}/]*\}/g, PARAM_PLACEHOLDER)
    .replace(/:[A-Za-z_][A-Za-z0-9_]*/g, PARAM_PLACEHOLDER)
    .replace(/\/{2,}/g, "/");
  return normalized.length > 1 ? normalized.replace(/\/$/, "") : normalized;
}

/**
 * Statically resolves the URL argument of an API call into a path pattern.
 * Returns null when the URL is fully dynamic (e.g. a bare variable), because
 * guessing would produce false links in the index.
 */
export function resolveEndpointExpression(expr: Node): string | null {
  const raw = resolveRaw(expr);
  if (raw === null || !raw.includes("/")) return null;
  return normalizePath(stripOrigin(raw));
}

function resolveRaw(expr: Node): string | null {
  if (Node.isStringLiteral(expr) || Node.isNoSubstitutionTemplateLiteral(expr)) {
    return expr.getLiteralValue();
  }
  if (Node.isTemplateExpression(expr)) {
    let out = expr.getHead().getLiteralText();
    for (const span of expr.getTemplateSpans()) {
      out += PARAM_PLACEHOLDER + span.getLiteral().getLiteralText();
    }
    return out;
  }
  if (Node.isBinaryExpression(expr) && expr.getOperatorToken().getKind() === SyntaxKind.PlusToken) {
    const left = resolveRaw(expr.getLeft());
    const right = resolveRaw(expr.getRight());
    if (left === null && right === null) return null;
    return (left ?? PARAM_PLACEHOLDER) + (right ?? PARAM_PLACEHOLDER);
  }
  if (Node.isParenthesizedExpression(expr)) {
    return resolveRaw(expr.getExpression());
  }
  return null;
}

function stripOrigin(url: string): string {
  const match = url.match(/^[a-z]+:\/\/[^/]+(\/.*)?$/i);
  if (match) return match[1] ?? "/";
  return url.startsWith("/") ? url : `/${url}`;
}
