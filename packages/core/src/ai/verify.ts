import type { ChangeReport, ChangeResult, EndpointChangeReport, ImpactSite } from "../analysis/change-impact.js";
import type { TypeLookup } from "../analysis/type-path.js";
import type { BackendManifest, FrontendManifest } from "../ir/types.js";
import { renderJsonShape } from "./schema-render.js";
import type { AiCandidate, AiCodeSnippet, AiEvidence, AiProvider, AiVerdict, AiVerificationRequest } from "./types.js";

export interface SiteVerification {
  result: AiVerdict;
  confidence: number;
  reason: string;
  /** Only evidence that was found in the code the model was shown. */
  evidence: AiEvidence[];
}

export interface VerifiedImpactSite extends ImpactSite {
  /** null for DEFINITE sites (never sent to the model) and when verification failed. */
  ai: SiteVerification | null;
}

export interface EndpointVerification {
  result: AiVerdict | null;
  verified: number;
  error: string | null;
}

export interface VerifiedEndpointReport extends Omit<EndpointChangeReport, "sites"> {
  sites: VerifiedImpactSite[];
  staticResult: ChangeResult;
  ai: EndpointVerification | null;
}

export interface VerifiedChangeReport extends Omit<ChangeReport, "endpoints"> {
  staticResult: ChangeResult;
  endpoints: VerifiedEndpointReport[];
  ai: {
    provider: string;
    model: string;
    candidates: number;
    verified: number;
    /** Verdicts downgraded to UNKNOWN because their evidence was not in the provided code. */
    discarded: number;
    counts: Record<AiVerdict, number>;
    errors: string[];
  };
}

export interface VerifyChangeOptions {
  /** Reads a frontend file by its index path; null when missing. */
  readFile: (path: string) => string | null;
  /** Lines of context around each candidate. */
  contextLines?: number;
  maxCandidatesPerEndpoint?: number;
  concurrency?: number;
}

export interface VerifyChangeInputs {
  frontend: FrontendManifest;
  before: BackendManifest;
  after: BackendManifest;
}

/**
 * Phase 6: asks the AI provider about the candidates static analysis could not
 * decide (LIKELY / POSSIBLE). DEFINITE findings are never sent and never
 * overridden. Verdicts without evidence found in the provided code become
 * UNKNOWN.
 */
export async function verifyChangeReport(
  report: ChangeReport,
  inputs: VerifyChangeInputs,
  provider: AiProvider,
  options: VerifyChangeOptions,
): Promise<VerifiedChangeReport> {
  const context = options.contextLines ?? 6;
  const limit = options.maxCandidatesPerEndpoint ?? 25;
  const beforeLookup = lookupOf(inputs.before);
  const afterLookup = lookupOf(inputs.after);
  const callsById = new Map(inputs.frontend.apiCalls.map((c) => [c.id, c]));
  const files = new FileCache(options.readFile);
  const errors: string[] = [];
  let model = provider.model;
  let discarded = 0;

  const tasks = report.endpoints.map((endpoint) => async (): Promise<VerifiedEndpointReport> => {
    const sites: VerifiedImpactSite[] = endpoint.sites.map((s) => ({ ...s, ai: null }));
    const candidates = sites.filter((s) => s.confidence !== "DEFINITE").slice(0, limit);
    const base = { ...endpoint, sites, staticResult: endpoint.result };
    if (candidates.length === 0) return { ...base, ai: null };

    const ids = new Map(candidates.map((site, i) => [`c${i + 1}`, site]));
    const snippets = collectSnippets(candidates, callsById, files, context);
    const request: AiVerificationRequest = {
      endpointId: endpoint.endpointId,
      handler: endpoint.handler,
      changes: endpoint.changes.map((c) => ({ message: c.message, breaking: c.breaking })),
      beforeSchema: renderJsonShape(responseOf(inputs.before, endpoint.endpointId), beforeLookup),
      afterSchema: endpoint.status === "removed"
        ? "(endpoint removed)"
        : renderJsonShape(responseOf(inputs.after, endpoint.movedTo ?? endpoint.endpointId), afterLookup),
      candidates: [...ids.entries()].map(([id, s]) => toCandidate(id, s)),
      snippets,
    };

    try {
      const response = await provider.verify(request);
      model = response.model;
      const byId = new Map(response.verdicts.map((v) => [v.id, v]));
      for (const [id, site] of ids) {
        const verdict = byId.get(id);
        if (!verdict) {
          site.ai = { result: "UNKNOWN", confidence: 0, reason: "No verdict returned for this location.", evidence: [] };
          continue;
        }
        const evidence = verdict.evidence.filter((e) => evidenceIsInSnippets(e, snippets));
        if (verdict.result !== "UNKNOWN" && evidence.length === 0) {
          discarded++;
          site.ai = {
            result: "UNKNOWN",
            confidence: 0,
            reason: `Verdict ${verdict.result} discarded: its evidence does not appear in the code provided. (${verdict.reason})`,
            evidence: [],
          };
        } else {
          site.ai = {
            result: verdict.result,
            confidence: Math.min(1, Math.max(0, verdict.confidence)),
            reason: verdict.reason,
            evidence,
          };
        }
      }
      const verdicts = [...ids.values()].map((s) => s.ai!.result);
      const ai = { result: worst(verdicts), verified: verdicts.length, error: null };
      return { ...base, ai, result: finalResult(endpoint, ai.result) };
    } catch (err) {
      const message = `${endpoint.endpointId}: ${(err as Error).message}`;
      errors.push(message);
      return { ...base, ai: { result: null, verified: 0, error: message }, result: finalResult(endpoint, null) };
    }
  });

  const endpoints = await runLimited(tasks, options.concurrency ?? 3);
  const verifiedSites = endpoints.flatMap((e) => e.sites).filter((s) => s.ai !== null);
  const counts: Record<AiVerdict, number> = { PASS: 0, WARNING: 0, FAIL: 0, UNKNOWN: 0 };
  for (const s of verifiedSites) counts[s.ai!.result]++;

  return {
    ...report,
    staticResult: report.result,
    result: endpoints.some((e) => e.result === "FAIL")
      ? "FAIL"
      : endpoints.some((e) => e.result === "WARNING")
        ? "WARNING"
        : "PASS",
    endpoints,
    ai: {
      provider: provider.name,
      model,
      candidates: endpoints.reduce((n, e) => n + e.sites.filter((s) => s.confidence !== "DEFINITE").length, 0),
      verified: verifiedSites.length,
      discarded,
      counts,
      errors,
    },
  };
}

/** DEFINITE static findings always fail; otherwise the AI decides, and anything undecided stays a warning. */
function finalResult(endpoint: EndpointChangeReport, ai: AiVerdict | null): ChangeResult {
  if (endpoint.counts.DEFINITE > 0) return "FAIL";
  if (ai === "FAIL") return "FAIL";
  if (ai === "PASS") return "PASS";
  return endpoint.counts.LIKELY + endpoint.counts.POSSIBLE > 0 ? "WARNING" : endpoint.result;
}

const SEVERITY: AiVerdict[] = ["FAIL", "WARNING", "UNKNOWN", "PASS"];

function worst(verdicts: AiVerdict[]): AiVerdict {
  return SEVERITY.find((v) => verdicts.includes(v)) ?? "PASS";
}

function toCandidate(id: string, site: ImpactSite): AiCandidate {
  return {
    id,
    staticConfidence: site.confidence as AiCandidate["staticConfidence"],
    staticReason: site.reason,
    file: site.file,
    line: site.line,
    code: site.code,
    functionName: site.functionName,
    component: site.component,
  };
}

/** The candidate's surroundings plus the API call its data came from, merged per file. */
function collectSnippets(
  candidates: ImpactSite[],
  callsById: Map<string, FrontendManifest["apiCalls"][number]>,
  files: FileCache,
  context: number,
): AiCodeSnippet[] {
  const ranges = new Map<string, [number, number][]>();
  const add = (file: string, line: number, radius: number) => {
    const list = ranges.get(file) ?? ranges.set(file, []).get(file)!;
    list.push([Math.max(1, line - radius), line + radius]);
  };
  for (const site of candidates) {
    add(site.file, site.line, context);
    const call = callsById.get(site.apiCallId);
    if (call) add(call.file, call.location.line, Math.min(context, 3));
  }

  const snippets: AiCodeSnippet[] = [];
  for (const [file, list] of [...ranges.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    const lines = files.lines(file);
    if (!lines) continue;
    list.sort((a, b) => a[0] - b[0]);
    let [start, end] = list[0];
    const flush = () => {
      const last = Math.min(end, lines.length);
      if (start <= last) snippets.push({ file, startLine: start, lines: lines.slice(start - 1, last) });
    };
    for (const [s, e] of list.slice(1)) {
      if (s <= end + 1) {
        end = Math.max(end, e);
      } else {
        flush();
        [start, end] = [s, e];
      }
    }
    flush();
  }
  return snippets;
}

/** Evidence counts only when its code text appears at (or next to) the cited line of a provided snippet. */
export function evidenceIsInSnippets(evidence: AiEvidence, snippets: AiCodeSnippet[]): boolean {
  const code = normalize(evidence.code);
  if (code.length < 2) return false;
  return snippets.some((s) => {
    if (s.file !== evidence.file) return false;
    const index = evidence.line - s.startLine;
    if (index < 0 || index >= s.lines.length) return false;
    const window = s.lines.slice(Math.max(0, index - 1), index + 2).join(" ");
    return normalize(window).includes(code);
  });
}

function normalize(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function responseOf(manifest: BackendManifest, endpointId: string) {
  return manifest.endpoints.find((e) => e.id === endpointId)?.response ?? null;
}

function lookupOf(manifest: BackendManifest): TypeLookup {
  return {
    dtos: new Map(manifest.dtos.map((d) => [d.id, d])),
    enums: new Map(manifest.enums.map((e) => [e.id, e])),
  };
}

class FileCache {
  private readonly cache = new Map<string, string[] | null>();
  constructor(private readonly read: (path: string) => string | null) {}

  lines(file: string): string[] | null {
    if (!this.cache.has(file)) this.cache.set(file, this.read(file)?.split(/\r?\n/) ?? null);
    return this.cache.get(file)!;
  }
}

async function runLimited<T>(tasks: (() => Promise<T>)[], concurrency: number): Promise<T[]> {
  const results: T[] = new Array(tasks.length);
  let next = 0;
  const worker = async () => {
    while (next < tasks.length) {
      const index = next++;
      results[index] = await tasks[index]();
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(concurrency, tasks.length)) }, worker));
  return results;
}
