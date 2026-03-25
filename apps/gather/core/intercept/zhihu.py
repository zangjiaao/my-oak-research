"""Zhihu intercept handlers."""

import json
from urllib.parse import quote

from fastapi import HTTPException

from core.config import SCRIPT_REGISTRY, ZHIHU_INTERCEPT_INTENTS
from core.playwright_runner import extract_runtime_options, normalize_playwright_eval_result, run_playwright_script
from libs.script_framework import build_x_intent_script
from schemas import CleanItem, FetchRequest


async def run_zhihu_intent(request: FetchRequest, intent_type: str) -> list[CleanItem]:
    from playwright.async_api import TimeoutError as PlaywrightTimeoutError

    config = request.config if isinstance(request.config, dict) else {}
    playwright_options = config.get("playwright")
    if not isinstance(playwright_options, dict):
        raise HTTPException(status_code=400, detail="config.playwright must be an object")

    args = playwright_options.get("args", {})
    args_obj = args if isinstance(args, dict) else {}
    normalized_intent = (intent_type or "").strip().lower()
    if normalized_intent not in ZHIHU_INTERCEPT_INTENTS:
        raise HTTPException(status_code=400, detail=f"unsupported zhihu intercept intent: {normalized_intent}")

    query = str(args_obj.get("keyword", args_obj.get("query", ""))).strip()
    question_id = str(args_obj.get("id", "")).strip()
    raw_limit = args_obj.get("limit", args_obj.get("count", 20))
    try:
        limit = int(raw_limit)
    except (TypeError, ValueError):
        limit = 20
    limit = max(1, min(limit, 100))

    if normalized_intent == "question" and not question_id:
        raise HTTPException(status_code=400, detail="config.playwright.args.id is required for intercept-zhihu-question mode")
    if normalized_intent == "search" and not query:
        raise HTTPException(status_code=400, detail="config.playwright.args.keyword or config.playwright.args.query is required for intercept-zhihu-search mode")

    runtime_options = extract_runtime_options(request, config, playwright_options)
    if normalized_intent == "search" and query:
        target_url = f"https://www.zhihu.com/search?type=content&q={quote(query)}"
    elif normalized_intent == "hot":
        target_url = "https://www.zhihu.com/hot"
    elif normalized_intent == "question" and question_id:
        target_url = f"https://www.zhihu.com/question/{quote(question_id)}"
    else:
        target_url = "https://www.zhihu.com"

    script_to_run = build_x_intent_script(
        SCRIPT_REGISTRY,
        normalized_intent,
        {
            "__KEYWORD_JSON__": json.dumps(query, ensure_ascii=False),
            "__QUESTION_ID_JSON__": json.dumps(question_id, ensure_ascii=False),
            "__COUNT__": limit,
            "__LIMIT__": limit,
        },
        platform="zhihu",
    )

    try:
        eval_result = await run_playwright_script(
            request,
            runtime_options,
            target_url=target_url,
            script_to_run=script_to_run,
            post_navigation_wait_ms=1200,
        )
    except PlaywrightTimeoutError as error:
        raise HTTPException(status_code=504, detail=f"playwright intercept zhihu timeout: {error}") from error
    except HTTPException:
        raise
    except Exception as error:
        raise HTTPException(status_code=500, detail=f"playwright intercept zhihu {normalized_intent} failed: {error}") from error

    items = normalize_playwright_eval_result(eval_result, request, target_url)
    if not items:
        raise HTTPException(status_code=500, detail=f"playwright intercept zhihu {normalized_intent} finished without output")
    return items
