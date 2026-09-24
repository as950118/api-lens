/**
 * Vendor-neutral AI verification contract (Phase 6). Core decides what to
 * verify, builds the prompt and validates the answer; a provider (Anthropic,
 * OpenAI, a local model, ...) only sends the prompt and returns the parsed
 * verdicts.
 */
export type AiVerdict = "PASS" | "WARNING" | "FAIL" | "UNKNOWN";

export interface AiCandidate {
  /** Stable id the provider must echo back. */
  id: string;
  staticConfidence: "LIKELY" | "POSSIBLE";
  staticReason: string;
  file: string;
  line: number;
  code: string;
  functionName: string | null;
  component: string | null;
}

export interface AiCodeSnippet {
  file: string;
  startLine: number;
  /** Source lines starting at `startLine`. */
  lines: string[];
}

/** Everything the model sees for one endpoint - never the whole repository. */
export interface AiVerificationRequest {
  endpointId: string;
  handler: string;
  changes: { message: string; breaking: boolean }[];
  /** Response type before/after, rendered as TypeScript-like types. */
  beforeSchema: string;
  afterSchema: string;
  candidates: AiCandidate[];
  snippets: AiCodeSnippet[];
}

export interface AiEvidence {
  file: string;
  line: number;
  code: string;
}

export interface AiCandidateVerdict {
  id: string;
  result: AiVerdict;
  /** 0..1 */
  confidence: number;
  reason: string;
  evidence: AiEvidence[];
}

export interface AiVerificationResponse {
  /** The model that actually answered (may differ from the requested one after a fallback). */
  model: string;
  verdicts: AiCandidateVerdict[];
}

export interface AiPrompt {
  system: string;
  user: string;
}

export interface AiProvider {
  readonly name: string;
  readonly model: string;
  verify(request: AiVerificationRequest): Promise<AiVerificationResponse>;
}
