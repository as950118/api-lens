import type { GraphNode, ImpactGraph } from "../analysis/graph.js";

/** Renders an impact graph as a Mermaid flowchart (for PR comments, docs, MCP clients). */
export function renderMermaid(graph: ImpactGraph): string {
  const ids = new Map<string, string>();
  graph.nodes.forEach((n, i) => ids.set(n.id, `n${i}`));
  const lines = ["flowchart LR"];
  for (const node of graph.nodes) lines.push(`  ${ids.get(node.id)}${shape(node)}`);
  for (const edge of graph.edges) {
    const arrow = edge.kind === "reads" ? "-.->" : "-->";
    lines.push(`  ${ids.get(edge.from)} ${arrow} ${ids.get(edge.to)}`);
  }
  lines.push(
    "  classDef endpoint fill:#e8f0fe,stroke:#3b6fd8,color:#0b2a66",
    "  classDef broken fill:#fde8e8,stroke:#d33a3a,color:#6b1111",
    "  classDef unresolved fill:#fff4e0,stroke:#d68a00,color:#5c3a00",
    "  classDef unused fill:#f1f1f1,stroke:#9a9a9a,color:#555",
    "  classDef field fill:#f3ecfd,stroke:#8a5cd8,color:#34166b",
    "  classDef component fill:#e6f6ee,stroke:#2e9a62,color:#0f3d26",
    "  classDef file fill:#fafafa,stroke:#777,color:#333",
  );
  const byClass = new Map<string, string[]>();
  for (const node of graph.nodes) {
    const cls = className(node);
    if (cls) (byClass.get(cls) ?? byClass.set(cls, []).get(cls)!).push(ids.get(node.id)!);
  }
  for (const [cls, members] of byClass) lines.push(`  class ${members.join(",")} ${cls}`);
  return lines.join("\n");
}

function shape(node: GraphNode): string {
  const label = `"${escape(node.label)}${node.kind === "endpoint" || node.kind === "file" ? impactSuffix(node) : ""}"`;
  switch (node.kind) {
    case "endpoint":
      return `[[${label}]]`;
    case "field":
      return `>${label}]`;
    case "function":
      return `(${label})`;
    case "component":
      return `([${label}])`;
    case "file":
      return `[/${label}/]`;
  }
}

function impactSuffix(node: GraphNode): string {
  if (node.impact === 0) return "";
  return node.kind === "endpoint" ? ` · ${node.impact} file${node.impact > 1 ? "s" : ""}` : ` · ${node.impact} API${node.impact > 1 ? "s" : ""}`;
}

function className(node: GraphNode): string | null {
  if (node.kind === "endpoint") {
    if (node.status === "not-found" || node.status === "method-mismatch") return "broken";
    if (node.status === "unresolved") return "unresolved";
    if (node.status === "unused") return "unused";
    return "endpoint";
  }
  return node.kind === "function" ? null : node.kind;
}

function escape(text: string): string {
  return text.replace(/"/g, "#quot;").replace(/</g, "#lt;").replace(/>/g, "#gt;");
}

export type GraphAttachment = "none" | "mermaid" | "json";

/** Replaces an impact result's `graph` with Mermaid text, keeps it, or drops it (for compact JSON output). */
export function attachGraph<T extends { graph: ImpactGraph }>(
  value: T,
  mode: GraphAttachment,
): Omit<T, "graph"> & { graph?: ImpactGraph; mermaid?: string } {
  const { graph, ...rest } = value;
  if (mode === "json") return { ...rest, graph };
  if (mode === "mermaid") return { ...rest, mermaid: renderMermaid(graph) };
  return rest;
}
