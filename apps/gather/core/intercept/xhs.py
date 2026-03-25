"""Xiaohongshu intercept handlers."""

import json
from typing import Any
from urllib.parse import quote

from fastapi import HTTPException

from core.config import SCRIPT_REGISTRY, XHS_INTERCEPT_INTENTS
from core.intercept.x import _build_x_intercept_bootstrap_script
from core.playwright_runner import extract_runtime_options, normalize_playwright_eval_result, run_playwright_script
from libs.script_framework import build_x_intent_script
from schemas import CleanItem, FetchRequest


def _normalize_xhs_user_id(raw: Any) -> str:
    if not isinstance(raw, str):
        return ""
    return raw.strip().lstrip("@")


async def run_xhs_intent(request: FetchRequest, intent_type: str) -> list[CleanItem]:
    from playwright.async_api import TimeoutError as PlaywrightTimeoutError

    config = request.config if isinstance(request.config, dict) else {}
    playwright_options = config.get("playwright")
    if not isinstance(playwright_options, dict):
        raise HTTPException(status_code=400, detail="config.playwright must be an object")

    args = playwright_options.get("args", {})
    args_obj = args if isinstance(args, dict) else {}
    normalized_intent = (intent_type or "").strip().lower()
    if normalized_intent not in XHS_INTERCEPT_INTENTS:
        raise HTTPException(status_code=400, detail=f"unsupported xhs intercept intent: {normalized_intent}")

    query = str(args_obj.get("query", args_obj.get("keyword", ""))).strip()
    user_id = _normalize_xhs_user_id(args_obj.get("id", args_obj.get("user_id", "")))
    notification_type = str(args_obj.get("type", "mentions")).strip().lower() or "mentions"
    raw_limit = args_obj.get("limit", args_obj.get("count", 20))
    try:
        limit = int(raw_limit)
    except (TypeError, ValueError):
        limit = 20
    limit = max(1, min(limit, 100))

    if normalized_intent == "search" and not query:
        raise HTTPException(status_code=400, detail="config.playwright.args.query is required for intercept-xhs-search mode")
    if normalized_intent == "user" and not user_id:
        raise HTTPException(status_code=400, detail="config.playwright.args.id is required for intercept-xhs-user mode")

    runtime_options = extract_runtime_options(request, config, playwright_options)
    if normalized_intent == "search":
        target_url = f"https://www.xiaohongshu.com/search_result?keyword={quote(query)}&source=web_search_result_notes"
    elif normalized_intent == "user":
        target_url = f"https://www.xiaohongshu.com/user/profile/{quote(user_id)}"
    elif normalized_intent == "notifications":
        target_url = "https://www.xiaohongshu.com/notification"
    else:
        target_url = "https://www.xiaohongshu.com/explore"

    scroll_times = max(1, min(10, (limit + 9) // 10))
    script_to_run = build_x_intent_script(
        SCRIPT_REGISTRY,
        normalized_intent,
        {
            "__QUERY_JSON__": json.dumps(query, ensure_ascii=False),
            "__XHS_USER_ID_JSON__": json.dumps(user_id, ensure_ascii=False),
            "__NOTIFICATION_TYPE_JSON__": json.dumps(notification_type, ensure_ascii=False),
            "__LIMIT__": limit,
            "__COUNT__": limit,
            "__SCROLL_TIMES__": scroll_times,
        },
        platform="xhs",
    )

    try:
        bootstrap_capture_key = {"feed": "homefeed", "user": "v1/user/posted", "notifications": "/you/"}.get(normalized_intent)
        init_script = _build_x_intercept_bootstrap_script(bootstrap_capture_key) if bootstrap_capture_key else None
        eval_result = await run_playwright_script(
            request,
            runtime_options,
            target_url=target_url,
            script_to_run=script_to_run,
            post_navigation_wait_ms=1200,
            init_script=init_script,
        )
    except PlaywrightTimeoutError as error:
        raise HTTPException(status_code=504, detail=f"playwright intercept xhs timeout: {error}") from error
    except HTTPException:
        raise
    except Exception as error:
        raise HTTPException(status_code=500, detail=f"playwright intercept xhs {normalized_intent} failed: {error}") from error

    items = normalize_playwright_eval_result(eval_result, request, target_url)
    if not items:
        raise HTTPException(status_code=500, detail=f"playwright intercept xhs {normalized_intent} finished without output")
    return items
