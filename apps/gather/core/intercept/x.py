"""Twitter/X intercept handlers."""

import json
from urllib.parse import quote

from fastapi import HTTPException

from core.config import SCRIPT_REGISTRY, X_INTERCEPT_INTENTS
from core.normalize import extract_tweet_id
from core.playwright_runner import (
    extract_runtime_options,
    normalize_playwright_eval_result,
    run_playwright_script,
)
from libs.script_framework import build_x_intent_script, build_x_search_intercept_script
from schemas import CleanItem, FetchRequest


def _build_x_intercept_bootstrap_script(capture_key: str) -> str:
    return f"""
(() => {{
  const CAPTURE_KEY = {json.dumps(capture_key)};
  if (window.__oakGatherCapture) return;
  window.__oakGatherCapture = [];
  const pushCapture = (url, payload) => {{
    if (!url || !String(url).includes(CAPTURE_KEY)) return;
    if (!payload || typeof payload !== "object") return;
    window.__oakGatherCapture.push(payload);
  }};

  const origFetch = window.fetch.bind(window);
  window.fetch = async (...fetchArgs) => {{
    const response = await origFetch(...fetchArgs);
    try {{
      const reqUrl =
        typeof fetchArgs[0] === "string"
          ? fetchArgs[0]
          : (fetchArgs[0] && fetchArgs[0].url) || "";
      if (reqUrl.includes(CAPTURE_KEY)) {{
        const cloned = response.clone();
        const data = await cloned.json();
        pushCapture(reqUrl, data);
      }}
    }} catch (_error) {{}}
    return response;
  }};

  const xhrOpen = XMLHttpRequest.prototype.open;
  const xhrSend = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.open = function (method, url) {{
    this.__oakGatherUrl = String(url || "");
    return xhrOpen.apply(this, arguments);
  }};
  XMLHttpRequest.prototype.send = function () {{
    if (this.__oakGatherUrl && this.__oakGatherUrl.includes(CAPTURE_KEY)) {{
      this.addEventListener("load", function () {{
        try {{
          const payload = JSON.parse(this.responseText);
          pushCapture(this.__oakGatherUrl, payload);
        }} catch (_error) {{}}
      }});
    }}
    return xhrSend.apply(this, arguments);
  }};
}})();
"""


async def run_x_intent(request: FetchRequest, intent_type: str) -> list[CleanItem]:
    from playwright.async_api import TimeoutError as PlaywrightTimeoutError

    config = request.config if isinstance(request.config, dict) else {}
    playwright_options = config.get("playwright")
    if not isinstance(playwright_options, dict):
        raise HTTPException(status_code=400, detail="config.playwright must be an object")

    args = playwright_options.get("args", {})
    args_obj = args if isinstance(args, dict) else {}
    normalized_intent = (intent_type or "").strip().lower()
    if normalized_intent not in X_INTERCEPT_INTENTS:
        raise HTTPException(status_code=400, detail=f"unsupported x intercept intent: {normalized_intent}")

    query = str(args_obj.get("query", "")).strip()
    username = str(args_obj.get("username", "")).strip()
    tweet_id = extract_tweet_id(args_obj.get("tweet_id"))

    if normalized_intent == "search" and not query:
        raise HTTPException(status_code=400, detail="config.playwright.args.query is required for intercept-x-search mode")
    if normalized_intent in {"profile", "followers", "following", "tweets"} and not username:
        raise HTTPException(status_code=400, detail=f"config.playwright.args.username is required for intercept-x-{normalized_intent} mode")
    if normalized_intent in {"thread", "article"} and not tweet_id:
        raise HTTPException(status_code=400, detail=f"config.playwright.args.tweet_id is required for intercept-x-{normalized_intent} mode")

    raw_count = args_obj.get("count")
    if raw_count is None:
        raw_count = args_obj.get("limit", 30)
    try:
        count = int(raw_count)
    except (TypeError, ValueError):
        count = 30
    count = max(1, min(count, 100))
    raw_type = str(args_obj.get("type", "latest")).strip().lower()
    search_type = "top" if raw_type == "top" else "latest"
    runtime_options = extract_runtime_options(request, config, playwright_options)
    if normalized_intent == "search":
        target_url = f"https://x.com/search?q={quote(query)}&src=typed_query&f={'live' if search_type == 'latest' else 'top'}"
    elif normalized_intent == "profile":
        target_url = f"https://x.com/{quote(username)}"
    elif normalized_intent == "followers":
        target_url = f"https://x.com/{quote(username)}/followers"
    elif normalized_intent == "following":
        target_url = f"https://x.com/{quote(username)}/following"
    elif normalized_intent == "tweets":
        target_url = f"https://x.com/{quote(username)}"
    elif normalized_intent == "bookmarks":
        target_url = "https://x.com/i/bookmarks"
    elif normalized_intent == "notifications":
        target_url = "https://x.com/notifications"
    elif normalized_intent in {"thread", "article"}:
        target_url = f"https://x.com/i/status/{quote(tweet_id)}"
    else:
        target_url = "https://x.com/home"

    scroll_times = max(1, min(12, (count + 9) // 10))

    if normalized_intent == "search":
        script_to_run = build_x_search_intercept_script(
            SCRIPT_REGISTRY,
            query=query,
            search_type=search_type,
            count=count,
            scroll_times=scroll_times,
        )
    else:
        script_to_run = build_x_intent_script(
            SCRIPT_REGISTRY,
            normalized_intent,
            {
                "__QUERY_JSON__": json.dumps(query, ensure_ascii=False),
                "__USERNAME_JSON__": json.dumps(username, ensure_ascii=False),
                "__TWEET_ID_JSON__": json.dumps(tweet_id, ensure_ascii=False),
                "__COUNT__": count,
                "__SCROLL_TIMES__": scroll_times,
            },
        )

    try:
        bootstrap_capture_key = {
            "search": "SearchTimeline",
            "notifications": "NotificationsTimeline",
            "followers": "Followers",
            "following": "Following",
        }.get(normalized_intent)
        init_script = _build_x_intercept_bootstrap_script(bootstrap_capture_key) if bootstrap_capture_key else None
        eval_result = await run_playwright_script(
            request,
            runtime_options,
            target_url=target_url,
            script_to_run=script_to_run,
            post_navigation_wait_ms=2000,
            init_script=init_script,
        )
    except PlaywrightTimeoutError as error:
        raise HTTPException(status_code=504, detail=f"playwright intercept search timeout: {error}") from error
    except HTTPException:
        raise
    except Exception as error:
        raise HTTPException(status_code=500, detail=f"playwright intercept {normalized_intent} failed: {error}") from error

    items = normalize_playwright_eval_result(eval_result, request, target_url)
    if not items:
        raise HTTPException(status_code=500, detail=f"playwright intercept {normalized_intent} finished without output")
    return items


async def run_x_search(request: FetchRequest) -> list[CleanItem]:
    return await run_x_intent(request, "search")
