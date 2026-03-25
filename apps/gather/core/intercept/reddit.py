"""Reddit intercept handlers."""

import json
from typing import Any
from urllib.parse import quote

from fastapi import HTTPException

from core.config import REDDIT_INTERCEPT_INTENTS, SCRIPT_REGISTRY
from core.playwright_runner import extract_runtime_options, normalize_playwright_eval_result, run_playwright_script
from libs.script_framework import build_x_intent_script
from schemas import CleanItem, FetchRequest


def _normalize_reddit_username(raw: Any) -> str:
    if not isinstance(raw, str):
        return ""
    username = raw.strip()
    if not username:
        return ""
    if username.lower().startswith("u/"):
        return username[2:]
    return username.lstrip("@")


async def run_reddit_intent(request: FetchRequest, intent_type: str) -> list[CleanItem]:
    from playwright.async_api import TimeoutError as PlaywrightTimeoutError

    config = request.config if isinstance(request.config, dict) else {}
    playwright_options = config.get("playwright")
    if not isinstance(playwright_options, dict):
        raise HTTPException(status_code=400, detail="config.playwright must be an object")

    args = playwright_options.get("args", {})
    args_obj = args if isinstance(args, dict) else {}
    normalized_intent = (intent_type or "").strip().lower()
    if normalized_intent not in REDDIT_INTERCEPT_INTENTS:
        raise HTTPException(status_code=400, detail=f"unsupported reddit intercept intent: {normalized_intent}")

    query = str(args_obj.get("query", "")).strip()
    subreddit_name = str(args_obj.get("subreddit", args_obj.get("name", ""))).strip()
    if subreddit_name.lower().startswith("r/"):
        subreddit_name = subreddit_name[2:]
    username = _normalize_reddit_username(args_obj.get("username"))
    sort_value = str(args_obj.get("sort", "relevance")).strip().lower() or "relevance"
    time_value = str(args_obj.get("time", "all")).strip().lower() or "all"

    if normalized_intent == "search" and not query:
        raise HTTPException(status_code=400, detail="config.playwright.args.query is required for intercept-reddit-search mode")
    if normalized_intent == "subreddit" and not subreddit_name:
        raise HTTPException(status_code=400, detail="config.playwright.args.subreddit (or name) is required for intercept-reddit-subreddit mode")
    if normalized_intent in {"user", "user-posts", "user-comments"} and not username:
        raise HTTPException(status_code=400, detail=f"config.playwright.args.username is required for intercept-reddit-{normalized_intent} mode")

    raw_limit = args_obj.get("limit", args_obj.get("count", 20))
    try:
        limit = int(raw_limit)
    except (TypeError, ValueError):
        limit = 20
    limit = max(1, min(limit, 100))
    runtime_options = extract_runtime_options(request, config, playwright_options)

    if normalized_intent == "search":
        target_url = f"https://www.reddit.com/search/?q={quote(query)}"
    elif normalized_intent == "subreddit":
        target_url = f"https://www.reddit.com/r/{quote(subreddit_name)}/"
    elif normalized_intent == "hot":
        target_url = f"https://www.reddit.com/r/{quote(subreddit_name)}/hot" if subreddit_name else "https://www.reddit.com/hot"
    elif normalized_intent == "frontpage":
        target_url = "https://www.reddit.com/r/all"
    elif normalized_intent == "popular":
        target_url = "https://www.reddit.com/r/popular"
    elif normalized_intent == "user":
        target_url = f"https://www.reddit.com/user/{quote(username)}"
    elif normalized_intent == "user-posts":
        target_url = f"https://www.reddit.com/user/{quote(username)}/submitted"
    elif normalized_intent == "user-comments":
        target_url = f"https://www.reddit.com/user/{quote(username)}/comments"
    else:
        target_url = "https://www.reddit.com"

    script_to_run = build_x_intent_script(
        SCRIPT_REGISTRY,
        normalized_intent,
        {
            "__QUERY_JSON__": json.dumps(query, ensure_ascii=False),
            "__SUBREDDIT_JSON__": json.dumps(subreddit_name, ensure_ascii=False),
            "__SORT_JSON__": json.dumps(sort_value, ensure_ascii=False),
            "__TIME_JSON__": json.dumps(time_value, ensure_ascii=False),
            "__USERNAME_JSON__": json.dumps(username, ensure_ascii=False),
            "__LIMIT__": limit,
            "__COUNT__": limit,
        },
        platform="reddit",
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
        raise HTTPException(status_code=504, detail=f"playwright intercept reddit timeout: {error}") from error
    except HTTPException:
        raise
    except Exception as error:
        raise HTTPException(status_code=500, detail=f"playwright intercept reddit {normalized_intent} failed: {error}") from error

    items = normalize_playwright_eval_result(eval_result, request, target_url)
    if not items:
        raise HTTPException(status_code=500, detail=f"playwright intercept reddit {normalized_intent} finished without output")
    return items
