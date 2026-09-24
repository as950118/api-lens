import type { AiPrompt, AiVerificationRequest } from "./types.js";

const SYSTEM = `You review whether a backend API change breaks existing frontend code.

A static analyzer has already linked the frontend code to the changed endpoint and flagged candidate locations it could not decide on its own. For each candidate, decide from the code shown whether the change actually breaks runtime behavior:

- FAIL: the code will misbehave with the new response (reads a field that no longer exists, calls string methods on what is now a number, iterates what is no longer an array, assumes a value that can now be null, ...).
- WARNING: it can misbehave in some cases, or the observable output changes in a way a user would notice.
- PASS: the code keeps working (for example the value is only rendered as text, is null-guarded, or is not the changed field after all).
- UNKNOWN: the code shown is not enough to decide. Prefer UNKNOWN over guessing.

Rules:
- Judge only from the code, schemas and changes provided. Do not assume code you cannot see.
- Every verdict other than UNKNOWN must cite evidence: the file, the line number and the exact code text from the provided snippets that supports it. Evidence that does not appear in the snippets is discarded and the verdict becomes UNKNOWN.
- Return exactly one verdict per candidate id. confidence is a number between 0 and 1.
- Keep each reason to one or two sentences a developer can act on.`;

/** Vendor-neutral prompt; every provider sends exactly this. */
export function buildVerificationPrompt(request: AiVerificationRequest): AiPrompt {
  const changes = request.changes.map((c) => `- ${c.breaking ? "[breaking] " : ""}${c.message}`).join("\n");
  const candidates = request.candidates
    .map((c) => {
      const where = [c.component, c.functionName].filter(Boolean).join(" > ");
      return [
        `- id: ${c.id}`,
        `  location: ${c.file}:${c.line}${where ? ` (${where})` : ""}`,
        `  code: ${c.code}`,
        `  static analysis: ${c.staticConfidence} - ${c.staticReason}`,
      ].join("\n");
    })
    .join("\n");
  const snippets = request.snippets
    .map((s) => {
      const width = String(s.startLine + s.lines.length).length;
      const body = s.lines.map((line, i) => `${String(s.startLine + i).padStart(width)} | ${line}`).join("\n");
      return `<file path="${s.file}" lines="${s.startLine}-${s.startLine + s.lines.length - 1}">\n${body}\n</file>`;
    })
    .join("\n\n");

  const user = `<endpoint>${request.endpointId} (handler ${request.handler})</endpoint>

<changes>
${changes}
</changes>

<response_before>
${request.beforeSchema}
</response_before>

<response_after>
${request.afterSchema}
</response_after>

<candidates>
${candidates}
</candidates>

<code>
${snippets}
</code>

Return one verdict for each candidate id.`;
  return { system: SYSTEM, user };
}
