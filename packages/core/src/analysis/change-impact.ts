import type { TacetConfig } from "../config.js";
import type { ApiCallInfo, BackendManifest, FrontendManifest, PropertyAccessInfo } from "../ir/types.js";
import { formatAccessPath } from "../path.js";
import { diffBackends, type ApiChange, type EndpointDiff } from "./diff.js";
import { ProjectModel } from "./model.js";

/**
 * - DEFINITE: the frontend provably uses what changed (reads a removed field, calls a removed endpoint)
 * - LIKELY:   it uses it in a way that breaks in common cases (type change, value may now be null)
 * - POSSIBLE: a link exists but Tacet cannot prove the usage (value passed through an unknown function, unknown request keys)
 */
export type Confidence = "DEFINITE" | "LIKELY" | "POSSIBLE";

export interface ImpactSite {
  confidence: Confidence;
  reason: string;
  file: string;
  line: number;
  column: number;
  code: string;
  functionName: string | null;
  component: string | null;
  apiCallId: string;
  accessId: string | null;
}

export interface ChangeWithImpact extends ApiChange {
  impacts: ImpactSite[];
}

export type ChangeResult = "PASS" | "WARNING" | "FAIL";

export interface EndpointChangeReport extends Omit<EndpointDiff, "changes"> {
  result: ChangeResult;
  changes: ChangeWithImpact[];
  /** Affected code locations, one entry per location with the highest confidence and every reason. */
  sites: ImpactSite[];
  callSites: number;
  relatedFiles: string[];
  counts: Record<Confidence, number>;
}

export interface ChangeReport {
  result: ChangeResult;
  endpoints: EndpointChangeReport[];
  counts: { changedApis: number; breakingChanges: number } & Record<Confidence, number>;
}

/**
 * Phase 5: which frontend code is affected by the difference between two
 * backend contracts. Calls are linked against `before` - the contract the
 * frontend was written for.
 */
export function analyzeChangeImpact(
  frontend: FrontendManifest,
  before: BackendManifest,
  after: BackendManifest,
  config: TacetConfig = {},
): ChangeReport {
  const model = new ProjectModel(frontend, before, config);
  const callsByEndpoint = new Map<string, ApiCallInfo[]>();
  for (const call of model.apiCalls.values()) {
    const endpointId = model.link(call.id)?.endpointId;
    if (endpointId) (callsByEndpoint.get(endpointId) ?? callsByEndpoint.set(endpointId, []).get(endpointId)!).push(call);
  }

  const endpoints = diffBackends(before, after).endpoints.map((diff): EndpointChangeReport => {
    const calls = callsByEndpoint.get(diff.endpointId) ?? [];
    const reads = calls.flatMap((c) => model.accessesOf(c.id));
    const changes = diff.changes.map((c) => ({ ...c, impacts: impactsOf(c, diff, calls, reads, model) }));
    const sites = mergeSites(changes.flatMap((c) => c.impacts));
    const counts = countBy(sites);
    return {
      ...diff,
      changes,
      sites,
      callSites: calls.length,
      relatedFiles: [...new Set([...calls.map((c) => c.file), ...reads.map((r) => r.file)])].sort(),
      counts,
      result: resultOf(counts),
    };
  });

  const counts = countBy(endpoints.flatMap((e) => e.sites));
  return {
    result: resultOf(counts),
    endpoints,
    counts: {
      changedApis: endpoints.length,
      breakingChanges: endpoints.reduce((n, e) => n + e.changes.filter((c) => c.breaking).length, 0),
      ...counts,
    },
  };
}

function impactsOf(
  change: ApiChange,
  diff: EndpointDiff,
  calls: ApiCallInfo[],
  reads: PropertyAccessInfo[],
  model: ProjectModel,
): ImpactSite[] {
  if (!change.breaking) return [];
  const at = formatAccessPath(change.path);
  const callSite = (call: ApiCallInfo, confidence: Confidence, reason: string): ImpactSite => ({
    confidence,
    reason,
    file: call.file,
    line: call.location.line,
    column: call.location.column,
    code: call.code,
    functionName: model.functionName(call.callerFunctionId),
    component: model.componentOf(call),
    apiCallId: call.id,
    accessId: null,
  });
  const readSite = (access: PropertyAccessInfo, confidence: Confidence, reason: string): ImpactSite => ({
    confidence: access.flow === "derived" && confidence !== "POSSIBLE" ? "POSSIBLE" : confidence,
    reason: access.flow === "derived" ? `${reason} (value passed through a function Tacet could not follow)` : reason,
    file: access.file,
    line: access.location.line,
    column: access.location.column,
    code: access.code,
    functionName: model.functionName(access.containingFunctionId),
    component: access.containingComponent,
    apiCallId: access.apiCallId,
    accessId: access.id,
  });
  const through = (call: ApiCallInfo) => (call.wrapperFunctionId ? model.functionName(call.wrapperFunctionId) : null);

  switch (change.kind) {
    case "endpoint-removed":
      return calls.map((c) => callSite(c, "DEFINITE", `Calls ${diff.endpointId}, which was removed`));
    case "endpoint-moved":
      return calls.map((c) =>
        through(c)
          ? callSite(c, "POSSIBLE", `Goes through ${through(c)}(), which must switch to ${diff.movedTo}`)
          : callSite(c, "DEFINITE", `Calls ${diff.endpointId}; the endpoint moved to ${diff.movedTo}`),
      );
    case "response-removed":
      return reads.map((r) => readSite(r, "DEFINITE", `Reads \`${formatAccessPath(r.path)}\` but the response body was removed`));
    case "field-removed":
      return reads
        .filter((r) => startsWith(r.path, change.path))
        .map((r) => readSite(r, "DEFINITE", `Reads \`${formatAccessPath(r.path)}\`; \`${at}\` was removed from the response`));
    case "field-type-changed":
      if (change.where !== "response") return requestSites(change, calls, callSite, "LIKELY");
      return reads
        .filter((r) => startsWith(r.path, change.path))
        .map((r) => readSite(r, "LIKELY", `Reads \`${formatAccessPath(r.path)}\`; \`${at}\` changed ${change.before} → ${change.after}`));
    case "shape-changed":
      if (change.where !== "response") return requestSites(change, calls, callSite, "LIKELY");
      return reads
        .filter((r) => startsWith(r.path, change.path))
        .map((r) =>
          r.path.length > change.path.length
            ? readSite(r, "DEFINITE", `Reads \`${formatAccessPath(r.path)}\`; \`${at || "body"}\` changed ${change.before} → ${change.after}`)
            : readSite(r, "LIKELY", `Uses \`${at}\`, which changed ${change.before} → ${change.after}`),
        );
    case "field-nullable-changed":
      if (change.where !== "response") return requestSites(change, calls, callSite, "DEFINITE");
      return reads
        .filter((r) => startsWith(r.path, change.path))
        .map((r) =>
          r.path.length > change.path.length
            ? readSite(r, "LIKELY", `Reads \`${formatAccessPath(r.path)}\` through \`${at}\`, which may now be null`)
            : readSite(r, "POSSIBLE", `Uses \`${at}\`, which may now be null`),
        );
    case "enum-value-removed":
      if (change.where !== "response") return calls.map((c) => callSite(c, "POSSIBLE", `May send removed value "${change.before}"`));
      return reads
        .filter((r) => r.path.length === change.path.length && startsWith(r.path, change.path))
        .map((r) => readSite(r, "POSSIBLE", `Reads \`${at}\`; value "${change.before}" no longer exists`));
    case "param-added":
    case "param-required-changed":
      return calls.map((c) => {
        const keys = c.request.queryKeys;
        const name = change.path[0];
        if (keys === null) return callSite(c, "POSSIBLE", `Cannot tell whether \`${name}\` is sent; it is now required`);
        return keys.includes(name) ? null : callSite(c, "DEFINITE", `Does not send \`${name}\`, which is now required`);
      }).filter((s): s is ImpactSite => s !== null);
    case "param-type-changed":
      return calls.map((c) => callSite(c, "POSSIBLE", `Parameter \`${change.path[0]}\` changed ${change.before} → ${change.after}`));
    case "body-added":
      return calls.map((c) =>
        c.request.bodyKeys === null
          ? callSite(c, "POSSIBLE", "A request body is now required")
          : callSite(c, c.request.bodyKeys.length ? "POSSIBLE" : "DEFINITE", `A request body ${change.after} is now required`),
      );
    case "field-added":
      return requestSites(change, calls, callSite, "DEFINITE");
    default:
      return [];
  }
}

/** Request-side changes: a call is affected when it does not send (or may not send) the changed top-level key. */
function requestSites(
  change: ApiChange,
  calls: ApiCallInfo[],
  callSite: (call: ApiCallInfo, confidence: Confidence, reason: string) => ImpactSite,
  whenMissing: Confidence,
): ImpactSite[] {
  const key = change.path[0];
  const at = formatAccessPath(change.path);
  return calls
    .map((c) => {
      const keys = c.request.bodyKeys;
      if (keys === null || change.path.length !== 1) return callSite(c, "POSSIBLE", `Request body \`${at}\`: ${change.message}`);
      const sends = keys.includes(key);
      if (change.kind === "field-added" || change.kind === "field-nullable-changed") {
        return sends ? null : callSite(c, whenMissing, `Does not send \`${at}\`, which is now required`);
      }
      return sends ? callSite(c, whenMissing, `Sends \`${at}\`: ${change.message}`) : null;
    })
    .filter((s): s is ImpactSite => s !== null);
}

const RANK: Record<Confidence, number> = { DEFINITE: 0, LIKELY: 1, POSSIBLE: 2 };

function mergeSites(sites: ImpactSite[]): ImpactSite[] {
  const merged = new Map<string, ImpactSite>();
  for (const site of sites) {
    const key = site.accessId ?? site.apiCallId;
    const existing = merged.get(key);
    if (!existing) {
      merged.set(key, { ...site });
      continue;
    }
    if (RANK[site.confidence] < RANK[existing.confidence]) existing.confidence = site.confidence;
    if (!existing.reason.includes(site.reason)) existing.reason = `${existing.reason}; ${site.reason}`;
  }
  return [...merged.values()].sort(
    (a, b) => RANK[a.confidence] - RANK[b.confidence] || a.file.localeCompare(b.file) || a.line - b.line || a.column - b.column,
  );
}

/** Prefix match where "*" (map value) matches any segment. */
function startsWith(path: string[], prefix: string[]): boolean {
  return prefix.length <= path.length && prefix.every((s, i) => s === "*" || path[i] === s);
}

function countBy(sites: ImpactSite[]): Record<Confidence, number> {
  const counts = { DEFINITE: 0, LIKELY: 0, POSSIBLE: 0 };
  for (const s of sites) counts[s.confidence]++;
  return counts;
}

function resultOf(counts: Record<Confidence, number>): ChangeResult {
  if (counts.DEFINITE > 0) return "FAIL";
  if (counts.LIKELY + counts.POSSIBLE > 0) return "WARNING";
  return "PASS";
}
