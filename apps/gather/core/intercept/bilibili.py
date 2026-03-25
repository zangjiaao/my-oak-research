"""Bilibili intercept handlers."""

import json
from urllib.parse import quote

from fastapi import HTTPException

from core.config import BILIBILI_INTERCEPT_INTENTS, SCRIPT_REGISTRY
from core.playwright_runner import extract_runtime_options, normalize_playwright_eval_result, run_playwright_script
from libs.script_framework import build_x_intent_script
from schemas import CleanItem, FetchRequest


async def run_bilibili_intent(request: FetchRequest, intent_type: str) -> list[CleanItem]:
    from playwright.async_api import TimeoutError as PlaywrightTimeoutError

    config = request.config if isinstance(request.config, dict) else {}
    playwright_options = config.get("playwright")
    if not isinstance(playwright_options, dict):
        raise HTTPException(status_code=400, detail="config.playwright must be an object")

    args = playwright_options.get("args", {})
    args_obj = args if isinstance(args, dict) else {}
    normalized_intent = (intent_type or "").strip().lower()
    if normalized_intent not in BILIBILI_INTERCEPT_INTENTS:
        raise HTTPException(status_code=400, detail=f"unsupported bilibili intercept intent: {normalized_intent}")

    keyword = str(args_obj.get("keyword", args_obj.get("query", ""))).strip()
    bvid = str(args_obj.get("bvid", "")).strip()
    raw_order = str(args_obj.get("order", "totalrank")).strip().lower()
    order = raw_order if raw_order in {"totalrank", "click", "pubdate", "dm", "stow"} else "totalrank"
    raw_type = str(args_obj.get("type", "all")).strip().lower()
    feed_type = raw_type if raw_type in {"all", "video", "article", "draw"} else "all"
    raw_limit = args_obj.get("limit", args_obj.get("count", 20))
    raw_page = args_obj.get("page", 1)
    raw_sort = args_obj.get("sort", 2)
    raw_category = args_obj.get("category", 0)

    try:
        limit = int(raw_limit)
    except (TypeError, ValueError):
        limit = 20
    limit = max(1, min(limit, 100))

    try:
        page = int(raw_page)
    except (TypeError, ValueError):
        page = 1
    page = max(1, min(page, 1000))

    try:
        sort = int(raw_sort)
    except (TypeError, ValueError):
        sort = 2
    if sort not in {0, 2}:
        sort = 2

    try:
        category = int(raw_category)
    except (TypeError, ValueError):
        category = 0
    category = max(0, min(category, 9999))

    if normalized_intent == "search" and not keyword:
        raise HTTPException(status_code=400, detail="config.playwright.args.keyword or config.playwright.args.query is required for intercept-bilibili-search mode")
    if normalized_intent in {"video", "comments"} and not bvid:
        raise HTTPException(status_code=400, detail=f"config.playwright.args.bvid is required for intercept-bilibili-{normalized_intent} mode")

    runtime_options = extract_runtime_options(request, config, playwright_options)

    if normalized_intent == "search" and keyword:
        target_url = f"https://search.bilibili.com/all?keyword={quote(keyword)}"
    elif normalized_intent in {"video", "comments"} and bvid:
        target_url = f"https://www.bilibili.com/video/{quote(bvid)}"
    else:
        target_url = "https://www.bilibili.com"

    script_to_run = build_x_intent_script(
        SCRIPT_REGISTRY,
        normalized_intent,
        {
            "__KEYWORD_JSON__": json.dumps(keyword, ensure_ascii=False),
            "__BVID_JSON__": json.dumps(bvid, ensure_ascii=False),
            "__ORDER_JSON__": json.dumps(order, ensure_ascii=False),
            "__TYPE_JSON__": json.dumps(feed_type, ensure_ascii=False),
            "__PAGE__": page,
            "__SORT__": sort,
            "__CATEGORY_ID__": category,
            "__COUNT__": limit,
            "__LIMIT__": limit,
        },
        platform="bilibili",
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
        raise HTTPException(status_code=504, detail=f"playwright intercept bilibili timeout: {error}") from error
    except HTTPException:
        raise
    except Exception as error:
        raise HTTPException(status_code=500, detail=f"playwright intercept bilibili {normalized_intent} failed: {error}") from error

    items = normalize_playwright_eval_result(eval_result, request, target_url)
    if not items:
        raise HTTPException(status_code=500, detail=f"playwright intercept bilibili {normalized_intent} finished without output")
    return items
