import api.services.runtime_chunk3 as _runtime_chunk_prev

globals().update(vars(_runtime_chunk_prev))

async def _run_playwright_intercept_linkedin_intent(request: FetchRequest, intent_type: str) -> list[CleanItem]:
    from playwright.async_api import TimeoutError as PlaywrightTimeoutError

    config = request.config if isinstance(request.config, dict) else {}
    playwright_options = config.get("playwright")
    if not isinstance(playwright_options, dict):
        raise HTTPException(status_code=400, detail="config.playwright must be an object")

    args = playwright_options.get("args", {})
    args_obj = args if isinstance(args, dict) else {}
    normalized_intent = (intent_type or "").strip().lower()
    if normalized_intent not in _LINKEDIN_INTERCEPT_INTENTS:
        raise HTTPException(status_code=400, detail=f"unsupported linkedin intercept intent: {normalized_intent}")

    query = str(args_obj.get("query", "")).strip()
    if normalized_intent == "search" and not query:
        raise HTTPException(status_code=400, detail="config.playwright.args.query is required for intercept-linkedin-search mode")

    location = str(args_obj.get("location", "")).strip()
    company = str(args_obj.get("company", "")).strip()
    experience_level = str(args_obj.get("experience_level", args_obj.get("experienceLevel", ""))).strip()
    job_type = str(args_obj.get("job_type", args_obj.get("jobType", ""))).strip()
    date_posted = str(args_obj.get("date_posted", args_obj.get("datePosted", ""))).strip()
    remote = str(args_obj.get("remote", "")).strip()
    details = bool(args_obj.get("details", False))
    raw_start = args_obj.get("start", 0)
    try:
        start = int(raw_start)
    except (TypeError, ValueError):
        start = 0
    start = max(0, min(start, 1000))
    raw_limit = args_obj.get("limit", args_obj.get("count", 20))
    try:
        limit = int(raw_limit)
    except (TypeError, ValueError):
        limit = 20
    limit = max(1, min(limit, 100))

    runtime_options = _extract_playwright_runtime_options(request, config, playwright_options)
    params = [f"keywords={quote(query)}"]
    if location:
        params.append(f"location={quote(location)}")
    target_url = f"https://www.linkedin.com/jobs/search/?{'&'.join(params)}"

    script_to_run = build_x_intent_script(
        _SCRIPT_REGISTRY,
        normalized_intent,
        {
            "__QUERY_JSON__": json.dumps(query, ensure_ascii=False),
            "__LOCATION_JSON__": json.dumps(location, ensure_ascii=False),
            "__COMPANY_JSON__": json.dumps(company, ensure_ascii=False),
            "__EXPERIENCE_LEVEL_JSON__": json.dumps(experience_level, ensure_ascii=False),
            "__JOB_TYPE_JSON__": json.dumps(job_type, ensure_ascii=False),
            "__DATE_POSTED_JSON__": json.dumps(date_posted, ensure_ascii=False),
            "__REMOTE_JSON__": json.dumps(remote, ensure_ascii=False),
            "__START__": start,
            "__LIMIT__": limit,
            "__COUNT__": limit,
            "__DETAILS__": "true" if details else "false",
        },
        platform="linkedin",
    )

    try:
        eval_result = await _run_playwright_script(
            request,
            runtime_options,
            target_url=target_url,
            script_to_run=script_to_run,
            post_navigation_wait_ms=1500,
        )
    except PlaywrightTimeoutError as error:
        raise HTTPException(status_code=504, detail=f"playwright intercept linkedin timeout: {error}") from error
    except HTTPException:
        raise
    except Exception as error:
        raise HTTPException(status_code=500, detail=f"playwright intercept linkedin {normalized_intent} failed: {error}") from error

    items = _normalize_playwright_eval_result(eval_result, request, target_url)
    if not items:
        raise HTTPException(status_code=500, detail=f"playwright intercept linkedin {normalized_intent} finished without output")
    return items


async def _run_playwright_intercept_linux_do_intent(request: FetchRequest, intent_type: str) -> list[CleanItem]:
    from playwright.async_api import TimeoutError as PlaywrightTimeoutError

    config = request.config if isinstance(request.config, dict) else {}
    playwright_options = config.get("playwright")
    if not isinstance(playwright_options, dict):
        raise HTTPException(status_code=400, detail="config.playwright must be an object")

    args = playwright_options.get("args", {})
    args_obj = args if isinstance(args, dict) else {}
    normalized_intent = (intent_type or "").strip().lower()
    if normalized_intent not in _LINUX_DO_INTERCEPT_INTENTS:
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

    runtime_options = _extract_playwright_runtime_options(request, config, playwright_options)
    target_url = "https://linux.do"

    script_to_run = build_x_intent_script(
        _SCRIPT_REGISTRY,
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
        eval_result = await _run_playwright_script(
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

    items = _normalize_playwright_eval_result(eval_result, request, target_url)
    if not items:
        raise HTTPException(status_code=500, detail=f"playwright intercept linux-do {normalized_intent} finished without output")
    return items


async def _run_playwright_intercept_youtube_intent(request: FetchRequest, intent_type: str) -> list[CleanItem]:
    from playwright.async_api import TimeoutError as PlaywrightTimeoutError

    config = request.config if isinstance(request.config, dict) else {}
    playwright_options = config.get("playwright")
    if not isinstance(playwright_options, dict):
        raise HTTPException(status_code=400, detail="config.playwright must be an object")

    args = playwright_options.get("args", {})
    args_obj = args if isinstance(args, dict) else {}
    normalized_intent = (intent_type or "").strip().lower()
    if normalized_intent not in _YOUTUBE_INTERCEPT_INTENTS:
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

    runtime_options = _extract_playwright_runtime_options(request, config, playwright_options)

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
        _SCRIPT_REGISTRY,
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
        eval_result = await _run_playwright_script(
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

    items = _normalize_playwright_eval_result(eval_result, request, target_url)
    if not items:
        raise HTTPException(status_code=500, detail=f"playwright intercept youtube {normalized_intent} finished without output")
    return items


async def _run_playwright_intercept_weibo_intent(request: FetchRequest, intent_type: str) -> list[CleanItem]:
    from playwright.async_api import TimeoutError as PlaywrightTimeoutError

    config = request.config if isinstance(request.config, dict) else {}
    playwright_options = config.get("playwright")
    if not isinstance(playwright_options, dict):
        raise HTTPException(status_code=400, detail="config.playwright must be an object")

    args = playwright_options.get("args", {})
    args_obj = args if isinstance(args, dict) else {}
    normalized_intent = (intent_type or "").strip().lower()
    if normalized_intent not in _WEIBO_INTERCEPT_INTENTS:
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

    runtime_options = _extract_playwright_runtime_options(request, config, playwright_options)
    target_url = "https://weibo.com"

    script_to_run = build_x_intent_script(
        _SCRIPT_REGISTRY,
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
        eval_result = await _run_playwright_script(
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

    items = _normalize_playwright_eval_result(eval_result, request, target_url)
    if not items:
        raise HTTPException(status_code=500, detail=f"playwright intercept weibo {normalized_intent} finished without output")
    return items


async def _run_playwright_intercept_zhihu_intent(request: FetchRequest, intent_type: str) -> list[CleanItem]:
    from playwright.async_api import TimeoutError as PlaywrightTimeoutError

    config = request.config if isinstance(request.config, dict) else {}
    playwright_options = config.get("playwright")
    if not isinstance(playwright_options, dict):
        raise HTTPException(status_code=400, detail="config.playwright must be an object")

    args = playwright_options.get("args", {})
    args_obj = args if isinstance(args, dict) else {}
    normalized_intent = (intent_type or "").strip().lower()
    if normalized_intent not in _ZHIHU_INTERCEPT_INTENTS:
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

    runtime_options = _extract_playwright_runtime_options(request, config, playwright_options)
    if normalized_intent == "search" and query:
        target_url = f"https://www.zhihu.com/search?type=content&q={quote(query)}"
    elif normalized_intent == "hot":
        target_url = "https://www.zhihu.com/hot"
    elif normalized_intent == "question" and question_id:
        target_url = f"https://www.zhihu.com/question/{quote(question_id)}"
    else:
        target_url = "https://www.zhihu.com"

    script_to_run = build_x_intent_script(
        _SCRIPT_REGISTRY,
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
        eval_result = await _run_playwright_script(
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

    items = _normalize_playwright_eval_result(eval_result, request, target_url)
    if not items:
        raise HTTPException(status_code=500, detail=f"playwright intercept zhihu {normalized_intent} finished without output")
    return items


async def _run_playwright_intercept_bilibili_intent(request: FetchRequest, intent_type: str) -> list[CleanItem]:
    from playwright.async_api import TimeoutError as PlaywrightTimeoutError

    config = request.config if isinstance(request.config, dict) else {}
    playwright_options = config.get("playwright")
    if not isinstance(playwright_options, dict):
        raise HTTPException(status_code=400, detail="config.playwright must be an object")

    args = playwright_options.get("args", {})
    args_obj = args if isinstance(args, dict) else {}
    normalized_intent = (intent_type or "").strip().lower()
    if normalized_intent not in _BILIBILI_INTERCEPT_INTENTS:
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

    runtime_options = _extract_playwright_runtime_options(request, config, playwright_options)

    if normalized_intent == "search" and keyword:
        target_url = f"https://search.bilibili.com/all?keyword={quote(keyword)}"
    elif normalized_intent in {"video", "comments"} and bvid:
        target_url = f"https://www.bilibili.com/video/{quote(bvid)}"
    else:
        target_url = "https://www.bilibili.com"

    script_to_run = build_x_intent_script(
        _SCRIPT_REGISTRY,
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
        eval_result = await _run_playwright_script(
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

    items = _normalize_playwright_eval_result(eval_result, request, target_url)
    if not items:
        raise HTTPException(status_code=500, detail=f"playwright intercept bilibili {normalized_intent} finished without output")
    return items


