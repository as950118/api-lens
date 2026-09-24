import type { ApiCallInfo, EndpointInfo, PropertyAccessInfo } from "../ir/types.js";
import type { LinkStatus } from "./link.js";
import { formatAccessPath } from "../path.js";
import type { ProjectModel } from "./model.js";

export type GraphNodeKind = "endpoint" | "field" | "function" | "component" | "file";

export interface GraphNode {
  id: string;
  kind: GraphNodeKind;
  label: string;
  detail: string | null;
  /** endpoint nodes: link status, or "unused" for backend endpoints no frontend code calls. */
  status: LinkStatus | "unused" | null;
  file: string | null;
  line: number | null;
  /** endpoint/field nodes: files reached downstream. function/file nodes: endpoints reaching them. */
  impact: number;
}

export type GraphEdgeKind = "calls" | "has-field" | "reads" | "defined-in";

export interface GraphEdge {
  from: string;
  to: string;
  kind: GraphEdgeKind;
}

export interface ImpactGraph {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

export interface GraphSelection {
  calls: Iterable<ApiCallInfo>;
  accesses: Iterable<PropertyAccessInfo>;
  unusedEndpoints?: Iterable<EndpointInfo>;
}

/**
 * Builds the API → function → component → file graph for a set of calls and
 * field reads:
 *
 *   endpoint ──calls──▶ api client fn ──calls──▶ caller fn/component ──defined-in──▶ file
 *   endpoint ──has-field──▶ field ──reads──▶ reading fn/component ──defined-in──▶ file
 */
export function buildGraph(model: ProjectModel, selection: GraphSelection): ImpactGraph {
  const nodes = new Map<string, GraphNode>();
  const edges = new Map<string, GraphEdge>();

  const node = (n: Omit<GraphNode, "impact">): string => {
    if (!nodes.has(n.id)) nodes.set(n.id, { ...n, impact: 0 });
    return n.id;
  };
  const edge = (from: string, to: string, kind: GraphEdgeKind): void => {
    if (from !== to) edges.set(`${from}->${to}`, { from, to, kind });
  };
  const fileNode = (path: string): string =>
    node({ id: `file:${path}`, kind: "file", label: path, detail: null, status: null, file: path, line: null });
  const functionNode = (id: string | null, fallbackFile: string): string => {
    const fn = id ? model.functions.get(id) : undefined;
    if (!fn) return fileNode(fallbackFile);
    const isComponent = fn.containingComponent === fn.name;
    const nodeId = node({
      id: fn.id,
      kind: isComponent ? "component" : "function",
      label: fn.name === "<anonymous>" && fn.containingComponent ? `${fn.containingComponent} (callback)` : fn.name,
      detail: `${fn.file}:${fn.location.line}`,
      status: null,
      file: fn.file,
      line: fn.location.line,
    });
    edge(nodeId, fileNode(fn.file), "defined-in");
    return nodeId;
  };
  const endpointNode = (call: ApiCallInfo): string => {
    const key = model.apiKeyOf(call);
    const link = model.link(call.id);
    const endpoint = link?.endpointId ? model.endpoints.get(link.endpointId) : undefined;
    return node({
      id: `api:${key}`,
      kind: "endpoint",
      label: key,
      detail: endpoint?.handler ?? null,
      status: link?.status ?? null,
      file: endpoint?.location.file ?? null,
      line: endpoint?.location.line ?? null,
    });
  };

  for (const call of selection.calls) {
    const api = endpointNode(call);
    const target = functionNode(call.callerFunctionId, call.file);
    const wrapper = call.wrapperFunctionId ? model.functions.get(call.wrapperFunctionId) : undefined;
    if (wrapper) {
      const wrapperNode = functionNode(wrapper.id, wrapper.file);
      edge(api, wrapperNode, "calls");
      edge(wrapperNode, target, "calls");
    } else {
      edge(api, target, "calls");
    }
  }

  for (const access of selection.accesses) {
    const call = model.apiCalls.get(access.apiCallId);
    if (!call) continue;
    const api = endpointNode(call);
    const path = formatAccessPath(access.path);
    const field = node({
      id: `field:${model.apiKeyOf(call)}#${path}`,
      kind: "field",
      label: path,
      detail: model.apiKeyOf(call),
      status: null,
      file: null,
      line: null,
    });
    edge(api, field, "has-field");
    edge(field, functionNode(access.containingFunctionId, access.file), "reads");
  }

  for (const endpoint of selection.unusedEndpoints ?? []) {
    node({
      id: `api:${endpoint.id}`,
      kind: "endpoint",
      label: endpoint.id,
      detail: endpoint.handler,
      status: "unused",
      file: endpoint.location.file,
      line: endpoint.location.line,
    });
  }

  computeImpact(nodes, [...edges.values()]);
  return { nodes: [...nodes.values()], edges: [...edges.values()] };
}

/** Union of several graphs (e.g. the impact of every endpoint matching a query). */
export function mergeGraphs(graphs: ImpactGraph[]): ImpactGraph {
  const nodes = new Map(graphs.flatMap((g) => g.nodes).map((n) => [n.id, n]));
  const edges = new Map(graphs.flatMap((g) => g.edges).map((e) => [`${e.from}->${e.to}`, e]));
  return { nodes: [...nodes.values()], edges: [...edges.values()] };
}

function computeImpact(nodes: Map<string, GraphNode>, edges: GraphEdge[]): void {
  const out = new Map<string, string[]>();
  const into = new Map<string, string[]>();
  for (const e of edges) {
    (out.get(e.from) ?? out.set(e.from, []).get(e.from)!).push(e.to);
    (into.get(e.to) ?? into.set(e.to, []).get(e.to)!).push(e.from);
  }
  const reach = (start: string, adjacency: Map<string, string[]>): Set<string> => {
    const seen = new Set<string>([start]);
    const queue = [start];
    while (queue.length) {
      for (const next of adjacency.get(queue.shift()!) ?? []) {
        if (!seen.has(next)) {
          seen.add(next);
          queue.push(next);
        }
      }
    }
    return seen;
  };
  for (const n of nodes.values()) {
    const downstream = n.kind === "endpoint" || n.kind === "field";
    const reached = reach(n.id, downstream ? out : into);
    const wanted = downstream ? "file" : "endpoint";
    n.impact = [...reached].filter((id) => nodes.get(id)?.kind === wanted).length;
  }
}
