"""Weibo intercept handlers."""

import json

from fastapi import HTTPException

from core.config import SCRIPT_REGISTRY, WEIBO_INTERCEPT_INTENTS
from core.playwright_runner import extract_runtime_options, normalize_playwright_eval_result, run_playwright_script
from libs.script_framework import build_x_intent_script
from schemas import CleanItem, FetchRequest


async def run_weibo_intent(request: FetchRequest, intent_type: str) -> list[CleanItem]:
    from playwright.async_api import TimeoutError as PlaywrightTimeoutError

    config = request.config if isinstance(request.config, dict) else {}
    playwright_options = config.get("playwright")
    if not isinstance(playwright_options, dict):
        raise HTTPException(status_code=400, detail="config.playwright must be an object")

    args = playwright_options.get("args", {})
    args_obj = args if isinstance(args, dict) else {}
    normalized_intent = (intent_type or "").strip().lower()
    if normalized_intent not in WEIBO_INTERCEPT_INTENTS:
        raise HTTPException(status_code=400, detail=f"unsupported weibo intercept intent: {normalized_intent}")

    weibo_id = str(args_obj.get("id", "")).strip()
    weibo_uid = str(args_obj.get("uid", args_obj.get("id", ""))).strip()
    max_id = str(args_obj.get("max_id", "")).strip()
    try:
        page = int(args_obj.get("page", 1))
    except (TypeError, ValueError):
        page = 1
    page = max(1, min(page, 100))
    try:
        feature = int(args_obj.get("feature", 0))
    except (TypeError, ValueError):
        feature = 0
    feature = max(0, min(feature, 10))

    if normalized_intent in {"comments", "post", "user"} and not weibo_id:
        raise HTTPException(status_code=400, detail=f"config.playwright.args.id is required for intercept-weibo-{normalized_intent} mode")
    if normalized_intent == "user_posts" and not weibo_uid:
        raise HTTPException(status_code=400, detail="config.playwright.args.uid is required for intercept-weibo-user_posts mode")

    raw_limit = args_obj.get("limit", args_obj.get("count", 20))
    try:
        limit = int(raw_limit)
    except (TypeError, ValueError):
        limit = 20
    limit = max(1, min(limit, 100))

    runtime_options = extract_runtime_options(request, config, playwright_options)
    target_url = "https://weibo.com"

    script_to_run = build_x_intent_script(
        SCRIPT_REGISTRY,
        normalized_intent,
        {
            "__WEIBO_ID_JSON__": json.dumps(weibo_id, ensure_ascii=False),
            "__WEIBO_UID_JSON__": json.dumps(weibo_uid, ensure_ascii=False),
            "__MAX_ID_JSON__": json.dumps(max_id, ensure_ascii=False),
            "__PAGE__": page,
            "__FEATURE__": feature,
            "__COUNT__": limit,
            "__LIMIT__": limit,
        },
        platform="weibo",
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
        raise HTTPException(status_code=504, detail=f"playwright intercept weibo timeout: {error}") from error
    except HTTPException:
        raise
    except Exception as error:
        raise HTTPException(status_code=500, detail=f"playwright intercept weibo {normalized_intent} failed: {error}") from error

    items = normalize_playwright_eval_result(eval_result, request, target_url)
    if not items:
        raise HTTPException(status_code=500, detail=f"playwright intercept weibo {normalized_intent} finished without output")
    return items
