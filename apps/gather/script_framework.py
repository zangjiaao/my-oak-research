from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Any, Dict
import json


@dataclass(frozen=True)
class ScriptContext:
    platform: str
    intent: str
    mode: str
    args: Dict[str, Any]


@dataclass(frozen=True)
class ScriptSpec:
    key: str
    platform: str
    intent: str
    mode: str
    file_path: Path


class ScriptRegistry:
    def __init__(self, root: Path):
        self._root = root
        self._specs = {
            "x.search.intercept": ScriptSpec(
                key="x.search.intercept",
                platform="x",
                intent="search",
                mode="intercept",
                file_path=root / "x" / "search" / "intercept.js",
            ),
        }

    def resolve(self, ctx: ScriptContext) -> ScriptSpec | None:
        normalized_platform = ctx.platform.strip().lower()
        normalized_intent = ctx.intent.strip().lower()
        normalized_mode = ctx.mode.strip().lower()
        for spec in self._specs.values():
            if (
                spec.platform == normalized_platform
                and spec.intent == normalized_intent
                and spec.mode == normalized_mode
            ):
                return spec
        return None

    def render(self, spec: ScriptSpec, replacements: Dict[str, Any]) -> str:
        if not spec.file_path.exists() or not spec.file_path.is_file():
            raise FileNotFoundError(f"script file not found: {spec.file_path}")
        content = spec.file_path.read_text(encoding="utf-8")
        rendered = content
        for key, value in replacements.items():
            rendered = rendered.replace(key, str(value))
        return rendered


def build_x_search_intercept_script(
    registry: ScriptRegistry,
    query: str,
    search_type: str,
    count: int,
    scroll_times: int,
) -> str:
    ctx = ScriptContext(platform="x", intent="search", mode="intercept", args={})
    spec = registry.resolve(ctx)
    if spec is None:
        raise ValueError("x.search.intercept script spec not found")
    product = "Top" if search_type == "top" else "Latest"
    return registry.render(
        spec,
        {
            "__QUERY_JSON__": json.dumps(query, ensure_ascii=False),
            "__PRODUCT_JSON__": json.dumps(product, ensure_ascii=False),
            "__COUNT__": count,
            "__SCROLL_TIMES__": scroll_times,
        },
    )
