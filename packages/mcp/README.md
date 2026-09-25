# @apilens/mcp

[ApiLens](https://github.com/heonjinjeong/api-lens) as MCP tools: check a TypeScript frontend against a Spring Boot API,
and see what an API, file or field change would affect.

**Standalone stdio server**

```json
{
  "mcpServers": {
    "apilens": {
      "command": "npx",
      "args": ["-y", "@apilens/mcp", "--index", "/abs/project/.apilens/index.db",
               "--frontend", "/abs/project/frontend", "--backend", "/abs/project/backend"]
    }
  }
}
```

**Add to an existing fastmcp server**

```ts
import { FastMCP } from "fastmcp";
import { addApiLensTools } from "@apilens/mcp";

const server = new FastMCP({ name: "my-tools", version: "1.0.0" });
addApiLensTools(server, { frontendDir: "./frontend", backendDir: "./backend", prefix: "apilens_" });
```

Other frameworks: `createApiLensTools()` returns framework-neutral definitions (zod schema + JSON handler).
