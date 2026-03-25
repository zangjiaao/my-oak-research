"""linux.do intercept handlers."""

import json

from fastapi import HTTPException

from core.config import LINUX_DO_INTERCEPT_INTENTS, SCRIPT_REGISTRY
from core.playwright_runner import extract_runtime_options, normalize_playwright_eval_result, run_playwright_script
from libs.script_framework import build_x_intent_script
from schemas import CleanItem, FetchRequest


async def run_linux_do_intent(request: FetchRequest, intent_type: str) -> list[CleanItem]:
    from playwright.async_api import TimeoutError as PlaywrightTimeoutError

    config = request.config if isinstance(request.config, dict) else {}
    playwright_options = config.get("playwright")
    if not isinstance(playwright_options, dict):
        raise HTTPException(status_code=400, detail="config.playwright must be an object")

    args = playwright_options.get("args", {})
    args_obj = args if isinstance(args, dict) else {}
    normalized_intent = (intent_type or "").strip().lower()
    if normalized_intent not in LINUX_DO_INTERCEPT_INTENTS:
        raise HTTPException(status_code=400, detail=f"unsupported linux-do intercept intent: {normalized_intent}")

    keyword = str(args_obj.get("keyword", args_obj.get("query", ""))).strip()
    slug = str(args_obj.get("slug", "")).strip()
    raw_period = str(args_obj.get("period", "weekly")).strip().lower()
    period = raw_period if raw_period in {"all", "daily", "weekly", "monthly", "yearly"} else "weekly"
    raw_category_id = args_obj.get("id", args_obj.get("category_id"))
    raw_topic_id = args_obj.get("id", args_obj.get("topic_id"))

    try:
        category_id = int(raw_category_id)
    except (TypeError, ValueError):
        category_id = 0
    try:
        topic_id = int(raw_topic_id)
    except (TypeError, ValueError):
        topic_id = 0

    if normalized_intent == "search" and not keyword:
        raise HTTPException(status_code=400, detail="config.playwright.args.keyword is required for intercept-linux-do-search mode")
    if normalized_intent == "category":
        if not slug:
            raise HTTPException(status_code=400, detail="config.playwright.args.slug is required for intercept-linux-do-category mode")
        if category_id <= 0:
            raise HTTPException(status_code=400, detail="config.playwright.args.id is required for intercept-linux-do-category mode")
    if normalized_intent == "topic" and topic_id <= 0:
        raise HTTPException(status_code=400, detail="config.playwright.args.id is required for intercept-linux-do-topic mode")

    raw_limit = args_obj.get("limit", args_obj.get("count", 20))
    try:
        limit = int(raw_limit)
    except (TypeError, ValueError):
        limit = 20
    limit = max(1, min(limit, 100))

    runtime_options = extract_runtime_options(request, config, playwright_options)
    target_url = "https://linux.do"

    script_to_run = build_x_intent_script(
        SCRIPT_REGISTRY,
        normalized_intent,
        {
            "__KEYWORD_JSON__": json.dumps(keyword, ensure_ascii=False),
            "__SLUG_JSON__": json.dumps(slug, ensure_ascii=False),
            "__PERIOD_JSON__": json.dumps(period, ensure_ascii=False),
            "__CATEGORY_ID__": category_id,
            "__TOPIC_ID__": topic_id,
            "__LIMIT__": limit,
            "__COUNT__": limit,
        },
        platform="linux-do",
    )

    try:
        eval_result = await run_playwright_script(
            request,
            runtime_options,
            target_url=target_url,
            script_to_run=script_to_run,
            post_navigation_wait_ms=1000,
        )
    except PlaywrightTimeoutError as error:
        raise HTTPException(status_code=504, detail=f"playwright intercept linux-do timeout: {error}") from error
    except HTTPException:
        raise
    except Exception as error:
        raise HTTPException(status_code=500, detail=f"playwright intercept linux-do {normalized_intent} failed: {error}") from error

    items = normalize_playwright_eval_result(eval_result, request, target_url)
    if not items:
        raise HTTPException(status_code=500, detail=f"playwright intercept linux-do {normalized_intent} finished without output")
    return items
