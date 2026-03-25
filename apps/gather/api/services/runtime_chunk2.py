import api.services.runtime_chunk1 as _runtime_chunk_prev

globals().update(vars(_runtime_chunk_prev))

def _stable_hash(value: Any) -> str:
    dumped = json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False)
    return hashlib.sha256(dumped.encode("utf-8")).hexdigest()


def _build_playwright_pool_key(request: FetchRequest, options: dict[str, Any], storage_state: Any) -> str:
    platform = request.platform.lower().strip()
    user_id = str(options.get("pool_user_id") or "")
    driver = str(options.get("pool_driver") or "playwright")
    proxy_fingerprint = _stable_hash(options.get("proxy") or {})
    auth_fingerprint = _stable_hash(storage_state or {})
    return "|".join(
        [
            platform,
            driver,
            user_id,
            "1" if options["headless"] else "0",
            proxy_fingerprint,
            auth_fingerprint,
        ]
    )


async def _sweep_idle_playwright_browsers(now: float) -> None:
    to_close: list[_PlaywrightBrowserPoolEntry] = []
    for key, entry in list(_PLAYWRIGHT_BROWSER_POOL.items()):
        is_connected = getattr(entry.browser, "is_connected", None)
        if callable(is_connected) and not is_connected():
            if entry.active_tabs == 0:
                _PLAYWRIGHT_BROWSER_POOL.pop(key, None)
                to_close.append(entry)
            continue
        idle_for_ms = int((now - entry.last_used_at) * 1000)
        if idle_for_ms >= entry.idle_timeout_ms and entry.active_tabs == 0:
            _PLAYWRIGHT_BROWSER_POOL.pop(key, None)
            to_close.append(entry)
    for entry in to_close:
        try:
            if entry.context is not None:
                await entry.context.close()
        except Exception:
            pass
        try:
            await entry.browser.close()
        except Exception:
            pass


async def _acquire_pooled_playwright_entry(
    playwright: Any, options: dict[str, Any], request: FetchRequest, storage_state: Any
) -> tuple[str, _PlaywrightBrowserPoolEntry]:
    pool_key = _build_playwright_pool_key(request, options, storage_state)
    now = asyncio.get_running_loop().time()
    async with _PLAYWRIGHT_POOL_LOCK:
        await _sweep_idle_playwright_browsers(now)
        entry = _PLAYWRIGHT_BROWSER_POOL.get(pool_key)
        if entry is not None:
            is_connected = getattr(entry.browser, "is_connected", None)
            if callable(is_connected) and not is_connected():
                _PLAYWRIGHT_BROWSER_POOL.pop(pool_key, None)
            else:
                entry.last_used_at = now
                return pool_key, entry

        launch_options: dict[str, Any] = {"headless": options["headless"]}
        if options["proxy"] is not None:
            launch_options["proxy"] = options["proxy"]
        browser = await playwright.chromium.launch(**launch_options)
        entry = _PlaywrightBrowserPoolEntry(
            browser=browser,
            last_used_at=now,
            idle_timeout_ms=options["pool_idle_timeout_ms"],
        )
        _PLAYWRIGHT_BROWSER_POOL[pool_key] = entry
        return pool_key, entry


async def _acquire_pooled_playwright_page(entry: _PlaywrightBrowserPoolEntry, storage_state: Any) -> Any:
    async with entry.lock:
        if entry.context is None:
            context_options: dict[str, Any] = {}
            if isinstance(storage_state, dict):
                context_options["storage_state"] = storage_state
            entry.context = await entry.browser.new_context(**context_options)
        if entry.keeper_page is None or entry.keeper_page.is_closed():
            entry.keeper_page = await entry.context.new_page()
        page = await entry.context.new_page()
        entry.active_tabs += 1
        entry.last_used_at = asyncio.get_running_loop().time()
        return page


async def _release_pooled_playwright_page(entry: _PlaywrightBrowserPoolEntry, page: Any) -> None:
    try:
        if page is not None and not page.is_closed():
            await page.close()
    except Exception:
        pass
    async with entry.lock:
        if entry.active_tabs > 0:
            entry.active_tabs -= 1
        entry.last_used_at = asyncio.get_running_loop().time()


async def _run_playwright_script(
    request: FetchRequest,
    options: dict[str, Any],
    *,
    target_url: str | None,
    script_to_run: str,
    wait_until: str = "domcontentloaded",
    wait_selector: str | None = None,
    post_navigation_wait_ms: int = 0,
    init_script: str | None = None,
    allow_origin_fallback: bool = False,
    post_evaluate_hook: Any | None = None,
) -> Any:
    playwright = await _get_playwright_runtime()
    storage_state = request.auth_data if isinstance(request.auth_data, dict) else options.get("storage_state")
    if options.get("pool_enabled"):
        _, entry = await _acquire_pooled_playwright_entry(playwright, options, request, storage_state)
        page = await _acquire_pooled_playwright_page(entry, storage_state)
        try:
            if init_script:
                await page.add_init_script(init_script)
            if target_url:
                await page.goto(
                    target_url,
                    wait_until=wait_until,
                    timeout=options["navigation_timeout_ms"],
                )
                if wait_selector:
                    await page.wait_for_selector(wait_selector, timeout=options["navigation_timeout_ms"])
                if post_navigation_wait_ms > 0:
                    await page.wait_for_timeout(post_navigation_wait_ms)
            try:
                script_result = await page.evaluate(script_to_run)
            except Exception as error:
                fallback_target_url = _resolve_default_target_url(request.platform)
                if (
                    allow_origin_fallback
                    and not target_url
                    and fallback_target_url
                    and _looks_like_origin_security_error(error)
                ):
                    await page.goto(
                        fallback_target_url,
                        wait_until=wait_until,
                        timeout=options["navigation_timeout_ms"],
                    )
                    if post_navigation_wait_ms > 0:
                        await page.wait_for_timeout(post_navigation_wait_ms)
                    script_result = await page.evaluate(script_to_run)
                else:
                    raise
            if callable(post_evaluate_hook):
                return await post_evaluate_hook(page, script_result, request)
            return script_result
        finally:
            await _release_pooled_playwright_page(entry, page)

    launch_options: dict[str, Any] = {"headless": options["headless"]}
    if options["proxy"] is not None:
        launch_options["proxy"] = options["proxy"]
    browser = await playwright.chromium.launch(**launch_options)
    context = None
    page = None
    try:
        context_options: dict[str, Any] = {}
        if isinstance(storage_state, dict):
            context_options["storage_state"] = storage_state
        context = await browser.new_context(**context_options)
        page = await context.new_page()
        if init_script:
            await page.add_init_script(init_script)
        if target_url:
            await page.goto(
                target_url,
                wait_until=wait_until,
                timeout=options["navigation_timeout_ms"],
            )
            if wait_selector:
                await page.wait_for_selector(wait_selector, timeout=options["navigation_timeout_ms"])
            if post_navigation_wait_ms > 0:
                await page.wait_for_timeout(post_navigation_wait_ms)
        try:
            script_result = await page.evaluate(script_to_run)
        except Exception as error:
            fallback_target_url = _resolve_default_target_url(request.platform)
            if (
                allow_origin_fallback
                and not target_url
                and fallback_target_url
                and _looks_like_origin_security_error(error)
            ):
                await page.goto(
                    fallback_target_url,
                    wait_until=wait_until,
                    timeout=options["navigation_timeout_ms"],
                )
                if post_navigation_wait_ms > 0:
                    await page.wait_for_timeout(post_navigation_wait_ms)
                script_result = await page.evaluate(script_to_run)
            else:
                raise
        if callable(post_evaluate_hook):
            return await post_evaluate_hook(page, script_result, request)
        return script_result
    finally:
        if context is not None:
            await context.close()
        await browser.close()


def _extract_playwright_runtime_options(
    request: FetchRequest,
    config: dict[str, Any],
    playwright_options: dict[str, Any],
) -> dict[str, Any]:
    navigation_timeout_ms = playwright_options.get("navigationTimeoutMs", 60000)
    if not isinstance(navigation_timeout_ms, int) or navigation_timeout_ms < 1000:
        raise HTTPException(status_code=400, detail="config.playwright.navigationTimeoutMs must be an integer >= 1000")
    pool_idle_timeout_ms = playwright_options.get("poolIdleTimeoutMs", 120000)
    if not isinstance(pool_idle_timeout_ms, int) or pool_idle_timeout_ms < 1000:
        raise HTTPException(status_code=400, detail="config.playwright.poolIdleTimeoutMs must be an integer >= 1000")
    pool_user_id = str(playwright_options.get("userId", playwright_options.get("user_id")) or "").strip()
    pool_enabled = bool(playwright_options.get("poolEnabled", True)) and bool(pool_user_id)
    return {
        "headless": bool(playwright_options.get("headless", True)),
        "navigation_timeout_ms": navigation_timeout_ms,
        "storage_state": _load_playwright_storage_state_from_config(request, playwright_options),
        "proxy": _extract_proxy_settings(config, playwright_options),
        "pool_enabled": pool_enabled,
        "pool_idle_timeout_ms": pool_idle_timeout_ms,
        "pool_user_id": pool_user_id,
        "pool_driver": playwright_options.get("poolDriver", playwright_options.get("pool_driver", "playwright")),
    }


async def _playwright_pool_sweep_loop() -> None:
    while True:
        await asyncio.sleep(_PLAYWRIGHT_POOL_SWEEP_INTERVAL_MS / 1000)
        now = asyncio.get_running_loop().time()
        async with _PLAYWRIGHT_POOL_LOCK:
            await _sweep_idle_playwright_browsers(now)


async def _close_all_playwright_browsers() -> None:
    async with _PLAYWRIGHT_POOL_LOCK:
        entries = list(_PLAYWRIGHT_BROWSER_POOL.values())
        _PLAYWRIGHT_BROWSER_POOL.clear()
    for entry in entries:
        try:
            if entry.context is not None:
                await entry.context.close()
        except Exception:
            pass
        try:
            await entry.browser.close()
        except Exception:
            pass


async def _get_playwright_runtime() -> Any:
    global _PLAYWRIGHT_RUNTIME
    if _PLAYWRIGHT_RUNTIME is not None:
        return _PLAYWRIGHT_RUNTIME

    from playwright.async_api import async_playwright

    async with _PLAYWRIGHT_RUNTIME_LOCK:
        if _PLAYWRIGHT_RUNTIME is None:
            _PLAYWRIGHT_RUNTIME = await async_playwright().start()
    return _PLAYWRIGHT_RUNTIME


def _to_clean_item_from_eval_value(value: Any, request: FetchRequest, target_url: str | None, index: int) -> CleanItem:
    if isinstance(value, dict):
        raw_time = value.get("time", value.get("created_at"))
        parsed_time: datetime | None = None
        if isinstance(raw_time, str):
            try:
                parsed_time = datetime.fromisoformat(raw_time)
            except ValueError:
                parsed_time = None
                try:
                    parsed_time = datetime.strptime(raw_time, "%a %b %d %H:%M:%S %z %Y")
                except ValueError:
                    parsed_time = None
        text = value.get("text")
        if text is None and isinstance(value.get("full_text"), str):
            text = value.get("full_text")
        markdown = value.get("markdown")
        if text is None and markdown is None:
            text = json.dumps(value, ensure_ascii=False)
            markdown = text
        elif text is None:
            text = str(markdown)
        elif markdown is None:
            author = value.get("author")
            markdown = f"@{author}: {text}" if isinstance(author, str) and author else str(text)
        record_content = dict(value)
        record_content["text"] = str(text)
        record_content["markdown"] = str(markdown)
        if value.get("url") or target_url:
            record_content["url"] = value.get("url") or target_url
        return CleanItem(
            title=value.get("title") or value.get("name"),
            text=str(text),
            markdown=str(markdown),
            platform=str(value.get("platform") or request.platform),
            url=value.get("url") or target_url,
            time=parsed_time or datetime.now(),
            recordTime=parsed_time or datetime.now(),
            sourceId=request.source_id,
            sourceType="SOCIAL_MEDIA",
            recordId=str(value.get("recordId") or value.get("id") or f"{request.source_id}:{index}"),
            recordType=str(value.get("recordType") or value.get("type") or "eval-js"),
            recordIndex=value.get("recordIndex") if isinstance(value.get("recordIndex"), int) else index,
            recordContent=record_content,
        )

    text_value = str(value)
    return CleanItem(
        title=f"playwright eval result {index}",
        text=text_value,
        markdown=text_value,
        platform=request.platform,
        url=target_url,
        time=datetime.now(),
        recordTime=datetime.now(),
        sourceId=request.source_id,
        sourceType="SOCIAL_MEDIA",
        recordId=f"{request.source_id}:{index}",
        recordType="eval-js",
        recordIndex=index,
        recordContent={"text": text_value, "markdown": text_value, "url": target_url},
    )


def _normalize_playwright_eval_result(result: Any, request: FetchRequest, target_url: str | None) -> list[CleanItem]:
    candidate = result
    if isinstance(candidate, dict):
        raw_error = candidate.get("error")
        if isinstance(raw_error, str) and raw_error.strip():
            hint = candidate.get("hint")
            message = raw_error.strip()
            if isinstance(hint, str) and hint.strip():
                message = f"{message} | hint: {hint.strip()}"
            raise HTTPException(status_code=400, detail=message)
        for key in ("tweets", "posts", "notes", "items", "results", "data"):
            nested = candidate.get(key)
            if isinstance(nested, list):
                if request.output_field_map:
                    mapped_sources = {
                        source_path.split(".", 1)[0]
                        for source_path in request.output_field_map.values()
                        if isinstance(source_path, str) and source_path.strip()
                    }
                    if key in mapped_sources:
                        break
                candidate = nested
                break
    if isinstance(candidate, list):
        if not candidate:
            return []
        return [
            _to_clean_item_from_eval_value(item, request, target_url, index)
            for index, item in enumerate(candidate, start=1)
        ]
    return [_to_clean_item_from_eval_value(candidate, request, target_url, 1)]


def _resolve_default_target_url(platform: str) -> str | None:
    normalized = _BB_SITE_PLATFORM_ALIAS.get(platform.lower(), platform.lower())
    return _BB_SITE_TARGET_URL.get(normalized)


def _looks_like_origin_security_error(error: Exception) -> bool:
    message = str(error).lower()
    return (
        "failed to read the 'cookie' property" in message
        or "failed to read the 'localstorage' property" in message
        or "securityerror" in message
    )


def _is_xiaohongshu_auth_probe_miss(result: Any, platform: str) -> bool:
    if not isinstance(result, dict):
        return False
    normalized_platform = platform.lower().strip()
    if normalized_platform not in {"xhs", "xiaohongshu"}:
        return False
    raw_error = result.get("error")
    if not isinstance(raw_error, str):
        return False
    if raw_error.strip().lower() != "failed to get user info":
        return False
    raw_hint = result.get("hint")
    if not isinstance(raw_hint, str):
        return False
    normalized_hint = raw_hint.strip().lower()
    return "user/me" in normalized_hint and "captured" in normalized_hint


async def _run_xiaohongshu_direct_user_me_probe(page: Any) -> dict[str, Any]:
    return await page.evaluate(
        """
        (async () => {
          try {
            const candidates = [
              "/api/sns/web/v1/user/me",
              "https://www.xiaohongshu.com/api/sns/web/v1/user/me"
            ];
            let lastStatus = null;
            let lastBody = "";
            for (const endpoint of candidates) {
              const response = await fetch(endpoint, { credentials: "include" });
              const text = await response.text();
              lastStatus = response.status;
              lastBody = text;
              let payload = null;
              try {
                payload = JSON.parse(text);
              } catch (_) {}
              if (response.ok && payload && payload.success && payload.data) {
                const user = payload.data;
                return {
                  nickname: user.nickname,
                  red_id: user.red_id,
                  desc: user.desc,
                  gender: user.gender,
                  userid: user.user_id,
                  url: user.user_id
                    ? `https://www.xiaohongshu.com/user/profile/${user.user_id}`
                    : "https://www.xiaohongshu.com",
                  _debug: {
                    probe: "direct-user-me",
                    endpoint
                  }
                };
              }
            }
            return {
              error: "Failed to get user info",
              hint: `Direct /user/me probe failed (status=${lastStatus})`,
              debug: {
                probe: "direct-user-me",
                responseStatus: lastStatus,
                responseSnippet: String(lastBody || "").slice(0, 400)
              }
            };
          } catch (error) {
            return {
              error: "Failed to get user info",
              hint: `Direct /user/me probe exception: ${String(error)}`
            };
          }
        })()
        """
    )


async def _apply_xiaohongshu_user_me_fallback(
    page: Any, eval_result: Any, request: FetchRequest
) -> Any:
    if not _is_xiaohongshu_auth_probe_miss(eval_result, request.platform):
        return eval_result
    fallback_result = await _run_xiaohongshu_direct_user_me_probe(page)
    if isinstance(fallback_result, dict):
        fallback_error = fallback_result.get("error")
        if not (isinstance(fallback_error, str) and fallback_error.strip()):
            return fallback_result
        if isinstance(eval_result, dict):
            original_hint = eval_result.get("hint")
            fallback_hint = fallback_result.get("hint")
            if isinstance(original_hint, str) and isinstance(fallback_hint, str):
                fallback_result["hint"] = f"{original_hint}; {fallback_hint}"
    return eval_result


