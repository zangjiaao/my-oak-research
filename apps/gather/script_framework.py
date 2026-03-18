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
        self._specs = {
            "x.search.intercept": ScriptSpec(
                key="x.search.intercept",
                platform="x",
                intent="search",
                mode="intercept",
                source_path=source_root / "twitter" / "search.ts",
                runtime_path=self._runtime_root / "twitter" / "search.js",
            ),
            "x.profile.intercept": ScriptSpec(
                key="x.profile.intercept",
                platform="x",
                intent="profile",
                mode="intercept",
                source_path=source_root / "twitter" / "profile.ts",
                runtime_path=self._runtime_root / "twitter" / "profile.js",
            ),
            "x.timeline.intercept": ScriptSpec(
                key="x.timeline.intercept",
                platform="x",
                intent="timeline",
                mode="intercept",
                source_path=source_root / "twitter" / "timeline.ts",
                runtime_path=self._runtime_root / "twitter" / "timeline.js",
            ),
            "x.bookmarks.intercept": ScriptSpec(
                key="x.bookmarks.intercept",
                platform="x",
                intent="bookmarks",
                mode="intercept",
                source_path=source_root / "twitter" / "bookmarks.ts",
                runtime_path=self._runtime_root / "twitter" / "bookmarks.js",
            ),
            "x.notifications.intercept": ScriptSpec(
                key="x.notifications.intercept",
                platform="x",
                intent="notifications",
                mode="intercept",
                source_path=source_root / "twitter" / "notifications.ts",
                runtime_path=self._runtime_root / "twitter" / "notifications.js",
            ),
            "x.followers.intercept": ScriptSpec(
                key="x.followers.intercept",
                platform="x",
                intent="followers",
                mode="intercept",
                source_path=source_root / "twitter" / "followers.ts",
                runtime_path=self._runtime_root / "twitter" / "followers.js",
            ),
            "x.following.intercept": ScriptSpec(
                key="x.following.intercept",
                platform="x",
                intent="following",
                mode="intercept",
                source_path=source_root / "twitter" / "following.ts",
                runtime_path=self._runtime_root / "twitter" / "following.js",
            ),
            "x.thread.intercept": ScriptSpec(
                key="x.thread.intercept",
                platform="x",
                intent="thread",
                mode="intercept",
                source_path=source_root / "twitter" / "thread.ts",
                runtime_path=self._runtime_root / "twitter" / "thread.js",
            ),
            "x.article.intercept": ScriptSpec(
                key="x.article.intercept",
                platform="x",
                intent="article",
                mode="intercept",
                source_path=source_root / "twitter" / "article.ts",
                runtime_path=self._runtime_root / "twitter" / "article.js",
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

    def resolve_key(self, key: str) -> ScriptSpec | None:
        return self._specs.get(key)

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
) -> str:
    key = f"x.{intent_type}.intercept"
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
