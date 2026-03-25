"""Platform-specific Playwright intercept handlers and dispatcher."""

import json
from typing import Any, Optional
from urllib.parse import quote

from fastapi import HTTPException

from core.config import (
    GENERIC_INTERCEPT_INTENTS,
    GENERIC_INTERCEPT_TARGET_URL,
    SCRIPT_REGISTRY,
)
from core.intercept.bbc import run_bbc_intent
from core.intercept.bilibili import run_bilibili_intent
from core.intercept.hackernews import run_hackernews_intent
from core.intercept.linkedin import run_linkedin_intent
from core.intercept.linux_do import run_linux_do_intent
from core.intercept.reddit import run_reddit_intent
from core.intercept.weibo import run_weibo_intent
from core.intercept.x import run_x_intent, run_x_search
from core.intercept.xhs import run_xhs_intent
from core.intercept.youtube import run_youtube_intent
from core.intercept.zhihu import run_zhihu_intent
from core.playwright_runner import (
    extract_runtime_options,
    normalize_playwright_eval_result,
    run_playwright_script,
)
from libs.script_framework import build_x_intent_script
from schemas import CleanItem, FetchRequest

_MODE_PREFIX_MAP: list[tuple[str, set[str], Any]] = [
    ("intercept-x-", {"x", "twitter"}, lambda r, i: run_x_intent(r, i)),
    ("intercept-reddit-", {"reddit"}, lambda r, i: run_reddit_intent(r, i)),
    ("intercept-xhs-", {"xhs", "xiaohongshu"}, lambda r, i: run_xhs_intent(r, i)),
    ("intercept-bbc-", {"bbc"}, lambda r, i: run_bbc_intent(r, i)),
    ("intercept-hackernews-", {"hackernews", "hn"}, lambda r, i: run_hackernews_intent(r, i)),
    ("intercept-hn-", {"hackernews", "hn"}, lambda r, i: run_hackernews_intent(r, i)),
    ("intercept-linkedin-", {"linkedin"}, lambda r, i: run_linkedin_intent(r, i)),
    ("intercept-linux-do-", {"linux-do", "linuxdo"}, lambda r, i: run_linux_do_intent(r, i)),
    ("intercept-linuxdo-", {"linux-do", "linuxdo"}, lambda r, i: run_linux_do_intent(r, i)),
    ("intercept-youtube-", {"youtube"}, lambda r, i: run_youtube_intent(r, i)),
    ("intercept-weibo-", {"weibo"}, lambda r, i: run_weibo_intent(r, i)),
    ("intercept-zhihu-", {"zhihu"}, lambda r, i: run_zhihu_intent(r, i)),
    ("intercept-bilibili-", {"bilibili"}, lambda r, i: run_bilibili_intent(r, i)),
]

_GENERIC_PLATFORMS = {
    "36kr", "arxiv", "baidu", "bing", "cnblogs", "csdn", "ctrip",
    "devto", "duckduckgo", "google", "reuters", "toutiao", "hupu",
}


async def dispatch_intercept(
    platform: str,
    mode: str,
    request: FetchRequest,
) -> Optional[list[CleanItem]]:
    """Parse the mode string and route to the correct intercept handler.

    Returns ``None`` if ``mode`` doesn't match any intercept pattern, so the
    caller can fall through to eval-js or raise an error.
    """
    p = (platform or "").strip().lower()
    m = (mode or "").strip().lower()

    if m in {"opencli-bridge", "opencli-search"} and p in {"x", "twitter"}:
        raise HTTPException(
            status_code=400,
            detail="playwright mode opencli-bridge/opencli-search has been removed; please use intercept-x-search",
        )

    if m in {"intercept-x-search", "intercept-search"} and p in {"x", "twitter"}:
        return await run_x_search(request)

    for prefix, platforms, handler in _MODE_PREFIX_MAP:
        if m.startswith(prefix) and p in platforms:
            intent_type = m.removeprefix(prefix).strip().lower()
            return await handler(request, intent_type)

    for gp in _GENERIC_PLATFORMS:
        if m.startswith(f"intercept-{gp}-") and p == gp:
            intent_type = m.removeprefix(f"intercept-{gp}-").strip().lower()
            return await run_generic_intent(request, intent_type, platform=gp)

    return None


# ---------------------------------------------------------------------------
# Generic intercept (for platforms with a uniform handler shape)
# ---------------------------------------------------------------------------

async def run_generic_intent(
    request: FetchRequest,
    intent_type: str,
    platform: str,
) -> list[CleanItem]:
    from playwright.async_api import TimeoutError as PlaywrightTimeoutError

    normalized_platform = (platform or "").strip().lower()
    supported_intents = GENERIC_INTERCEPT_INTENTS.get(normalized_platform, set())
    if not supported_intents:
        raise HTTPException(status_code=400, detail=f"unsupported generic intercept platform: {normalized_platform}")

    config = request.config if isinstance(request.config, dict) else {}
    playwright_options = config.get("playwright")
    if not isinstance(playwright_options, dict):
        raise HTTPException(status_code=400, detail="config.playwright must be an object")

    args = playwright_options.get("args", {})
    args_obj = args if isinstance(args, dict) else {}
    normalized_intent = (intent_type or "").strip().lower()
    if normalized_intent not in supported_intents:
        raise HTTPException(status_code=400, detail=f"unsupported {normalized_platform} intercept intent: {normalized_intent}")

    query = str(args_obj.get("query", args_obj.get("keyword", ""))).strip()
    if normalized_intent == "search" and not query:
        raise HTTPException(status_code=400, detail=f"config.playwright.args.query is required for intercept-{normalized_platform}-search mode")

    raw_limit = args_obj.get("limit", args_obj.get("count", 20))
    raw_page = args_obj.get("page", 1)
    raw_order = str(args_obj.get("order", "totalrank")).strip()
    raw_type = str(args_obj.get("type", "all")).strip()
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

    runtime_options = extract_runtime_options(request, config, playwright_options)
    target_url = GENERIC_INTERCEPT_TARGET_URL.get(normalized_platform, "https://example.com")
    if normalized_platform == "arxiv" and normalized_intent == "search" and query:
        target_url = f"https://arxiv.org/search/?query={quote(query)}&searchtype=all&source=header"
    if normalized_platform == "google" and normalized_intent == "search" and query:
        target_url = f"https://www.google.com/search?q={quote(query)}&num={limit}"
    if normalized_platform == "cnblogs" and normalized_intent == "search" and query:
        target_url = f"https://zzk.cnblogs.com/s?w={quote(query)}&p={page}"
    if normalized_platform == "toutiao" and normalized_intent == "search" and query:
        target_url = f"https://so.toutiao.com/search?keyword={quote(query)}&pd=information&dvpf=pc"
    if normalized_platform == "toutiao" and normalized_intent == "hot":
        target_url = "https://www.toutiao.com/hot-event/hot-board/?origin=toutiao_pc"
    if normalized_platform == "devto" and normalized_intent == "search" and query:
        target_url = f"https://dev.to/search?q={quote(query)}"
    if normalized_platform == "reuters" and normalized_intent == "search" and query:
        target_url = f"https://www.reuters.com/site-search/?query={quote(query)}&offset=0"

    script_to_run = build_x_intent_script(
        SCRIPT_REGISTRY,
        normalized_intent,
        {
            "__QUERY_JSON__": json.dumps(query, ensure_ascii=False),
            "__KEYWORD_JSON__": json.dumps(query, ensure_ascii=False),
            "__ORDER_JSON__": json.dumps(raw_order, ensure_ascii=False),
            "__TYPE_JSON__": json.dumps(raw_type, ensure_ascii=False),
            "__PAGE__": page,
            "__COUNT__": limit,
            "__LIMIT__": limit,
        },
        platform=normalized_platform,
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
        raise HTTPException(status_code=504, detail=f"playwright intercept {normalized_platform} timeout: {error}") from error
    except HTTPException:
        raise
    except Exception as error:
        raise HTTPException(status_code=500, detail=f"playwright intercept {normalized_platform} {normalized_intent} failed: {error}") from error

    items = normalize_playwright_eval_result(eval_result, request, target_url)
    if not items:
        raise HTTPException(status_code=500, detail=f"playwright intercept {normalized_platform} {normalized_intent} finished without output")
    return items
