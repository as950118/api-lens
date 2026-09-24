# apilens (Python)

Python bindings for [ApiLens](../README.md): check a TypeScript frontend against a Spring Boot API and see what
an API, file or field change would affect, plus ready-made tools for [FastMCP](https://gofastmcp.com).

The package drives the ApiLens CLI (`--format json`), so the machine running it needs Node.js 22.13+
(and Java 17+ for `extract_backend`). Point it at the CLI with `APILENS_CLI` or put `apilens` on `PATH`.

```python
from apilens import ApiLens

lens = ApiLens(index=".apilens/index.db", frontend_dir="./frontend", backend_dir="./backend")
lens.index_frontend()
lens.extract_backend()

report = lens.check(changed_since="origin/main")      # PASS / WARNING / FAIL + issues with file:line
lens.impact_of_api("GET /users/{id}", graph="mermaid")
lens.impact_of_file("src/api/user.ts")
lens.impact_of_field("UserResponse.name")
```

## FastMCP

```python
from fastmcp import FastMCP
from apilens.fastmcp import register_tools

mcp = FastMCP("my-server")
register_tools(mcp, frontend_dir="./frontend", backend_dir="./backend", prefix="apilens_")
mcp.run()
```

Tools: `index_frontend`, `extract_backend`, `check_contract`, `impact_of_api`, `impact_of_file`,
`impact_of_field`, `search`, `impact_summary`, `render_graph`.

## Tests

```bash
npm run build && npm run build:jar   # from the repository root
uv run --group dev pytest
```
