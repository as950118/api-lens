import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { z } from "zod";
import { attachGraph, mergeGraphs, renderHtml, renderMermaid } from "@apilens/core";
import { ApiLensWorkspace } from "@apilens/cli";

export interface ApiLensToolOptions {
  /** Index database. Defaults to .apilens/index.db (relative to the server's cwd). */
  indexPath?: string;
  configPath?: string;
  /** Default frontend root, so clients can call index_frontend without knowing paths. */
  frontendDir?: string;
  /** Default backend root for extract_backend. */
  backendDir?: string;
  /** Share a workspace with the host (it keeps the parsed frontend in memory between calls). */
  workspace?: ApiLensWorkspace;
}

export interface ApiLensTool<Shape extends z.ZodRawShape = z.ZodRawShape> {
  name: string;
  title: string;
  description: string;
  parameters: z.ZodObject<Shape>;
  readOnly: boolean;
  /** Returns a JSON-serializable result. */
  run(args: z.infer<z.ZodObject<Shape>>): Promise<unknown>;
}

const graphOption = z
  .enum(["none", "mermaid", "json"])
  .default("none")
  .describe('Attach the impact graph: "mermaid" (compact text), "json" (nodes/edges), or "none"');

/** Framework-neutral ApiLens tool definitions (zod schemas + JSON-returning handlers). */
export function createApiLensTools(options: ApiLensToolOptions = {}): ApiLensTool[] {
  const ws = options.workspace ?? new ApiLensWorkspace(options.indexPath, options.configPath);
  const frontendDir = (dir?: string) => required(dir ?? options.frontendDir, "frontendDir");
  const backendDir = (dir?: string) => required(dir ?? options.backendDir, "backendDir");

  return [
    tool({
      name: "index_frontend",
      title: "Index the frontend",
      description:
        "Analyze the TypeScript frontend and update the ApiLens index. Pass `files` (or `changedSince`, a git ref) " +
        "after editing code to get the APIs those files use; only changed index records are rewritten.",
      parameters: {
        frontendDir: z.string().optional().describe("Frontend root (defaults to the server's configured frontend)"),
        files: z.array(z.string()).optional().describe("Changed files, relative to the frontend root or absolute"),
        changedSince: z.string().optional().describe("Git ref; use the TS files changed since it"),
      },
      readOnly: false,
      run: (a) => ws.indexFrontend(frontendDir(a.frontendDir), { files: a.files, changedSince: a.changedSince }),
    }),
    tool({
      name: "extract_backend",
      title: "Extract the backend API contract",
      description: "Extract endpoints and DTOs from the Spring Boot backend sources into the index (requires Java 17+).",
      parameters: {
        backendDir: z.string().optional().describe("Backend root (defaults to the server's configured backend)"),
      },
      readOnly: false,
      run: (a) => ws.extractBackend(backendDir(a.backendDir)),
    }),
    tool({
      name: "check_contract",
      title: "Check frontend against the API contract",
      description:
        "Verify frontend API usage against the real backend contract: endpoint exists for the method, response fields " +
        "read by the frontend exist (with typo suggestions), array/object shape, request body and query keys. " +
        "Limit to changed code with `files` or `changedSince`. Returns PASS/WARNING/FAIL with file:line evidence.",
      parameters: {
        files: z.array(z.string()).optional().describe("Only APIs used by these frontend files"),
        changedSince: z.string().optional().describe("Only APIs used by TS files changed since this git ref"),
      },
      readOnly: true,
      run: async (a) => ws.check({ files: a.files, changedSince: a.changedSince }),
    }),
    tool({
      name: "impact_of_api",
      title: "Impact of changing an API",
      description:
        'Everything in the frontend that depends on an API, without changing anything: call sites (including through ' +
        'API client functions), response fields read and where, files and components. `api` accepts "GET /users/{id}", ' +
        '"GET /users/:id", or a path alone for all methods.',
      parameters: { api: z.string().describe('e.g. "GET /users/{id}"'), graph: graphOption },
      readOnly: true,
      run: async (a) => ws.impact().impactOfApi(a.api).map((i) => attachGraph(i, a.graph)),
    }),
    tool({
      name: "impact_of_file",
      title: "Impact of changing a frontend file",
      description:
        "What a change to this frontend file can affect: APIs it calls or reads, API client functions defined in it and " +
        "their callers, files importing it, and the blast radius (APIs, files, components).",
      parameters: { file: z.string().describe("Frontend file, relative to the frontend root or absolute"), graph: graphOption },
      readOnly: true,
      run: async (a) => attachGraph(ws.impact().impactOfFile(ws.toIndexPath(a.file)), a.graph),
    }),
    tool({
      name: "impact_of_field",
      title: "Impact of changing a response field",
      description:
        'Every endpoint that returns a DTO field and every frontend location reading it. `field` is "UserResponse.name", ' +
        'a nested path like "UserResponse.profile.email", or a fully qualified name.',
      parameters: { field: z.string().describe('e.g. "UserResponse.name"'), graph: graphOption },
      readOnly: true,
      run: async (a) => ws.impact().impactOfField(a.field).map((i) => attachGraph(i, a.graph)),
    }),
    tool({
      name: "search",
      title: "Search the ApiLens index",
      description: "Search APIs, frontend files, functions, components, DTOs and fields; each hit reports how many APIs and files it touches.",
      parameters: { query: z.string().describe("Case-insensitive substring") },
      readOnly: true,
      run: async (a) => ws.impact().search(a.query),
    }),
    tool({
      name: "impact_summary",
      title: "Impact overview",
      description: "Rank every API by the number of frontend files and components using it, rank files by APIs used, and list backend endpoints no frontend code calls.",
      parameters: {},
      readOnly: true,
      run: async () => ws.impact().summary(),
    }),
    tool({
      name: "render_graph",
      title: "Render the impact graph",
      description:
        "Render the API → field → function/component → file graph, for the whole project or one api/file/field. " +
        '"mermaid" returns flowchart text; "html" writes an interactive page to `outPath` and returns its path.',
      parameters: {
        format: z.enum(["mermaid", "html"]).default("mermaid"),
        api: z.string().optional(),
        file: z.string().optional(),
        field: z.string().optional(),
        outPath: z.string().optional().describe("HTML output path (default .apilens/graph.html)"),
      },
      readOnly: false,
      run: async (a) => {
        const analyzer = ws.impact();
        const graph = a.api
          ? mergeGraphs(analyzer.impactOfApi(a.api).map((i) => i.graph))
          : a.file
            ? analyzer.impactOfFile(ws.toIndexPath(a.file)).graph
            : a.field
              ? mergeGraphs(analyzer.impactOfField(a.field).map((i) => i.graph))
              : analyzer.fullGraph();
        if (a.format === "mermaid") return { mermaid: renderMermaid(graph) };
        const out = resolve(a.outPath ?? ".apilens/graph.html");
        mkdirSync(dirname(out), { recursive: true });
        writeFileSync(out, renderHtml(graph, { title: `ApiLens: ${a.api ?? a.file ?? a.field ?? "impact graph"}` }));
        return { path: out, nodes: graph.nodes.length, edges: graph.edges.length };
      },
    }),
  ];
}

function tool<Shape extends z.ZodRawShape>(definition: {
  name: string;
  title: string;
  description: string;
  parameters: Shape;
  readOnly: boolean;
  run: (args: z.infer<z.ZodObject<Shape>>) => Promise<unknown>;
}): ApiLensTool {
  return {
    ...definition,
    parameters: z.object(definition.parameters),
    // Always reject asynchronously, even when argument defaults are missing.
    run: async (args: z.infer<z.ZodObject<Shape>>) => definition.run(args),
  } as unknown as ApiLensTool;
}

function required(value: string | undefined, name: string): string {
  if (!value) throw new Error(`\`${name}\` is required (no default was configured for this server)`);
  return value;
}
