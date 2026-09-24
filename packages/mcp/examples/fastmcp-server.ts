// Adding ApiLens to an existing TypeScript fastmcp server.
import { FastMCP } from "fastmcp";
import { addApiLensTools } from "@apilens/mcp";

const server = new FastMCP({ name: "my-dev-tools", version: "1.0.0" });

// ...the server's own tools...

addApiLensTools(server, {
  indexPath: ".apilens/index.db",
  frontendDir: "./frontend",
  backendDir: "./backend",
  prefix: "apilens_",
});

await server.start({ transportType: "stdio" });
