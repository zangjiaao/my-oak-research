"""YouTube intercept handlers."""

import json
from urllib.parse import quote

from fastapi import HTTPException

from core.config import SCRIPT_REGISTRY, YOUTUBE_INTERCEPT_INTENTS
from core.playwright_runner import extract_runtime_options, normalize_playwright_eval_result, run_playwright_script
from libs.script_framework import build_x_intent_script
from schemas import CleanItem, FetchRequest


async def run_youtube_intent(request: FetchRequest, intent_type: str) -> list[CleanItem]:
    from playwright.async_api import TimeoutError as PlaywrightTimeoutError

    config = request.config if isinstance(request.config, dict) else {}
    playwright_options = config.get("playwright")
    if not isinstance(playwright_options, dict):
        raise HTTPException(status_code=400, detail="config.playwright must be an object")

    args = playwright_options.get("args", {})
    args_obj = args if isinstance(args, dict) else {}
    normalized_intent = (intent_type or "").strip().lower()
    if normalized_intent not in YOUTUBE_INTERCEPT_INTENTS:
        raise HTTPException(status_code=400, detail=f"unsupported youtube intercept intent: {normalized_intent}")

    query = str(args_obj.get("query", "")).strip()
    raw_url = str(args_obj.get("url", args_obj.get("video_url", args_obj.get("videoId", args_obj.get("video_id", ""))))).strip()
    channel_id = str(args_obj.get("id", args_obj.get("channel_id", ""))).strip()
    lang = str(args_obj.get("lang", "")).strip()
    mode = str(args_obj.get("mode", "grouped")).strip().lower() or "grouped"
    if normalized_intent == "search" and not query:
        raise HTTPException(status_code=400, detail="config.playwright.args.query is required for intercept-youtube-search mode")
    if normalized_intent in {"video", "transcript"} and not raw_url:
        raise HTTPException(status_code=400, detail=f"config.playwright.args.url is required for intercept-youtube-{normalized_intent} mode")

    raw_limit = args_obj.get("limit", args_obj.get("count", 20))
    try:
        limit = int(raw_limit)
    except (TypeError, ValueError):
        limit = 20
    limit = max(1, min(limit, 100))

    runtime_options = extract_runtime_options(request, config, playwright_options)

    if normalized_intent == "search":
        target_url = "https://www.youtube.com"
    elif normalized_intent in {"video", "transcript"}:
        target_url = raw_url if raw_url.startswith("http") else f"https://www.youtube.com/watch?v={quote(raw_url)}"
    elif normalized_intent == "channel":
        if channel_id:
            if channel_id.startswith("@"):
                target_url = f"https://www.youtube.com/{quote(channel_id)}"
            elif channel_id.startswith("UC"):
                target_url = f"https://www.youtube.com/channel/{quote(channel_id)}"
            else:
                target_url = f"https://www.youtube.com/{quote(channel_id)}"
        else:
            target_url = "https://www.youtube.com"
    else:
        target_url = "https://www.youtube.com"

    script_to_run = build_x_intent_script(
        SCRIPT_REGISTRY,
        normalized_intent,
        {
            "__QUERY_JSON__": json.dumps(query, ensure_ascii=False),
            "__URL_JSON__": json.dumps(raw_url, ensure_ascii=False),
            "__CHANNEL_ID_JSON__": json.dumps(channel_id, ensure_ascii=False),
            "__LANG_JSON__": json.dumps(lang, ensure_ascii=False),
            "__MODE_JSON__": json.dumps(mode, ensure_ascii=False),
            "__LIMIT__": limit,
            "__COUNT__": limit,
        },
        platform="youtube",
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
        raise HTTPException(status_code=504, detail=f"playwright intercept youtube timeout: {error}") from error
    except HTTPException:
        raise
    except Exception as error:
        raise HTTPException(status_code=500, detail=f"playwright intercept youtube {normalized_intent} failed: {error}") from error

    items = normalize_playwright_eval_result(eval_result, request, target_url)
    if not items:
        raise HTTPException(status_code=500, detail=f"playwright intercept youtube {normalized_intent} finished without output")
    return items
