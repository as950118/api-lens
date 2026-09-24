import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { Command, Option } from "commander";
import { renderHtml, renderMermaid, type ContractReport, type ImpactGraph } from "@apilens/core";
import {
  formatApiImpact,
  formatBackendResult,
  formatContractReport,
  formatFieldImpact,
  formatFileImpact,
  formatIndexResult,
  formatSearch,
  formatSummary,
} from "./format.js";
import { ApiLensWorkspace, DEFAULT_INDEX_PATH } from "./workspace.js";

type Format = "text" | "json" | "mermaid" | "html";
type FailOn = "error" | "warning" | "never";

const formatOption = (choices: Format[], fallback: Format) =>
  new Option("-f, --format <format>", "output format").choices(choices).default(fallback);
const failOnOption = () =>
  new Option("--fail-on <level>", "exit with code 1 when issues at this level exist")
    .choices(["error", "warning", "never"])
    .default("error");

export function buildProgram(): Command {
  const program = new Command();
  program
    .name("apilens")
    .description("Find the frontend code affected by backend API changes, and check frontend code against the real API")
    .version("0.1.0")
    .option("-i, --index <path>", "index database", DEFAULT_INDEX_PATH)
    .option("-c, --config <path>", "apilens.config.json (defaults to <frontendDir>/apilens.config.json at index time)");

  const workspace = () => {
    const opts = program.opts<{ index: string; config?: string }>();
    return new ApiLensWorkspace(opts.index, opts.config);
  };

  program
    .command("index")
    .description("Analyze a TypeScript frontend and update the index (only changed records are rewritten)")
    .argument("<frontendDir>", "frontend project root")
    .option("--files <files...>", "files that changed: report the APIs they use")
    .option("--changed-since <ref>", "use the TS files changed since this git ref as --files")
    .option("--check", "also check the changed files against the backend contract")
    .addOption(failOnOption())
    .option("-m, --manifest <path>", "also write the extracted manifest as JSON")
    .action(async (frontendDir: string, opts: { files?: string[]; changedSince?: string; check?: boolean; failOn: FailOn; manifest?: string }) => {
      const ws = workspace();
      const result = await ws.indexFrontend(frontendDir, {
        files: opts.files,
        changedSince: opts.changedSince,
        manifestPath: opts.manifest,
      });
      console.log(formatIndexResult(result));
      if (opts.check) {
        const report = ws.check({ files: result.scope ?? undefined });
        console.log(`\n${formatContractReport(report)}`);
        setExitCode(report, opts.failOn);
      }
    });

  program
    .command("extract-backend")
    .description("Extract the API contract (endpoints, DTOs) from a Spring Boot backend into the index")
    .argument("<backendDir>", "backend project root")
    .option("-o, --out <path>", "also write the backend manifest as JSON")
    .option("--jar <path>", "Java extractor JAR (defaults to the bundled one)")
    .action(async (backendDir: string, opts: { out?: string; jar?: string }) => {
      const result = await workspace().extractBackend(backendDir, { outPath: opts.out, jarPath: opts.jar });
      console.log(formatBackendResult(result, opts.out));
    });

  program
    .command("check")
    .description("Check frontend API usage against the backend contract (endpoints, methods, fields, params)")
    .option("--files <files...>", "only APIs used by these files")
    .option("--changed-since <ref>", "only APIs used by TS files changed since this git ref")
    .addOption(formatOption(["text", "json"], "text"))
    .addOption(failOnOption())
    .action((opts: { files?: string[]; changedSince?: string; format: Format; failOn: FailOn }) => {
      const report = workspace().check({ files: opts.files, changedSince: opts.changedSince });
      console.log(opts.format === "json" ? JSON.stringify(report, null, 2) : formatContractReport(report));
      setExitCode(report, opts.failOn);
    });

  program
    .command("impact")
    .description("Show what a change would affect, without changing anything")
    .option("--api <api>", 'an API, e.g. "GET /users/{id}" or "/users/{id}"')
    .option("--file <file>", "a frontend file")
    .option("--field <field>", 'a response field, e.g. "UserResponse.name"')
    .option("--search <text>", "search APIs, files, functions, components, DTOs and fields")
    .option("--summary", "rank every API and file by impact")
    .addOption(formatOption(["text", "json", "mermaid", "html"], "text"))
    .option("-o, --out <path>", "write the output to a file")
    .action((opts: { api?: string; file?: string; field?: string; search?: string; summary?: boolean; format: Format; out?: string }) => {
      const ws = workspace();
      const analyzer = ws.impact();
      let value: unknown;
      let text: string;
      let graph: ImpactGraph | null = null;
      let title: string;
      if (opts.api) {
        const impacts = analyzer.impactOfApi(opts.api);
        value = impacts;
        text = formatApiImpact(impacts, opts.api);
        graph = mergeGraphs(impacts.map((i) => i.graph));
        title = `Impact of ${opts.api}`;
      } else if (opts.file) {
        const impact = analyzer.impactOfFile(ws.toIndexPath(opts.file));
        value = impact;
        text = formatFileImpact(impact);
        graph = impact.graph;
        title = `Impact of changing ${impact.file}`;
      } else if (opts.field) {
        const impacts = analyzer.impactOfField(opts.field);
        value = impacts;
        text = formatFieldImpact(impacts, opts.field);
        graph = mergeGraphs(impacts.map((i) => i.graph));
        title = `Impact of ${opts.field}`;
      } else if (opts.search) {
        const hits = analyzer.search(opts.search);
        value = hits;
        text = formatSearch(hits, opts.search);
        title = `Search: ${opts.search}`;
      } else if (opts.summary) {
        const summary = analyzer.summary();
        value = summary;
        text = formatSummary(summary);
        graph = analyzer.fullGraph();
        title = "ApiLens impact overview";
      } else {
        throw new Error("Specify one of --api, --file, --field, --search or --summary");
      }
      emit(render(opts.format, { value, text, graph, title }), opts.out);
    });

  program
    .command("graph")
    .description("Render the full API → field → function → component → file graph")
    .addOption(formatOption(["html", "mermaid", "json"], "html"))
    .option("-o, --out <path>", "output file (default .apilens/graph.html for html)")
    .action((opts: { format: Format; out?: string }) => {
      const analyzer = workspace().impact();
      const graph = analyzer.fullGraph();
      const out = opts.out ?? (opts.format === "html" ? ".apilens/graph.html" : undefined);
      emit(render(opts.format, { value: graph, text: "", graph, title: "ApiLens impact graph" }), out);
    });

  for (const [name, phase, description] of [
    ["analyze", 5, "Analyze backend API changes against the frontend index"],
    ["diff", 7, "Detect changed APIs between two git revisions"],
    ["verify", 6, "Run static analysis + AI verification"],
  ] as const) {
    program
      .command(name)
      .description(`${description} (not implemented yet - Phase ${phase})`)
      .allowUnknownOption()
      .action(() => {
        console.error(`apilens ${name} is not implemented yet (planned for Phase ${phase}).`);
        process.exitCode = 2;
      });
  }

  return program;
}

function render(
  format: Format,
  r: { value: unknown; text: string; graph: ImpactGraph | null; title: string },
): string {
  if (format === "json") return JSON.stringify(r.value, null, 2);
  if (format === "text") return r.text;
  if (!r.graph) throw new Error(`--format ${format} needs a graph; use it with --api, --file, --field or --summary`);
  return format === "mermaid" ? renderMermaid(r.graph) : renderHtml(r.graph, { title: r.title });
}

function emit(output: string, out?: string): void {
  if (!out) {
    console.log(output);
    return;
  }
  mkdirSync(dirname(resolve(out)), { recursive: true });
  writeFileSync(out, output);
  console.log(`Wrote ${resolve(out)}`);
}

function mergeGraphs(graphs: ImpactGraph[]): ImpactGraph {
  const nodes = new Map(graphs.flatMap((g) => g.nodes).map((n) => [n.id, n]));
  const edges = new Map(graphs.flatMap((g) => g.edges).map((e) => [`${e.from}->${e.to}`, e]));
  return { nodes: [...nodes.values()], edges: [...edges.values()] };
}

function setExitCode(report: ContractReport, failOn: FailOn): void {
  const failing =
    (failOn === "error" && report.counts.error > 0) ||
    (failOn === "warning" && report.counts.error + report.counts.warning > 0);
  if (failing) process.exitCode = 1;
}
