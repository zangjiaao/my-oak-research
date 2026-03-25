"""Playwright script execution engine and result normalization."""

import json
import re
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, List, Optional
from urllib.parse import quote, urlparse, urlunparse

from fastapi import HTTPException

from core.config import (
    GATHER_APP_ROOT,
    PLATFORM_ALIAS,
    PLATFORM_DEFAULT_URL,
)
from core.browser_pool import (
    acquire_pooled_entry,
    acquire_pooled_page,
    get_playwright_runtime,
    release_pooled_page,
)
from schemas import CleanItem, FetchRequest


# ---------------------------------------------------------------------------
# Storage-state / proxy helpers
# ---------------------------------------------------------------------------

def strip_playwright_meta_block(script: str) -> str:
    return re.sub(r"/\*\s*@meta[\s\S]*?\*/", "", script, count=1).strip()


def load_storage_state_from_config(
    request: FetchRequest,
    playwright_options: Dict[str, Any],
) -> Dict[str, Any] | None:
    if request.auth_data and isinstance(request.auth_data, dict):
        return request.auth_data
    raw_state_file = playwright_options.get("stateFile", playwright_options.get("authFile"))
    if not isinstance(raw_state_file, str) or not raw_state_file.strip():
        return None
    state_path = Path(raw_state_file.strip()).expanduser()
    if not state_path.is_absolute():
        state_path = (GATHER_APP_ROOT / state_path).resolve()
    if not state_path.exists() or not state_path.is_file():
        raise HTTPException(status_code=400, detail=f"stateFile does not exist: {raw_state_file}")
    try:
        raw_state = json.loads(state_path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as error:
        raise HTTPException(status_code=400, detail=f"stateFile is not valid JSON: {error}") from error
    if not isinstance(raw_state, dict):
        raise HTTPException(status_code=400, detail="stateFile JSON must be an object")
    return raw_state


def _inject_proxy_credentials(proxy_url: str, username: str | None, password: str | None) -> str:
    parsed = urlparse(proxy_url)
    if parsed.username:
        return proxy_url
    if username is None:
        return proxy_url
    encoded_user = quote(username, safe="")
    encoded_password = quote(password or "", safe="")
    netloc = f"{encoded_user}:{encoded_password}@{parsed.hostname or ''}"
    if parsed.port:
        netloc = f"{netloc}:{parsed.port}"
    return urlunparse((parsed.scheme, netloc, parsed.path, parsed.params, parsed.query, parsed.fragment))


def extract_proxy_settings(
    config: Dict[str, Any], playwright_options: Dict[str, Any]
) -> dict[str, str] | None:
    raw_proxy: Any | None = playwright_options.get("proxy")
    if raw_proxy is None:
        network = config.get("network")
        if isinstance(network, dict):
            raw_proxy = network.get("proxy")
        elif network is not None:
            raise HTTPException(status_code=400, detail="config.network must be an object")

    if raw_proxy is None:
        return None

    if isinstance(raw_proxy, str):
        proxy_url = raw_proxy.strip()
        username = None
        password = None
        bypass = None
    elif isinstance(raw_proxy, dict):
        raw_url = raw_proxy.get("url", raw_proxy.get("server"))
        if not isinstance(raw_url, str) or not raw_url.strip():
            raise HTTPException(status_code=400, detail="config.network.proxy.url is required")
        proxy_url = raw_url.strip()
        username = raw_proxy.get("username")
        password = raw_proxy.get("password")
        bypass = raw_proxy.get("bypass")
        if username is not None and not isinstance(username, str):
            raise HTTPException(status_code=400, detail="config.network.proxy.username must be a string")
        if password is not None and not isinstance(password, str):
            raise HTTPException(status_code=400, detail="config.network.proxy.password must be a string")
        if bypass is not None and not isinstance(bypass, str):
            raise HTTPException(status_code=400, detail="config.network.proxy.bypass must be a string")
    else:
        raise HTTPException(status_code=400, detail="config.network.proxy must be a string or object")

    parsed = urlparse(proxy_url)
    if parsed.scheme.lower() not in {"http", "https", "socks5", "socks5h"}:
        raise HTTPException(status_code=400, detail="config.network.proxy must use http/https/socks5/socks5h")
    if not parsed.hostname:
        raise HTTPException(status_code=400, detail="config.network.proxy.url is invalid")

    resolved = {
        "server": _inject_proxy_credentials(proxy_url, username, password),
    }
    if bypass:
        resolved["bypass"] = bypass
    return resolved


# ---------------------------------------------------------------------------
# Runtime-option extraction
# ---------------------------------------------------------------------------

def extract_runtime_options(
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
        "storage_state": load_storage_state_from_config(request, playwright_options),
        "proxy": extract_proxy_settings(config, playwright_options),
        "pool_enabled": pool_enabled,
        "pool_idle_timeout_ms": pool_idle_timeout_ms,
        "pool_user_id": pool_user_id,
        "pool_driver": playwright_options.get("poolDriver", playwright_options.get("pool_driver", "playwright")),
    }


def extract_eval_options(config: Dict[str, Any]) -> dict[str, Any]:
    raw = config.get("playwright")
    if not isinstance(raw, dict):
        raise HTTPException(status_code=400, detail="config.playwright must be an object")

    raw_target_url = raw.get("targetUrl")
    target_url: str | None = None
    if raw_target_url is not None:
        if not isinstance(raw_target_url, str):
            raise HTTPException(status_code=400, detail="config.playwright.targetUrl must be a string")
        if raw_target_url.strip():
            target_url = raw_target_url.strip()

    script_body = raw.get("scriptBody") or raw.get("jsBody")
    script_path = raw.get("scriptPath")
    if script_body is None and script_path is None:
        raise HTTPException(status_code=400, detail="config.playwright.scriptBody or scriptPath is required")
    if script_body is not None and not isinstance(script_body, str):
        raise HTTPException(status_code=400, detail="config.playwright.scriptBody must be a string")
    if script_path is not None:
        if not isinstance(script_path, str) or not script_path.strip():
            raise HTTPException(status_code=400, detail="config.playwright.scriptPath must be a non-empty string")
        resolved = Path(script_path).expanduser()
        if not resolved.is_absolute():
            resolved = (GATHER_APP_ROOT / resolved).resolve()
        if not resolved.exists() or not resolved.is_file():
            raise HTTPException(status_code=400, detail=f"scriptPath does not exist: {script_path}")
        script_body = resolved.read_text(encoding="utf-8")

    wait_until = str(raw.get("waitUntil", "domcontentloaded")).lower()
    if wait_until not in {"domcontentloaded", "networkidle", "load", "commit"}:
        raise HTTPException(status_code=400, detail="config.playwright.waitUntil must be one of domcontentloaded/networkidle/load/commit")

    navigation_timeout_ms = raw.get("navigationTimeoutMs", 60000)
    if not isinstance(navigation_timeout_ms, int) or navigation_timeout_ms < 1000:
        raise HTTPException(status_code=400, detail="config.playwright.navigationTimeoutMs must be an integer >= 1000")

    post_nav_wait_ms = raw.get("postNavigationWaitMs", 0)
    if not isinstance(post_nav_wait_ms, int) or post_nav_wait_ms < 0:
        raise HTTPException(status_code=400, detail="config.playwright.postNavigationWaitMs must be an integer >= 0")

    wait_selector = raw.get("waitForSelector")
    if wait_selector is not None and (not isinstance(wait_selector, str) or not wait_selector.strip()):
        raise HTTPException(status_code=400, detail="config.playwright.waitForSelector must be a non-empty string")
    if wait_selector and not target_url:
        raise HTTPException(status_code=400, detail="config.playwright.waitForSelector requires targetUrl")

    pool_idle_timeout_ms = raw.get("poolIdleTimeoutMs", 120000)
    if not isinstance(pool_idle_timeout_ms, int) or pool_idle_timeout_ms < 1000:
        raise HTTPException(status_code=400, detail="config.playwright.poolIdleTimeoutMs must be an integer >= 1000")

    args = raw.get("args", {})
    try:
        args_json = json.dumps(args, ensure_ascii=False)
    except TypeError as error:
        raise HTTPException(status_code=400, detail=f"config.playwright.args is not JSON serializable: {error}") from error

    storage_state: Dict[str, Any] | None = None
    state_file = raw.get("stateFile", raw.get("authFile"))
    if state_file is not None:
        if not isinstance(state_file, str) or not state_file.strip():
            raise HTTPException(status_code=400, detail="config.playwright.stateFile must be a non-empty string")
        state_path = Path(state_file).expanduser()
        if not state_path.is_absolute():
            state_path = (GATHER_APP_ROOT / state_path).resolve()
        if not state_path.exists() or not state_path.is_file():
            raise HTTPException(status_code=400, detail=f"stateFile does not exist: {state_file}")
        try:
            raw_state = json.loads(state_path.read_text(encoding="utf-8"))
        except json.JSONDecodeError as error:
            raise HTTPException(status_code=400, detail=f"stateFile is not valid JSON: {error}") from error
        if not isinstance(raw_state, dict):
            raise HTTPException(status_code=400, detail="stateFile JSON must be an object")
        storage_state = raw_state

    pool_user_id = str(raw.get("userId", raw.get("user_id")) or "").strip()
    pool_enabled = bool(raw.get("poolEnabled", True)) and bool(pool_user_id)

    return {
        "target_url": target_url,
        "script_body": strip_playwright_meta_block(script_body or ""),
        "wait_until": wait_until,
        "navigation_timeout_ms": navigation_timeout_ms,
        "post_navigation_wait_ms": post_nav_wait_ms,
        "wait_selector": wait_selector.strip() if isinstance(wait_selector, str) else None,
        "args_json": args_json,
        "headless": bool(raw.get("headless", True)),
        "storage_state": storage_state,
        "proxy": extract_proxy_settings(config, raw),
        "pool_enabled": pool_enabled,
        "pool_idle_timeout_ms": pool_idle_timeout_ms,
        "pool_user_id": pool_user_id,
        "pool_driver": raw.get("poolDriver", raw.get("pool_driver", "playwright")),
    }


# ---------------------------------------------------------------------------
# Default target URL resolution
# ---------------------------------------------------------------------------

def resolve_default_target_url(platform: str) -> str | None:
    normalized = PLATFORM_ALIAS.get(platform.lower(), platform.lower())
    return PLATFORM_DEFAULT_URL.get(normalized)


def _looks_like_origin_security_error(error: Exception) -> bool:
    message = str(error).lower()
    return (
        "failed to read the 'cookie' property" in message
        or "failed to read the 'localstorage' property" in message
        or "securityerror" in message
    )


# ---------------------------------------------------------------------------
# Xiaohongshu auth-probe fallback
# ---------------------------------------------------------------------------

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


# ---------------------------------------------------------------------------
# Core script runner
# ---------------------------------------------------------------------------

async def run_playwright_script(
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
    playwright = await get_playwright_runtime()
    storage_state = request.auth_data if isinstance(request.auth_data, dict) else options.get("storage_state")
    if options.get("pool_enabled"):
        _, entry = await acquire_pooled_entry(playwright, options, request, storage_state)
        page = await acquire_pooled_page(entry, storage_state)
        try:
            if init_script:
                await page.add_init_script(init_script)
            if target_url:
                await page.goto(target_url, wait_until=wait_until, timeout=options["navigation_timeout_ms"])
                if wait_selector:
                    await page.wait_for_selector(wait_selector, timeout=options["navigation_timeout_ms"])
                if post_navigation_wait_ms > 0:
                    await page.wait_for_timeout(post_navigation_wait_ms)
            try:
                script_result = await page.evaluate(script_to_run)
            except Exception as error:
                fallback_target_url = resolve_default_target_url(request.platform)
                if (
                    allow_origin_fallback
                    and not target_url
                    and fallback_target_url
                    and _looks_like_origin_security_error(error)
                ):
                    await page.goto(fallback_target_url, wait_until=wait_until, timeout=options["navigation_timeout_ms"])
                    if post_navigation_wait_ms > 0:
                        await page.wait_for_timeout(post_navigation_wait_ms)
                    script_result = await page.evaluate(script_to_run)
                else:
                    raise
            if callable(post_evaluate_hook):
                return await post_evaluate_hook(page, script_result, request)
            return script_result
        finally:
            await release_pooled_page(entry, page)

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
            await page.goto(target_url, wait_until=wait_until, timeout=options["navigation_timeout_ms"])
            if wait_selector:
                await page.wait_for_selector(wait_selector, timeout=options["navigation_timeout_ms"])
            if post_navigation_wait_ms > 0:
                await page.wait_for_timeout(post_navigation_wait_ms)
        try:
            script_result = await page.evaluate(script_to_run)
        except Exception as error:
            fallback_target_url = resolve_default_target_url(request.platform)
            if (
                allow_origin_fallback
                and not target_url
                and fallback_target_url
                and _looks_like_origin_security_error(error)
            ):
                await page.goto(fallback_target_url, wait_until=wait_until, timeout=options["navigation_timeout_ms"])
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


# ---------------------------------------------------------------------------
# Result normalization helpers
# ---------------------------------------------------------------------------

def to_clean_item_from_eval_value(
    value: Any, request: FetchRequest, target_url: str | None, index: int
) -> CleanItem:
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


def normalize_playwright_eval_result(
    result: Any, request: FetchRequest, target_url: str | None
) -> list[CleanItem]:
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
            to_clean_item_from_eval_value(item, request, target_url, index)
            for index, item in enumerate(candidate, start=1)
        ]
    return [to_clean_item_from_eval_value(candidate, request, target_url, 1)]


# ---------------------------------------------------------------------------
# Eval-mode runner
# ---------------------------------------------------------------------------

async def run_eval_script(request: FetchRequest) -> list[CleanItem]:
    from playwright.async_api import TimeoutError as PlaywrightTimeoutError

    options = extract_eval_options(request.config)
    script_to_run = f"({options['script_body']})({options['args_json']})"

    try:
        eval_result = await run_playwright_script(
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

    items = normalize_playwright_eval_result(eval_result, request, options["target_url"])
    if not items:
        raise HTTPException(status_code=500, detail="playwright eval script finished without output")
    return items
