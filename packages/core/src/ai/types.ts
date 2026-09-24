import type { DtoInfo } from "../ir/types.js";

/**
 * Vendor-neutral AI verification contract (Phase 6). Core and the CLI only
 * ever depend on this interface; a concrete implementation (Anthropic,
 * OpenAI, a local model, ...) is selected at the edge by the caller.
 */
export type AiVerificationVerdict = "PASS" | "WARNING" | "FAIL" | "UNKNOWN";

export interface StaticFinding {
  file: string;
  line: number;
  code: string;
  confidence: "DEFINITE" | "LIKELY" | "POSSIBLE" | "UNRELATED";
}

export interface AiVerificationInput {
  apiChangeSummary: string;
  beforeSchema: DtoInfo | null;
  afterSchema: DtoInfo | null;
  relatedCode: { file: string; line: number; snippet: string }[];
  staticFindings: StaticFinding[];
}

export interface AiVerificationResult {
  result: AiVerificationVerdict;
  confidence: number;
  reason: string;
  evidence: { file: string; line: number; code: string }[];
}

export interface AiProvider {
  readonly name: string;
  verify(input: AiVerificationInput): Promise<AiVerificationResult>;
}
