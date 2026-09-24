#!/usr/bin/env node
import { parseArgs } from "node:util";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createApiLensMcpServer } from "./server.js";

const { values } = parseArgs({
  options: {
    index: { type: "string", short: "i" },
    config: { type: "string", short: "c" },
    frontend: { type: "string" },
    backend: { type: "string" },
    help: { type: "boolean", short: "h" },
  },
});

if (values.help) {
  // stderr: stdout is reserved for the MCP protocol.
  console.error(
    "Usage: apilens-mcp [--index .apilens/index.db] [--config apilens.config.json] [--frontend dir] [--backend dir]\n" +
      "Env fallbacks: APILENS_INDEX, APILENS_CONFIG, APILENS_FRONTEND, APILENS_BACKEND",
  );
  process.exit(0);
}

const server = createApiLensMcpServer({
  indexPath: values.index ?? process.env.APILENS_INDEX,
  configPath: values.config ?? process.env.APILENS_CONFIG,
  frontendDir: values.frontend ?? process.env.APILENS_FRONTEND,
  backendDir: values.backend ?? process.env.APILENS_BACKEND,
});
await server.connect(new StdioServerTransport());
