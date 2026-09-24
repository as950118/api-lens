import type { ApiCallInfo, DataFlowKind, PropertyAccessInfo } from "../ir/types.js";
import { formatAccessPath, normalizePath } from "../path.js";
import { buildGraph, type ImpactGraph } from "./graph.js";
import type { LinkStatus } from "./link.js";
import type { ProjectModel } from "./model.js";
import { pathsToDto } from "./type-path.js";

export interface CallSite {
  apiCallId: string;
  apiKey: string;
  file: string;
  line: number;
  column: number;
  functionName: string | null;
  component: string | null;
  /** The API client function the call goes through, e.g. "getUser". */
  via: string | null;
  code: string;
}

export interface FieldRead {
  accessId: string;
  apiKey: string;
  path: string;
  file: string;
  line: number;
  column: number;
  functionName: string | null;
  component: string | null;
  flow: DataFlowKind;
  code: string;
}

export interface ApiUsage {
  apiKey: string;
  status: LinkStatus | "unused" | "no-backend";
  handler: string | null;
  callSites: CallSite[];
  fieldReads: FieldRead[];
  fields: { path: string; reads: number }[];
  files: string[];
  components: string[];
}

export interface ApiImpact extends ApiUsage {
  graph: ImpactGraph;
}

export interface FileImpact {
  file: string;
  /** APIs this file calls or whose response it reads. */
  apis: (ApiUsage & { via: ("call" | "read")[] })[];
  /** API client functions defined in this file, with every place they are called from. */
  clientFunctions: { name: string; apiKeys: string[]; callSites: CallSite[] }[];
  /** Files importing this file, directly or transitively. */
  dependents: string[];
  /** Everything that may break when this file changes. */
  blastRadius: { apis: string[]; files: string[]; components: string[] };
  graph: ImpactGraph;
}

export interface FieldImpact {
  dtoId: string;
  field: string;
  usages: { apiKey: string; responsePath: string; reads: FieldRead[] }[];
  files: string[];
  components: string[];
  graph: ImpactGraph;
}

export interface SearchHit {
  kind: "api" | "file" | "function" | "component" | "dto" | "field";
  label: string;
  detail: string | null;
  apis: number;
  files: number;
}

export interface ImpactSummary {
  apis: { apiKey: string; status: ApiUsage["status"]; callSites: number; fieldReads: number; files: number; components: number }[];
  files: { file: string; apis: number; apiKeys: string[] }[];
  unusedEndpoints: string[];
}

/** Read-only queries answering "what is affected if X changes", without changing anything. */
export class ImpactAnalyzer {
  private readonly callsByKey = new Map<string, ApiCallInfo[]>();

  constructor(private readonly model: ProjectModel) {
    for (const call of model.apiCalls.values()) {
      const key = model.apiKeyOf(call);
      (this.callsByKey.get(key) ?? this.callsByKey.set(key, []).get(key)!).push(call);
    }
  }

  /** `query`: "GET /users/{id}", "GET /users/:id", "/users/{id}" (any method), or an endpoint handler. */
  impactOfApi(query: string): ApiImpact[] {
    return this.matchApiKeys(query).map((key) => {
      const calls = this.callsByKey.get(key) ?? [];
      const accesses = calls.flatMap((c) => this.model.accessesOf(c.id));
      const unused = calls.length === 0 ? [this.model.endpoints.get(key)!] : [];
      return {
        ...this.usage(key, calls, accesses),
        graph: buildGraph(this.model, { calls, accesses, unusedEndpoints: unused }),
      };
    });
  }

  impactOfFile(file: string): FileImpact {
    const model = this.model;
    const callsHere = [...model.apiCalls.values()].filter((c) => c.file === file);
    const readsHere = model.frontend.propertyAccesses.filter((a) => a.file === file);
    const functionsHere = new Set(model.frontend.functions.filter((f) => f.file === file).map((f) => f.id));
    const throughClients = [...model.apiCalls.values()].filter(
      (c) => c.wrapperFunctionId !== null && functionsHere.has(c.wrapperFunctionId) && c.file !== file,
    );

    const via = new Map<string, Set<"call" | "read">>();
    const mark = (call: ApiCallInfo, kind: "call" | "read") => {
      const key = model.apiKeyOf(call);
      (via.get(key) ?? via.set(key, new Set()).get(key)!).add(kind);
    };
    callsHere.forEach((c) => mark(c, "call"));
    readsHere.forEach((a) => {
      const call = model.apiCalls.get(a.apiCallId);
      if (call) mark(call, "read");
    });

    const apis = [...via.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, kinds]) => {
        const calls = (this.callsByKey.get(key) ?? []).filter(
          (c) => c.file === file || readsHere.some((a) => a.apiCallId === c.id),
        );
        const reads = calls.flatMap((c) =>
          model.accessesOf(c.id).filter((a) => a.file === file || c.file === file),
        );
        return { ...this.usage(key, calls, reads), via: [...kinds].sort() };
      });

    const clientFunctions = model.frontend.functions
      .filter((f) => functionsHere.has(f.id))
      .map((f) => {
        const callSites = throughClients.filter((c) => c.wrapperFunctionId === f.id);
        return {
          name: f.name,
          apiKeys: unique(callSites.map((c) => model.apiKeyOf(c))),
          callSites: callSites.map((c) => this.callSite(c)),
        };
      })
      .filter((f) => f.callSites.length > 0);

    const affectedCalls = new Map<string, ApiCallInfo>();
    for (const c of [...callsHere, ...throughClients]) affectedCalls.set(c.id, c);
    for (const a of readsHere) {
      const call = model.apiCalls.get(a.apiCallId);
      if (call) affectedCalls.set(call.id, call);
    }
    const affectedAccesses = [...affectedCalls.values()].flatMap((c) => model.accessesOf(c.id));
    const affectedFiles = new Set<string>([file]);
    for (const c of affectedCalls.values()) affectedFiles.add(c.file);
    for (const a of affectedAccesses) affectedFiles.add(a.file);
    const components = new Set<string>();
    for (const c of affectedCalls.values()) {
      const comp = model.componentOf(c);
      if (comp) components.add(comp);
    }
    for (const a of affectedAccesses) if (a.containingComponent) components.add(a.containingComponent);

    return {
      file,
      apis,
      clientFunctions,
      dependents: this.dependentsOf(file),
      blastRadius: {
        apis: unique([...affectedCalls.values()].map((c) => model.apiKeyOf(c))),
        files: [...affectedFiles].sort(),
        components: [...components].sort(),
      },
      graph: buildGraph(model, { calls: affectedCalls.values(), accesses: affectedAccesses }),
    };
  }

  /** `query`: "UserResponse.name", "com.example.user.UserResponse.profile.email", "UserResponse.Profile.email". */
  impactOfField(query: string): FieldImpact[] {
    const model = this.model;
    const segments = query.split(".");
    const results: FieldImpact[] = [];
    for (let split = segments.length - 1; split >= 1 && results.length === 0; split--) {
      const typeName = segments.slice(0, split).join(".");
      const fieldPath = segments.slice(split);
      const dtos = [...model.dtos.values()].filter(
        (d) => d.id === typeName || d.id.endsWith(`.${typeName}`) || d.name === typeName,
      );
      for (const dto of dtos) {
        if (!dto.fields.some((f) => f.name === fieldPath[0])) continue;
        const usages: FieldImpact["usages"] = [];
        const calls: ApiCallInfo[] = [];
        const accesses: PropertyAccessInfo[] = [];
        for (const endpoint of model.endpoints.values()) {
          if (!endpoint.response) continue;
          for (const prefix of pathsToDto(endpoint.response, dto.id, model)) {
            const target = [...prefix, ...fieldPath];
            const endpointCalls = this.callsByKey.get(endpoint.id) ?? [];
            const reads = endpointCalls
              .flatMap((c) => model.accessesOf(c.id))
              .filter((a) => startsWith(a.path, target));
            usages.push({
              apiKey: endpoint.id,
              responsePath: formatAccessPath(target),
              reads: reads.map((a) => this.fieldRead(a)),
            });
            accesses.push(...reads);
            calls.push(...endpointCalls.filter((c) => reads.some((r) => r.apiCallId === c.id)));
          }
        }
        results.push({
          dtoId: dto.id,
          field: fieldPath.join("."),
          usages,
          files: unique(accesses.map((a) => a.file)),
          components: unique(accesses.map((a) => a.containingComponent).filter((c): c is string => c !== null)),
          graph: buildGraph(model, { calls, accesses }),
        });
      }
    }
    return results;
  }

  search(text: string): SearchHit[] {
    const model = this.model;
    const q = text.toLowerCase();
    const hits: SearchHit[] = [];
    const matches = (value: string | null | undefined) => value?.toLowerCase().includes(q) ?? false;

    for (const key of this.allApiKeys()) {
      const handler = model.endpoints.get(key)?.handler;
      if (matches(key) || matches(handler)) {
        const calls = this.callsByKey.get(key) ?? [];
        const usage = this.usage(key, calls, calls.flatMap((c) => model.accessesOf(c.id)));
        hits.push({ kind: "api", label: key, detail: handler ?? null, apis: 1, files: usage.files.length });
      }
    }
    for (const file of model.frontend.files) {
      if (!matches(file.path)) continue;
      const impact = this.impactOfFile(file.path);
      hits.push({ kind: "file", label: file.path, detail: null, apis: impact.apis.length, files: impact.blastRadius.files.length });
    }
    for (const fn of model.frontend.functions) {
      if (fn.name === "<anonymous>" || !matches(fn.name)) continue;
      const calls = [...model.apiCalls.values()].filter(
        (c) => c.callerFunctionId === fn.id || c.wrapperFunctionId === fn.id,
      );
      const reads = model.frontend.propertyAccesses.filter((a) => a.containingFunctionId === fn.id);
      const apiKeys = unique([...calls, ...reads.map((r) => model.apiCalls.get(r.apiCallId)!)].map((c) => model.apiKeyOf(c)));
      hits.push({
        kind: fn.containingComponent === fn.name ? "component" : "function",
        label: fn.name,
        detail: `${fn.file}:${fn.location.line}`,
        apis: apiKeys.length,
        files: unique([...calls.map((c) => c.file), ...reads.map((r) => r.file)]).length,
      });
    }
    for (const dto of model.dtos.values()) {
      if (matches(dto.id)) {
        const usage = this.dtoUsage(dto.id);
        hits.push({ kind: "dto", label: dto.name, detail: dto.id, apis: usage.endpoints, files: usage.files });
      }
      for (const field of dto.fields) {
        if (!matches(field.name)) continue;
        const impact = this.impactOfField(`${dto.id}.${field.name}`)[0];
        hits.push({
          kind: "field",
          label: `${dto.name}.${field.name}`,
          detail: dto.id,
          apis: impact?.usages.length ?? 0,
          files: impact?.files.length ?? 0,
        });
      }
    }
    return hits;
  }

  summary(): ImpactSummary {
    const model = this.model;
    const apis = this.allApiKeys().map((key) => {
      const calls = this.callsByKey.get(key) ?? [];
      const u = this.usage(key, calls, calls.flatMap((c) => model.accessesOf(c.id)));
      return {
        apiKey: key,
        status: u.status,
        callSites: u.callSites.length,
        fieldReads: u.fieldReads.length,
        files: u.files.length,
        components: u.components.length,
      };
    });
    apis.sort((a, b) => b.files - a.files || b.callSites - a.callSites || a.apiKey.localeCompare(b.apiKey));
    const files = model.frontend.files
      .map((f) => {
        const apiKeys = this.impactOfFile(f.path).apis.map((a) => a.apiKey);
        return { file: f.path, apis: apiKeys.length, apiKeys };
      })
      .filter((f) => f.apis > 0)
      .sort((a, b) => b.apis - a.apis || a.file.localeCompare(b.file));
    return {
      apis,
      files,
      unusedEndpoints: [...model.endpoints.keys()].filter((id) => !this.callsByKey.has(id)).sort(),
    };
  }

  /** Graph of every API and the frontend code using it, including unused backend endpoints. */
  fullGraph(): ImpactGraph {
    const model = this.model;
    return buildGraph(model, {
      calls: model.apiCalls.values(),
      accesses: model.frontend.propertyAccesses,
      unusedEndpoints: [...model.endpoints.values()].filter((e) => !this.callsByKey.has(e.id)),
    });
  }

  // -------------------------------------------------------------------------

  private allApiKeys(): string[] {
    return unique([...this.model.endpoints.keys(), ...this.callsByKey.keys()]);
  }

  private matchApiKeys(query: string): string[] {
    const q = query.trim();
    const keys = this.allApiKeys();
    if (keys.includes(q)) return [q];
    const match = q.match(/^([A-Za-z]+)\s+(\S+)$/);
    const method = match ? match[1].toUpperCase() : null;
    const path = normalizePath(match ? match[2] : q);
    const byPath = keys.filter((key) => {
      const [m, p] = key.split(" ");
      return (method === null || m === method) && p !== undefined && normalizePath(p) === path;
    });
    if (byPath.length) return byPath;
    return keys.filter((key) => this.model.endpoints.get(key)?.handler.toLowerCase().includes(q.toLowerCase()));
  }

  private usage(key: string, calls: ApiCallInfo[], accesses: PropertyAccessInfo[]): ApiUsage {
    const model = this.model;
    const endpoint = model.endpoints.get(key);
    const link = calls[0] ? model.link(calls[0].id) : undefined;
    const status: ApiUsage["status"] = !model.hasBackend
      ? "no-backend"
      : calls.length === 0
        ? "unused"
        : link?.status ?? "not-found";
    const fieldCounts = new Map<string, number>();
    for (const a of accesses) {
      const p = formatAccessPath(a.path);
      fieldCounts.set(p, (fieldCounts.get(p) ?? 0) + 1);
    }
    const components = new Set<string>();
    for (const c of calls) {
      const comp = model.componentOf(c);
      if (comp) components.add(comp);
    }
    for (const a of accesses) if (a.containingComponent) components.add(a.containingComponent);
    return {
      apiKey: key,
      status,
      handler: endpoint?.handler ?? null,
      callSites: calls.map((c) => this.callSite(c)),
      fieldReads: accesses.map((a) => this.fieldRead(a)),
      fields: [...fieldCounts.entries()].map(([path, reads]) => ({ path, reads })).sort((a, b) => a.path.localeCompare(b.path)),
      files: unique([...calls.map((c) => c.file), ...accesses.map((a) => a.file)]),
      components: [...components].sort(),
    };
  }

  private callSite(call: ApiCallInfo): CallSite {
    return {
      apiCallId: call.id,
      apiKey: this.model.apiKeyOf(call),
      file: call.file,
      line: call.location.line,
      column: call.location.column,
      functionName: this.model.functionName(call.callerFunctionId),
      component: this.model.componentOf(call),
      via: this.model.functionName(call.wrapperFunctionId),
      code: call.code,
    };
  }

  private fieldRead(access: PropertyAccessInfo): FieldRead {
    const call = this.model.apiCalls.get(access.apiCallId);
    return {
      accessId: access.id,
      apiKey: call ? this.model.apiKeyOf(call) : "?",
      path: formatAccessPath(access.path),
      file: access.file,
      line: access.location.line,
      column: access.location.column,
      functionName: this.model.functionName(access.containingFunctionId),
      component: access.containingComponent,
      flow: access.flow,
      code: access.code,
    };
  }

  private dependentsOf(file: string): string[] {
    const importers = new Map<string, string[]>();
    for (const f of this.model.frontend.files) {
      for (const imp of f.imports) {
        if (imp.resolvedFile) (importers.get(imp.resolvedFile) ?? importers.set(imp.resolvedFile, []).get(imp.resolvedFile)!).push(f.path);
      }
    }
    const seen = new Set<string>();
    const queue = [file];
    while (queue.length) {
      for (const importer of importers.get(queue.shift()!) ?? []) {
        if (!seen.has(importer) && importer !== file) {
          seen.add(importer);
          queue.push(importer);
        }
      }
    }
    return [...seen].sort();
  }

  /** Endpoints whose request or response contains the DTO, and frontend files reading through it. */
  private dtoUsage(dtoId: string): { endpoints: number; files: number } {
    const model = this.model;
    let endpoints = 0;
    const files = new Set<string>();
    for (const e of model.endpoints.values()) {
      const prefixes = e.response ? pathsToDto(e.response, dtoId, model) : [];
      const inBody = e.requestBody ? pathsToDto(e.requestBody.type, dtoId, model).length > 0 : false;
      if (prefixes.length === 0 && !inBody) continue;
      endpoints++;
      for (const call of this.callsByKey.get(e.id) ?? []) {
        for (const a of model.accessesOf(call.id)) {
          if (prefixes.some((p) => startsWith(a.path, p) && a.path.length > p.length)) files.add(a.file);
        }
      }
    }
    return { endpoints, files: files.size };
  }
}

function unique<T>(values: T[]): T[] {
  return [...new Set(values)].sort();
}

function startsWith(path: string[], prefix: string[]): boolean {
  return prefix.length <= path.length && prefix.every((s, i) => path[i] === s);
}
