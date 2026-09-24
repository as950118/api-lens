import asyncio
import json

import pytest

from apilens import ApiLens, ApiLensError
from conftest import requires_backend, requires_cli


@pytest.fixture
def lens(lens_options):
    return ApiLens(**lens_options)


@requires_cli
def test_index_frontend_reports_summary(lens):
    result = lens.index_frontend()
    assert result["summary"]["apiCalls"] == 15
    assert result["scope"] is None


@requires_backend
class TestWithBackend:
    @pytest.fixture(autouse=True)
    def indexed(self, lens):
        lens.index_frontend()
        lens.extract_backend()

    def test_check_contract(self, lens):
        report = lens.check()
        assert report["result"] == "FAIL"
        assert report["counts"] == {"error": 5, "warning": 2, "info": 0}
        assert lens.check(files=["src/pages/Product.tsx"])["result"] == "PASS"

    def test_index_with_check_returns_both(self, lens):
        result = lens.index_frontend(files=["src/pages/UserAdmin.tsx"], check=True)
        assert result["scope"] == ["src/pages/UserAdmin.tsx"]
        assert result["check"]["result"] == "FAIL"

    def test_impact_queries(self, lens):
        [impact] = lens.impact_of_api("GET /users/{id}", graph="mermaid")
        assert len(impact["files"]) == 4
        assert "graph" not in impact
        assert impact["mermaid"].startswith("flowchart LR")

        assert lens.impact_of_file("src/api/user.ts")["dependents"] == [
            "src/pages/User.tsx",
            "src/pages/UserAdmin.tsx",
            "src/pages/UserList.tsx",
        ]
        assert lens.impact_of_field("UserResponse.name")[0]["dtoId"] == "com.example.user.UserResponse"
        assert any(hit["label"] == "UserCard" for hit in lens.search("UserCard"))
        assert "GET /users/summary" in lens.summary()["unusedEndpoints"]

    def test_render_graph(self, lens, tmp_path):
        assert lens.render_graph(api="GET /products/{id}").startswith("flowchart LR")
        path = lens.render_graph("html", out=tmp_path / "graph.html")
        assert "<title>ApiLens impact graph</title>" in open(path, encoding="utf-8").read()

    def test_fastmcp_tools(self, lens):
        fastmcp = pytest.importorskip("fastmcp")
        from apilens.fastmcp import register_tools

        mcp = fastmcp.FastMCP("host")

        @mcp.tool
        def host_tool() -> str:
            return "ok"

        names = register_tools(mcp, lens, prefix="apilens_")
        assert len(names) == 9

        async def run():
            async with fastmcp.Client(mcp) as client:
                tools = {t.name: t for t in await client.list_tools()}
                assert set(tools) == {"host_tool", *names}
                annotations = tools["apilens_check_contract"].annotations
                assert getattr(annotations, "read_only_hint", None) is True or annotations.readOnlyHint is True
                result = await client.call_tool("apilens_check_contract", {"files": ["src/pages/Product.tsx"]})
                return json.loads(result.content[0].text)

        assert asyncio.run(run())["result"] == "PASS"


@requires_cli
def test_cli_errors_become_exceptions(tmp_path):
    with pytest.raises(ApiLensError, match="No frontend index"):
        ApiLens(index=tmp_path / "empty.db").summary()


def test_missing_directory_is_reported(tmp_path):
    with pytest.raises(ApiLensError, match="frontend_dir"):
        ApiLens(index=tmp_path / "x.db").index_frontend()


def test_missing_cli_is_reported(tmp_path, monkeypatch):
    monkeypatch.delenv("APILENS_CLI")
    monkeypatch.setenv("PATH", str(tmp_path))
    with pytest.raises(ApiLensError, match="CLI not found"):
        ApiLens(index=tmp_path / "x.db").summary()
