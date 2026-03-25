import api.services.runtime_chunk2 as _runtime_chunk_prev

globals().update(vars(_runtime_chunk_prev))

async def _run_playwright_eval_script(request: FetchRequest) -> list[CleanItem]:
    from playwright.async_api import TimeoutError as PlaywrightTimeoutError

    options = _extract_playwright_eval_options(request.config)
    script_to_run = f"({options['script_body']})({options['args_json']})"

    try:
        eval_result = await _run_playwright_script(
            request,
            options,
            target_url=options["target_url"],
            script_to_run=script_to_run,
            wait_until=options["wait_until"],
            wait_selector=options["wait_selector"],
            post_navigation_wait_ms=options["post_navigation_wait_ms"],
            allow_origin_fallback=True,
            post_evaluate_hook=_apply_xiaohongshu_user_me_fallback,
        )
    except PlaywrightTimeoutError as error:
        raise HTTPException(status_code=504, detail=f"playwright eval timeout: {error}") from error
    except HTTPException:
        raise
    except Exception as error:
        raise HTTPException(status_code=500, detail=f"playwright eval execution failed: {error}") from error

    items = _normalize_playwright_eval_result(eval_result, request, options["target_url"])
    if not items:
        raise HTTPException(status_code=500, detail="playwright eval script finished without output")
    return items


def _extract_tweet_id(raw: str | None) -> str:
    if not isinstance(raw, str):
        return ""
    value = raw.strip()
    if not value:
        return ""
    matched = re.search(r"/status/(\d+)", value)
    if matched:
        return matched.group(1)
    digits = re.sub(r"\D", "", value)
    return digits if digits else value


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


async def _run_playwright_intercept_x_intent(request: FetchRequest, intent_type: str) -> list[CleanItem]:
    from playwright.async_api import TimeoutError as PlaywrightTimeoutError

    config = request.config if isinstance(request.config, dict) else {}
    playwright_options = config.get("playwright")
    if not isinstance(playwright_options, dict):
        raise HTTPException(status_code=400, detail="config.playwright must be an object")

    args = playwright_options.get("args", {})
    args_obj = args if isinstance(args, dict) else {}
    normalized_intent = (intent_type or "").strip().lower()
    if normalized_intent not in _X_INTERCEPT_INTENTS:
        raise HTTPException(status_code=400, detail=f"unsupported x intercept intent: {normalized_intent}")

    query = str(args_obj.get("query", "")).strip()
    username = str(args_obj.get("username", "")).strip()
    tweet_id = _extract_tweet_id(args_obj.get("tweet_id"))

    if normalized_intent == "search" and not query:
        raise HTTPException(status_code=400, detail="config.playwright.args.query is required for intercept-x-search mode")
    if normalized_intent in {"profile", "followers", "following", "tweets"} and not username:
        raise HTTPException(
            status_code=400,
            detail=f"config.playwright.args.username is required for intercept-x-{normalized_intent} mode",
        )
    if normalized_intent in {"thread", "article"} and not tweet_id:
        raise HTTPException(
            status_code=400,
            detail=f"config.playwright.args.tweet_id is required for intercept-x-{normalized_intent} mode",
        )

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
    runtime_options = _extract_playwright_runtime_options(request, config, playwright_options)
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
            _SCRIPT_REGISTRY,
            query=query,
            search_type=search_type,
            count=count,
            scroll_times=scroll_times,
        )
    else:
        script_to_run = build_x_intent_script(
            _SCRIPT_REGISTRY,
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
        init_script = (
            _build_x_intercept_bootstrap_script(bootstrap_capture_key)
            if bootstrap_capture_key
            else None
        )
        eval_result = await _run_playwright_script(
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

    items = _normalize_playwright_eval_result(eval_result, request, target_url)
    if not items:
        raise HTTPException(status_code=500, detail=f"playwright intercept {normalized_intent} finished without output")
    return items


async def _run_playwright_intercept_x_search(request: FetchRequest) -> list[CleanItem]:
    return await _run_playwright_intercept_x_intent(request, "search")


def _normalize_reddit_username(raw: Any) -> str:
    if not isinstance(raw, str):
        return ""
    username = raw.strip()
    if not username:
        return ""
    if username.lower().startswith("u/"):
        return username[2:]
    return username.lstrip("@")


async def _run_playwright_intercept_reddit_intent(request: FetchRequest, intent_type: str) -> list[CleanItem]:
    from playwright.async_api import TimeoutError as PlaywrightTimeoutError

    config = request.config if isinstance(request.config, dict) else {}
    playwright_options = config.get("playwright")
    if not isinstance(playwright_options, dict):
        raise HTTPException(status_code=400, detail="config.playwright must be an object")

    args = playwright_options.get("args", {})
    args_obj = args if isinstance(args, dict) else {}
    normalized_intent = (intent_type or "").strip().lower()
    if normalized_intent not in _REDDIT_INTERCEPT_INTENTS:
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
        raise HTTPException(
            status_code=400,
            detail="config.playwright.args.subreddit (or name) is required for intercept-reddit-subreddit mode",
        )
    if normalized_intent in {"user", "user-posts", "user-comments"} and not username:
        raise HTTPException(
            status_code=400,
            detail=f"config.playwright.args.username is required for intercept-reddit-{normalized_intent} mode",
        )

    raw_limit = args_obj.get("limit", args_obj.get("count", 20))
    try:
        limit = int(raw_limit)
    except (TypeError, ValueError):
        limit = 20
    limit = max(1, min(limit, 100))
    runtime_options = _extract_playwright_runtime_options(request, config, playwright_options)

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
        _SCRIPT_REGISTRY,
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
        eval_result = await _run_playwright_script(
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

    items = _normalize_playwright_eval_result(eval_result, request, target_url)
    if not items:
        raise HTTPException(status_code=500, detail=f"playwright intercept reddit {normalized_intent} finished without output")
    return items


def _normalize_xhs_user_id(raw: Any) -> str:
    if not isinstance(raw, str):
        return ""
    return raw.strip().lstrip("@")


async def _run_playwright_intercept_xhs_intent(request: FetchRequest, intent_type: str) -> list[CleanItem]:
    from playwright.async_api import TimeoutError as PlaywrightTimeoutError

    config = request.config if isinstance(request.config, dict) else {}
    playwright_options = config.get("playwright")
    if not isinstance(playwright_options, dict):
        raise HTTPException(status_code=400, detail="config.playwright must be an object")

    args = playwright_options.get("args", {})
    args_obj = args if isinstance(args, dict) else {}
    normalized_intent = (intent_type or "").strip().lower()
    if normalized_intent not in _XHS_INTERCEPT_INTENTS:
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

    runtime_options = _extract_playwright_runtime_options(request, config, playwright_options)
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
        _SCRIPT_REGISTRY,
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
        bootstrap_capture_key = {
            "feed": "homefeed",
            "user": "v1/user/posted",
            "notifications": "/you/",
        }.get(normalized_intent)
        init_script = (
            _build_x_intercept_bootstrap_script(bootstrap_capture_key)
            if bootstrap_capture_key
            else None
        )
        eval_result = await _run_playwright_script(
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

    items = _normalize_playwright_eval_result(eval_result, request, target_url)
    if not items:
        raise HTTPException(status_code=500, detail=f"playwright intercept xhs {normalized_intent} finished without output")
    return items


async def _run_playwright_intercept_bbc_intent(request: FetchRequest, intent_type: str) -> list[CleanItem]:
    from playwright.async_api import TimeoutError as PlaywrightTimeoutError

    config = request.config if isinstance(request.config, dict) else {}
    playwright_options = config.get("playwright")
    if not isinstance(playwright_options, dict):
        raise HTTPException(status_code=400, detail="config.playwright must be an object")

    args = playwright_options.get("args", {})
    args_obj = args if isinstance(args, dict) else {}
    normalized_intent = (intent_type or "").strip().lower()
    if normalized_intent not in _BBC_INTERCEPT_INTENTS:
        raise HTTPException(status_code=400, detail=f"unsupported bbc intercept intent: {normalized_intent}")

    raw_limit = args_obj.get("limit", args_obj.get("count", 20))
    try:
        limit = int(raw_limit)
    except (TypeError, ValueError):
        limit = 20
    limit = max(1, min(limit, 50))

    runtime_options = _extract_playwright_runtime_options(request, config, playwright_options)
    if normalized_intent == "news":
        target_url = "https://feeds.bbci.co.uk/news/rss.xml"
    else:
        target_url = "https://www.bbc.com/news"

    script_to_run = build_x_intent_script(
        _SCRIPT_REGISTRY,
        normalized_intent,
        {
            "__LIMIT__": limit,
            "__COUNT__": limit,
        },
        platform="bbc",
    )

    try:
        eval_result = await _run_playwright_script(
            request,
            runtime_options,
            target_url=target_url,
            script_to_run=script_to_run,
            post_navigation_wait_ms=800,
        )
    except PlaywrightTimeoutError as error:
        raise HTTPException(status_code=504, detail=f"playwright intercept bbc timeout: {error}") from error
    except HTTPException:
        raise
    except Exception as error:
        raise HTTPException(status_code=500, detail=f"playwright intercept bbc {normalized_intent} failed: {error}") from error

    items = _normalize_playwright_eval_result(eval_result, request, target_url)
    if not items:
        raise HTTPException(status_code=500, detail=f"playwright intercept bbc {normalized_intent} finished without output")
    return items


async def _run_playwright_intercept_hackernews_intent(request: FetchRequest, intent_type: str) -> list[CleanItem]:
    from playwright.async_api import TimeoutError as PlaywrightTimeoutError

    config = request.config if isinstance(request.config, dict) else {}
    playwright_options = config.get("playwright")
    if not isinstance(playwright_options, dict):
        raise HTTPException(status_code=400, detail="config.playwright must be an object")

    args = playwright_options.get("args", {})
    args_obj = args if isinstance(args, dict) else {}
    normalized_intent = (intent_type or "").strip().lower()
    if normalized_intent not in _HACKERNEWS_INTERCEPT_INTENTS:
        raise HTTPException(status_code=400, detail=f"unsupported hackernews intercept intent: {normalized_intent}")

    raw_limit = args_obj.get("limit", args_obj.get("count", 20))
    try:
        limit = int(raw_limit)
    except (TypeError, ValueError):
        limit = 20
    limit = max(1, min(limit, 100))

    runtime_options = _extract_playwright_runtime_options(request, config, playwright_options)
    target_url = "https://news.ycombinator.com"

    script_to_run = build_x_intent_script(
        _SCRIPT_REGISTRY,
        normalized_intent,
        {
            "__LIMIT__": limit,
            "__COUNT__": limit,
        },
        platform="hackernews",
    )

    try:
        eval_result = await _run_playwright_script(
            request,
            runtime_options,
            target_url=target_url,
            script_to_run=script_to_run,
            post_navigation_wait_ms=500,
        )
    except PlaywrightTimeoutError as error:
        raise HTTPException(status_code=504, detail=f"playwright intercept hackernews timeout: {error}") from error
    except HTTPException:
        raise
    except Exception as error:
        raise HTTPException(status_code=500, detail=f"playwright intercept hackernews {normalized_intent} failed: {error}") from error

    items = _normalize_playwright_eval_result(eval_result, request, target_url)
    if not items:
        raise HTTPException(status_code=500, detail=f"playwright intercept hackernews {normalized_intent} finished without output")
    return items


