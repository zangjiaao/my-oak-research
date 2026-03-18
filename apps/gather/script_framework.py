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
    source_path: Path
    runtime_path: Path


class ScriptRegistry:
    def __init__(self, source_root: Path, runtime_root: Path | None = None):
        self._source_root = source_root
        self._runtime_root = runtime_root or source_root
        self._platform_alias = {
            "twitter": "x",
            "x": "x",
        }
        self._specs = self._discover_specs()

    def _normalize_platform(self, raw_platform: str) -> str:
        return self._platform_alias.get(raw_platform, raw_platform)

    def _discover_specs(self) -> dict[str, ScriptSpec]:
        specs: dict[str, ScriptSpec] = {}
        if not self._source_root.exists():
            return specs
        for source_path in sorted(self._source_root.glob("*/*.ts")):
            if not source_path.is_file():
                continue
            platform_dir = source_path.parent.name.strip().lower()
            intent = source_path.stem.strip().lower()
            if not platform_dir or not intent:
                continue
            platform = self._normalize_platform(platform_dir)
            key = f"{platform}.{intent}.intercept"
            if key in specs:
                continue
            specs[key] = ScriptSpec(
                key=key,
                platform=platform,
                intent=intent,
                mode="intercept",
                source_path=source_path,
                runtime_path=self._runtime_root / platform_dir / f"{intent}.js",
            )
        return specs

    def resolve(self, ctx: ScriptContext) -> ScriptSpec | None:
        normalized_platform = self._normalize_platform(ctx.platform.strip().lower())
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

    def resolve_key(self, key: str) -> ScriptSpec | None:
        return self._specs.get(key)

    def intents_for(self, platform: str, mode: str = "intercept") -> set[str]:
        normalized_platform = self._normalize_platform(platform.strip().lower())
        normalized_mode = mode.strip().lower()
        return {
            spec.intent
            for spec in self._specs.values()
            if spec.platform == normalized_platform and spec.mode == normalized_mode
        }

    def render(self, spec: ScriptSpec, replacements: Dict[str, Any]) -> str:
        file_path = spec.runtime_path if spec.runtime_path.exists() else spec.source_path
        if not file_path.exists() or not file_path.is_file():
            raise FileNotFoundError(f"script file not found: {file_path}")
        content = file_path.read_text(encoding="utf-8")
        rendered = content
        for key, value in replacements.items():
            rendered = rendered.replace(key, str(value))
        return rendered


def build_x_intent_script(
    registry: ScriptRegistry,
    intent_type: str,
    replacements: Dict[str, Any],
    platform: str = "x",
) -> str:
    key = f"{platform}.{intent_type}.intercept"
    spec = registry.resolve_key(key)
    if spec is None:
        raise ValueError(f"{key} script spec not found")
    return registry.render(spec, replacements)


def build_x_search_intercept_script(
    registry: ScriptRegistry,
    query: str,
    search_type: str,
    count: int,
    scroll_times: int,
) -> str:
    product = "Top" if search_type == "top" else "Latest"
    return build_x_intent_script(
        registry,
        "search",
        {
            "__QUERY_JSON__": json.dumps(query, ensure_ascii=False),
            "__PRODUCT_JSON__": json.dumps(product, ensure_ascii=False),
            "__COUNT__": count,
            "__SCROLL_TIMES__": scroll_times,
        },
    )
