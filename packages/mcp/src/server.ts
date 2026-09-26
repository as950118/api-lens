import { readFileSync } from "node:fs";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { createTacetTools, type TacetToolOptions } from "./tools.js";

export const SERVER_NAME = "tacet";
export const SERVER_VERSION: string = JSON.parse(
  readFileSync(new URL("../package.json", import.meta.url), "utf8"),
).version;

/** A standalone MCP server (official SDK) exposing every Tacet tool. Connect it to any transport. */
export function createTacetMcpServer(options: TacetToolOptions = {}): McpServer {
  const server = new McpServer(
    { name: SERVER_NAME, version: SERVER_VERSION },
    {
      instructions:
        "Tacet links a TypeScript frontend to a Spring Boot backend. Typical flow: index_frontend and extract_backend " +
        "(once, then again after edits with `files`), check_contract to verify frontend code against the real API, " +
        "impact_of_api / impact_of_file / impact_of_field to see what a change would affect before making it.",
    },
  );
  for (const tool of createTacetTools(options)) {
    server.registerTool(
      tool.name,
      {
        title: tool.title,
        description: tool.description,
        inputSchema: tool.parameters.shape,
        annotations: { readOnlyHint: tool.readOnly, openWorldHint: false },
      },
      async (args: Record<string, unknown>) => {
        try {
          const result = await tool.run(args as never);
          return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
        } catch (err) {
          return { isError: true, content: [{ type: "text" as const, text: (err as Error).message }] };
        }
      },
    );
  }
  return server;
}
