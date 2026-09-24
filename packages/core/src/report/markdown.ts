import type { ChangeReport } from "../analysis/change-impact.js";
import type { ContractReport } from "../analysis/contract.js";

/** Markdown for PR comments / CI job summaries. */
export function renderChangeReportMarkdown(report: ChangeReport, title = "ApiLens: backend API change report"): string {
  const c = report.counts;
  const lines = [
    `## ${title}: ${report.result}`,
    "",
    `**${c.changedApis} changed API${s(c.changedApis)} · ${c.breakingChanges} breaking change${s(c.breakingChanges)} · ` +
      `frontend impact: ${c.DEFINITE} definite, ${c.LIKELY} likely, ${c.POSSIBLE} possible**`,
  ];
  if (report.endpoints.length === 0) return [...lines, "", "No API changes."].join("\n");

  lines.push(
    "",
    "| API | Change | Breaking | Frontend files | Definite | Likely | Possible | Result |",
    "|---|---|---:|---:|---:|---:|---:|---|",
  );
  for (const e of report.endpoints) {
    const breaking = e.changes.filter((ch) => ch.breaking).length;
    const status = e.movedTo ? `moved → ${code(e.movedTo)}` : e.status;
    lines.push(
      `| ${code(e.endpointId)} | ${status} | ${breaking} | ${e.relatedFiles.length} | ${e.counts.DEFINITE} | ${e.counts.LIKELY} | ${e.counts.POSSIBLE} | ${e.result} |`,
    );
  }

  for (const e of report.endpoints.filter((ep) => ep.changes.some((ch) => ch.breaking))) {
    lines.push("", `### \`${e.endpointId}\``, "", `Handler: \`${e.handler}\``, "");
    for (const ch of e.changes) lines.push(`- ${ch.breaking ? "**breaking** " : ""}${ch.message}`);
    const sites = e.sites;
    if (sites.length === 0) {
      lines.push("", "_No frontend code depends on the breaking changes._");
      continue;
    }
    lines.push(
      "",
      `<details${e.counts.DEFINITE ? " open" : ""}><summary>Affected frontend code (${sites.length})</summary>`,
      "",
      "| Confidence | Location | Code | Why |",
      "|---|---|---|---|",
      ...sites.map((site) =>
        `| ${site.confidence} | ${code(`${site.file}:${site.line}`)}${who(site.functionName, site.component)} | ${code(site.code)} | ${cell(site.reason)} |`,
      ),
      "",
      "</details>",
    );
  }
  return lines.join("\n");
}

export function renderContractReportMarkdown(report: ContractReport, title = "ApiLens: frontend contract check"): string {
  const c = report.counts;
  const scope = report.scope ? `${report.scope.length} changed file${s(report.scope.length)}` : "whole frontend";
  const lines = [
    `## ${title}: ${report.result}`,
    "",
    `**${report.apis.length} API${s(report.apis.length)} checked (${scope}) · ${c.error} error${s(c.error)}, ${c.warning} warning${s(c.warning)}, ${c.info} info**`,
  ];
  if (report.issues.length === 0) return [...lines, "", "Every checked API usage matches the backend contract."].join("\n");
  lines.push("", "| Severity | Location | Issue | Code |", "|---|---|---|---|");
  for (const i of report.issues) {
    const message = i.suggestion ? `${i.message}. ${i.suggestion}` : i.message;
    lines.push(`| ${i.severity} | ${code(`${i.file}:${i.line}`)} | ${cell(message)} | ${code(i.snippet)} |`);
  }
  return lines.join("\n");
}

/** Plain table cell text: pipes escaped, kept on one line. */
function cell(text: string): string {
  return text.replace(/\|/g, "\\|").replace(/\n/g, " ");
}

/** Code span that may itself contain backticks (CommonMark: fence with a longer backtick run). */
function code(text: string): string {
  const longest = Math.max(0, ...(text.match(/`+/g) ?? []).map((run) => run.length));
  const fence = "`".repeat(longest + 1);
  const pad = longest > 0 ? " " : "";
  return `${fence}${pad}${cell(text)}${pad}${fence}`;
}

function who(fn: string | null, component: string | null): string {
  const name = component && fn && component !== fn ? `${component} › ${fn}` : component ?? fn;
  return name ? ` ${cell(name)}` : "";
}

function s(n: number): string {
  return n === 1 ? "" : "s";
}
