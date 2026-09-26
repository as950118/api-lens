import os
import shutil
from pathlib import Path

import pytest

REPO = Path(__file__).resolve().parents[2]
FIXTURES = REPO / "test" / "fixtures"
CLI = REPO / "packages" / "cli" / "dist" / "bin.js"
JAR = REPO / "packages" / "extractor-java" / "jvm" / "build" / "libs" / "tacet-java-extractor.jar"

requires_cli = pytest.mark.skipif(not CLI.exists(), reason="build the CLI first: npm run build")
requires_backend = pytest.mark.skipif(
    not (CLI.exists() and JAR.exists() and shutil.which("java")), reason="needs the CLI, the extractor JAR and Java"
)


@pytest.fixture(autouse=True)
def cli_env(monkeypatch):
    monkeypatch.setenv("TACET_CLI", f'"{shutil.which("node") or "node"}" "{CLI}"')


@pytest.fixture
def lens_options(tmp_path):
    return {
        "index": tmp_path / "index.db",
        "frontend_dir": FIXTURES / "frontend",
        "backend_dir": FIXTURES / "backend",
        "config": FIXTURES / "tacet.config.json",
    }
