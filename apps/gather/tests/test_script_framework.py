from pathlib import Path
import sys


sys.path.append(str(Path(__file__).resolve().parents[1]))

from script_framework import ScriptContext, ScriptRegistry, build_x_search_intercept_script  # noqa: E402


def test_script_registry_resolve_x_search_intercept():
    root = Path(__file__).resolve().parents[1] / "scripts"
    registry = ScriptRegistry(root)
    spec = registry.resolve(ScriptContext(platform="x", intent="search", mode="intercept", args={}))
    assert spec is not None
    assert spec.key == "x.search.intercept"
    assert spec.file_path.exists()


def test_build_x_search_intercept_script_renders_placeholders():
    root = Path(__file__).resolve().parents[1] / "scripts"
    registry = ScriptRegistry(root)
    script = build_x_search_intercept_script(
        registry=registry,
        query="openai",
        search_type="latest",
        count=20,
        scroll_times=3,
    )
    assert "__QUERY_JSON__" not in script
    assert "__PRODUCT_JSON__" not in script
    assert "__COUNT__" not in script
    assert "__SCROLL_TIMES__" not in script
    assert '"openai"' in script
    assert '"Latest"' in script
