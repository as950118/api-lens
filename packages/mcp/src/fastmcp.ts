import type { z } from "zod";
import { createTacetTools, type TacetToolOptions } from "./tools.js";

/** The subset of a fastmcp tool Tacet provides; fastmcp accepts any Standard Schema (zod) for `parameters`. */
export interface FastMCPToolDefinition {
  name: string;
  description: string;
  parameters: z.ZodType;
  annotations: { title: string; readOnlyHint: boolean; openWorldHint: boolean };
  execute: (args: unknown) => Promise<string>;
}

/** Anything with fastmcp's `addTool` (the `fastmcp` npm package's FastMCP class). */
export interface FastMCPLike {
  addTool(tool: FastMCPToolDefinition): void;
}

export interface AddTacetToolsOptions extends TacetToolOptions {
  /** Prepended to every tool name, e.g. "tacet_" to avoid clashes with the host's own tools. */
  prefix?: string;
}

/**
 * Registers the Tacet tools on an existing fastmcp server:
 *
 *   const server = new FastMCP({ name: "my-server", version: "1.0.0" });
 *   addTacetTools(server, { frontendDir: "./frontend", backendDir: "./backend" });
 */
export function addTacetTools(server: FastMCPLike, options: AddTacetToolsOptions = {}): string[] {
  const names: string[] = [];
  for (const tool of createTacetTools(options)) {
    const name = `${options.prefix ?? ""}${tool.name}`;
    server.addTool({
      name,
      description: tool.description,
      parameters: tool.parameters,
      annotations: { title: tool.title, readOnlyHint: tool.readOnly, openWorldHint: false },
      // fastmcp has already validated `args` against `parameters`.
      execute: async (args: unknown) => JSON.stringify(await tool.run(args as never), null, 2),
    });
    names.push(name);
  }
  return names;
}
