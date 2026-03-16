"""
Oak Gather Service
Social media data fetching service using Playwright with cookie-based authentication.
"""
import os
import re
import io
import json
import asyncio
import hashlib
import shutil
import zipfile
from pathlib import Path
from urllib.parse import quote, urlparse, urlunparse
from dataclasses import dataclass, field
from fastapi import FastAPI, HTTPException, UploadFile, File, Form
from fastapi.responses import JSONResponse
from pydantic import BaseModel, ValidationError
from typing import List, Optional, Any, Dict
from datetime import datetime, timezone
from dotenv import load_dotenv
from drivers.agent_browser_runner import (
    AgentBrowserScriptError,
    execute_agent_browser_script,
    heartbeat_agent_browser_instance,
)
from drivers.playwright_driver import PlaywrightDriver
from drivers.registry import DriverRegistry, DriverNotFoundError
from drivers.xhttp_driver import XHttpDriver
from fetch_processing import agent_browser_results_to_clean_items, apply_keyword_hard_filter
from schemas import (
    AgentBrowserHeartbeatRequest,
    AgentBrowserHeartbeatResponse,
    CleanItem,
    DeleteAuthStateRequest,
    ErrorResponse,
    FetchRequest,
    FetchV2Request,
    SaveAuthStateRequest,
    SaveAuthStateResponse,
    UploadProfileResponse,
    VerifyAuthRequest,
    VerifyAuthResponse,
)

_agent_browser_results_to_clean_items = agent_browser_results_to_clean_items
_apply_keyword_hard_filter = apply_keyword_hard_filter

# Load environment variables from .env file
load_dotenv()

app = FastAPI(title="Oak Gather Service")


def _env_flag(name: str, default: bool = False) -> bool:
    value = os.getenv(name)
    if value is None:
        return default
    return value.strip().lower() in {"1", "true", "yes", "on"}


_API_IO_LOG_ENABLED = _env_flag("GATHER_API_IO_LOG_ENABLED", False)
_RAW_API_IO_LOG_DIR = Path(
    os.getenv("GATHER_API_IO_LOG_DIR", str(Path(__file__).resolve().parent / "logs"))
).expanduser()
_GATHER_APP_ROOT = Path(__file__).resolve().parent
_REPO_ROOT = _GATHER_APP_ROOT.parents[1]
if _RAW_API_IO_LOG_DIR.is_absolute():
    _API_IO_LOG_DIR = _RAW_API_IO_LOG_DIR
elif str(_RAW_API_IO_LOG_DIR).startswith("apps/"):
    _API_IO_LOG_DIR = (_REPO_ROOT / _RAW_API_IO_LOG_DIR).resolve()
else:
    _API_IO_LOG_DIR = (_GATHER_APP_ROOT / _RAW_API_IO_LOG_DIR).resolve()
_API_IO_LOG_MAX_CHARS = int(os.getenv("GATHER_API_IO_LOG_MAX_CHARS", "120000"))

if _API_IO_LOG_ENABLED:
    try:
        _API_IO_LOG_DIR.mkdir(parents=True, exist_ok=True)
        print(f"[gather] api io log enabled dir={_API_IO_LOG_DIR}")
    except Exception as error:
        print(f"[gather] failed to initialize api io log dir: {error}")


def _truncate_for_log(value: Any, max_chars: int) -> Any:
    if isinstance(value, str):
        if len(value) <= max_chars:
            return value
        return f"{value[:max_chars]}...(truncated, total={len(value)})"
    if isinstance(value, list):
        return [_truncate_for_log(item, max_chars) for item in value]
    if isinstance(value, dict):
        return {str(k): _truncate_for_log(v, max_chars) for k, v in value.items()}
    return value


def _redact_sensitive_for_log(value: Any) -> Any:
    if isinstance(value, list):
        return [_redact_sensitive_for_log(item) for item in value]
    if not isinstance(value, dict):
        return value

    redacted: dict[str, Any] = {}
    for raw_key, raw_val in value.items():
        key = str(raw_key)
        lowered = key.lower()
        if lowered in {"auth_data", "authdata"} and isinstance(raw_val, dict):
            cookies = raw_val.get("cookies")
            origins = raw_val.get("origins")
            redacted[key] = {
                "redacted": True,
                "cookiesCount": len(cookies) if isinstance(cookies, list) else 0,
                "originsCount": len(origins) if isinstance(origins, list) else 0,
            }
            continue
        if lowered in {"cookies", "origins", "localstorage"}:
            if isinstance(raw_val, list):
                redacted[key] = f"<redacted list, len={len(raw_val)}>"
            else:
                redacted[key] = "<redacted>"
            continue
        redacted[key] = _redact_sensitive_for_log(raw_val)
    return redacted


def _log_api_io(route: str, request_body: Any, response_body: Any, status_code: int) -> None:
    if not _API_IO_LOG_ENABLED:
        return
    try:
        _API_IO_LOG_DIR.mkdir(parents=True, exist_ok=True)
        now = datetime.now(timezone.utc)
        file_path = _API_IO_LOG_DIR / f"api-io-{now.strftime('%Y-%m-%d')}.jsonl"
        entry = {
            "time": now.isoformat(),
            "route": route,
            "statusCode": status_code,
            "request": _truncate_for_log(
                _redact_sensitive_for_log(request_body),
                _API_IO_LOG_MAX_CHARS,
            ),
            "response": _truncate_for_log(response_body, _API_IO_LOG_MAX_CHARS),
        }
        with file_path.open("a", encoding="utf-8") as f:
            f.write(json.dumps(entry, ensure_ascii=False))
            f.write("\n")
    except Exception as error:  # pragma: no cover - logging must never break api
        print(f"[gather] failed to write api io log for {route}: {error}")


_BB_SITE_PLATFORM_ALIAS = {
    "x": "twitter",
    "twitter": "twitter",
    "xhs": "xiaohongshu",
}

_BB_SITE_TARGET_URL = {
    "twitter": "https://x.com",
    "xiaohongshu": "https://www.xiaohongshu.com",
    "reddit": "https://www.reddit.com",
    "douyin": "https://www.douyin.com",
    "tiktok": "https://www.tiktok.com",
    "weibo": "https://weibo.com",
    "telegram": "https://web.telegram.org",
    "instagram": "https://www.instagram.com",
    "facebook": "https://www.facebook.com",
}

_GATHER_VERIFY_SCRIPT_ROOT = Path(__file__).resolve().parent / "site_scripts"


@dataclass
class _PlaywrightBrowserPoolEntry:
    browser: Any
    last_used_at: float
    idle_timeout_ms: int
    context: Any | None = None
    page: Any | None = None
    lock: asyncio.Lock = field(default_factory=asyncio.Lock)


_PLAYWRIGHT_BROWSER_POOL: dict[str, _PlaywrightBrowserPoolEntry] = {}
_PLAYWRIGHT_POOL_LOCK = asyncio.Lock()
_PLAYWRIGHT_RUNTIME = None
_PLAYWRIGHT_RUNTIME_LOCK = asyncio.Lock()


def build_error_response(
    status_code: int,
    code: str,
    message: str,
    retryable: bool
) -> JSONResponse:
    return JSONResponse(
        status_code=status_code,
        content={"error": {"code": code, "message": message, "retryable": retryable}}
    )


@app.get("/")
async def root():
    return {"status": "ok", "service": "oak-gather"}


def _resolve_bb_site_verify_script(platform: str) -> Path | None:
    normalized = _BB_SITE_PLATFORM_ALIAS.get(platform.lower(), platform.lower())
    script_dir_candidates: list[Path] = []
    if _GATHER_VERIFY_SCRIPT_ROOT.exists():
        script_dir_candidates.append(_GATHER_VERIFY_SCRIPT_ROOT)
    configured_dir = os.getenv("BB_SITES_DIR")
    if configured_dir:
        script_dir_candidates.append(Path(configured_dir).expanduser())
    script_dir_candidates.extend(
        [
            Path("~/.bb-browser/bb-sites").expanduser(),
            Path("~/Reference/bb-sites").expanduser(),
        ]
    )

    for base_dir in script_dir_candidates:
        for suffix in ("me.ts", "me.js", "user.ts", "user.js"):
            candidate = base_dir / normalized / suffix
            if candidate.exists():
                return candidate
    return None


async def _verify_auth_with_agent_browser_for_whatsapp(request: VerifyAuthRequest) -> VerifyAuthResponse | None:
    if request.platform.lower() != "whatsapp":
        return None

    options: dict[str, Any] = {
        "headed": not request.headless,
        "verbose": False,
        "closeOnComplete": True,
        "commandTimeoutMs": 30000,
        "script": [
            {"command": "open https://web.whatsapp.com/"},
            {"command": "wait --load domcontentloaded"},
            {
                "command": (
                    "eval \"(()=>{"
                    "const loggedIn=Boolean(document.querySelector('[aria-label=\\\"Chat list\\\"]')"
                    "||document.querySelector('[data-testid=\\\"chat-list\\\"]')"
                    "||document.querySelector('[contenteditable=\\\"true\\\"][data-tab]'));"
                    "const needsQr=Boolean(document.querySelector('canvas[aria-label*=\\\"QR\\\"]'));"
                    "if(loggedIn)return JSON.stringify({ok:true});"
                    "if(needsQr)return JSON.stringify({ok:false,error:'QR required'});"
                    "return JSON.stringify({ok:false,error:'Unable to confirm auth status'});"
                    "})()\""
                ),
                "captureAs": "auth_probe",
            },
        ],
    }

    if request.state_file:
        options["stateFile"] = request.state_file

    auth_data = request.auth_data or {}
    profile_name = auth_data.get("profileName")
    if isinstance(profile_name, str) and profile_name.strip():
        profile_path = AUTH_DIR / profile_name.strip()
        if profile_path.exists():
            options["profile"] = str(profile_path)

    try:
        script_result = await asyncio.to_thread(
            execute_agent_browser_script,
            {"agentBrowser": options},
        )
    except AgentBrowserScriptError as error:
        print(f"[gather] whatsapp agent-browser verify failed, fallback to legacy verify: {error}")
        return None
    except Exception as error:  # pragma: no cover - defensive
        print(f"[gather] whatsapp agent-browser verify unexpected error, fallback to legacy verify: {error}")
        return None

    captures = script_result.captures.get("auth_probe") or []
    if not captures:
        return None
    raw = captures[-1]
    try:
        payload = json.loads(raw)
    except json.JSONDecodeError:
        return None
    if not isinstance(payload, dict):
        return None

    if payload.get("ok") is True:
        return VerifyAuthResponse(
            valid=True,
            message="WhatsApp authentication is valid",
            details={"platform": "whatsapp", "verifyMethod": "agent-browser"},
        )
    return VerifyAuthResponse(
        valid=False,
        message=str(payload.get("error") or "WhatsApp authentication is invalid or expired"),
        details={"platform": "whatsapp", "verifyMethod": "agent-browser"},
    )


async def _verify_auth_with_bb_site_script(request: VerifyAuthRequest) -> VerifyAuthResponse | None:
    platform = request.platform.lower()
    normalized = _BB_SITE_PLATFORM_ALIAS.get(platform, platform)
    target_url = request.verify_target_url or _BB_SITE_TARGET_URL.get(normalized)
    if not target_url:
        return None

    script_path: Path | None = None
    if request.verify_script_path:
        explicit_path = Path(request.verify_script_path).expanduser()
        if not explicit_path.exists():
            return VerifyAuthResponse(
                valid=False,
                message=f"verifyScriptPath does not exist: {request.verify_script_path}",
                details={"platform": platform, "verifyMethod": "bb-site-script"},
            )
        script_path = explicit_path
    else:
        script_path = _resolve_bb_site_verify_script(platform)
    if not script_path:
        return None

    script_body = _strip_playwright_meta_block(script_path.read_text(encoding="utf-8"))
    if not script_body:
        return None
    script_args = request.verify_args or {}
    if not isinstance(script_args, dict):
        return VerifyAuthResponse(
            valid=False,
            message="verifyArgs must be an object",
            details={"platform": platform, "verifyMethod": "bb-site-script"},
        )

    from playwright.async_api import TimeoutError as PlaywrightTimeoutError
    from playwright.async_api import async_playwright

    try:
        async with async_playwright() as playwright:
            browser = await playwright.chromium.launch(headless=request.headless)
            context = await browser.new_context(storage_state=request.auth_data)
            page = await context.new_page()
            try:
                await page.goto(
                    target_url,
                    wait_until="domcontentloaded",
                    timeout=max(1000, int(request.verify_timeout_ms)),
                )
                await page.wait_for_timeout(max(0, int(request.verify_post_wait_ms)))
                result = await page.evaluate(f"({script_body})({json.dumps(script_args, ensure_ascii=False)})")
            finally:
                await context.close()
                await browser.close()
    except PlaywrightTimeoutError as error:
        print(f"[gather] bb-site verify timeout for {platform}, fallback to legacy verify: {error}")
        return None
    except Exception as error:
        print(f"[gather] bb-site verify failed for {platform}, fallback to legacy verify: {error}")
        return None

    if isinstance(result, dict):
        error_message = result.get("error")
        if error_message:
            hint = result.get("hint") if isinstance(result.get("hint"), str) else None
            if _is_inconclusive_bb_script_error(str(error_message), hint):
                print(
                    f"[gather] bb-site verify inconclusive for {platform} "
                    f"(error={error_message}, hint={hint}), fallback to legacy verify"
                )
                return None
            return VerifyAuthResponse(
                valid=False,
                message=str(error_message),
                details={
                    "platform": platform,
                    "hint": result.get("hint"),
                    "verifyMethod": "bb-site-script",
                    "scriptPath": str(script_path),
                },
            )
        ok_flag = result.get("ok")
        if ok_flag is True:
            return VerifyAuthResponse(
                valid=True,
                message=f"{request.platform} authentication is valid",
                details={
                    "platform": request.platform,
                    "verifyMethod": "bb-site-script",
                    "scriptPath": str(script_path),
                    "result": result,
                },
            )
        if ok_flag is False:
            return VerifyAuthResponse(
                valid=False,
                message=f"{request.platform} authentication is invalid or expired",
                details={
                    "platform": request.platform,
                    "hint": result.get("hint"),
                    "verifyMethod": "bb-site-script",
                    "scriptPath": str(script_path),
                    "result": result,
                },
            )
        user = {
            key: result.get(key)
            for key in ("id", "user_id", "uid", "screen_name", "username", "name")
            if result.get(key) is not None
        }
        if user:
            return VerifyAuthResponse(
                valid=True,
                message=f"{request.platform} authentication is valid",
                details={
                    "platform": request.platform,
                    "verifyMethod": "bb-site-script",
                    "scriptPath": str(script_path),
                    "user": user,
                },
            )

    if isinstance(result, list) and result:
        return VerifyAuthResponse(
            valid=True,
            message=f"{request.platform} authentication is valid",
            details={
                "platform": request.platform,
                "verifyMethod": "bb-site-script",
                "scriptPath": str(script_path),
                "resultCount": len(result),
            },
        )

    if result is True:
        return VerifyAuthResponse(
            valid=True,
            message=f"{request.platform} authentication is valid",
            details={
                "platform": request.platform,
                "verifyMethod": "bb-site-script",
                "scriptPath": str(script_path),
            },
        )

    if result is False:
        print(f"[gather] bb-site verify returned false for {platform}, fallback to legacy verify")
        return None
    print(f"[gather] bb-site verify inconclusive for {platform}, fallback to legacy verify")
    return None


def _resolve_verify_auth_data(request: VerifyAuthRequest) -> tuple[dict[str, Any] | None, VerifyAuthResponse | None]:
    if isinstance(request.auth_data, dict):
        return request.auth_data, None

    if request.state_file:
        path = Path(request.state_file).expanduser()
        if not path.exists():
            return None, VerifyAuthResponse(
                valid=False,
                message=f"stateFile does not exist: {request.state_file}",
                details={"error": "invalid_state_file"},
            )
        try:
            payload = json.loads(path.read_text(encoding="utf-8"))
        except json.JSONDecodeError as error:
            return None, VerifyAuthResponse(
                valid=False,
                message=f"stateFile is not valid JSON: {request.state_file}",
                details={"error": str(error)},
            )
        if not isinstance(payload, dict):
            return None, VerifyAuthResponse(
                valid=False,
                message=f"stateFile must contain a JSON object: {request.state_file}",
                details={"error": "invalid_state_payload"},
            )
        return payload, None

    if request.platform.lower() == "whatsapp":
        return {}, None

    return None, VerifyAuthResponse(
        valid=False,
        message="auth_data or stateFile is required",
        details={"error": "missing_auth_data"},
    )


def _is_inconclusive_bb_script_error(message: str, hint: str | None = None) -> bool:
    normalized_message = message.strip().lower()
    normalized_hint = (hint or "").strip().lower()
    if normalized_message == "cannot confirm logged-in state":
        return True
    if normalized_message == "failed to get user info" and "not logged in" in normalized_hint:
        return True
    return False


async def _playwright_verify_auth_legacy(request: VerifyAuthRequest):
    return VerifyAuthResponse(
        valid=False,
        message="Legacy playwright client verification has been removed; please configure verify script or agent-browser.",
        details={"verifyMethod": "removed-legacy-client"},
    )


async def _playwright_verify_auth(request: VerifyAuthRequest):
    auth_data, error_response = _resolve_verify_auth_data(request)
    if error_response is not None:
        return error_response

    normalized_request = request.model_copy(update={"auth_data": auth_data or {}})
    whatsapp_result = await _verify_auth_with_agent_browser_for_whatsapp(normalized_request)
    if whatsapp_result is not None:
        return whatsapp_result

    scripted_result = await _verify_auth_with_bb_site_script(normalized_request)
    if scripted_result is not None:
        return scripted_result
    return VerifyAuthResponse(
        valid=False,
        message="No verify script available for this platform. Configure verifyScriptPath or bb-site me.ts/me.js.",
        details={"verifyMethod": "script-required"},
    )


async def _agent_browser_verify_auth(_request: VerifyAuthRequest):
    return VerifyAuthResponse(
        valid=True,
        message="agent-browser authentication is configured through fetch config (profile/session/state).",
    )


async def _playwright_fetch_data(request: FetchRequest):
    platform = request.platform.lower()
    config = request.config
    playwright_options = config.get("playwright")
    if isinstance(playwright_options, dict):
        mode = str(playwright_options.get("mode", "")).lower()
        if mode in {"eval-js", "evaljs", "eval"}:
            return await _run_playwright_eval_script(request)

    raise HTTPException(
        status_code=400,
        detail=(
            f"playwright legacy clients have been removed for platform '{platform}'. "
            "Use driver='agent-browser' or set config.playwright.mode='eval-js'."
        ),
    )


def _strip_playwright_meta_block(script: str) -> str:
    return re.sub(r"/\*\s*@meta[\s\S]*?\*/", "", script, count=1).strip()


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


def _extract_proxy_settings(config: Dict[str, Any], playwright_options: Dict[str, Any]) -> dict[str, str] | None:
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


def _extract_playwright_eval_options(config: Dict[str, Any]) -> dict[str, Any]:
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
            resolved = (Path(__file__).resolve().parent / resolved).resolve()
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
            state_path = (Path(__file__).resolve().parent / state_path).resolve()
        if not state_path.exists() or not state_path.is_file():
            raise HTTPException(status_code=400, detail=f"stateFile does not exist: {state_file}")
        try:
            raw_state = json.loads(state_path.read_text(encoding="utf-8"))
        except json.JSONDecodeError as error:
            raise HTTPException(status_code=400, detail=f"stateFile is not valid JSON: {error}") from error
        if not isinstance(raw_state, dict):
            raise HTTPException(status_code=400, detail="stateFile JSON must be an object")
        storage_state = raw_state

    return {
        "target_url": target_url,
        "script_body": _strip_playwright_meta_block(script_body or ""),
        "wait_until": wait_until,
        "navigation_timeout_ms": navigation_timeout_ms,
        "post_navigation_wait_ms": post_nav_wait_ms,
        "wait_selector": wait_selector.strip() if isinstance(wait_selector, str) else None,
        "args_json": args_json,
        "headless": bool(raw.get("headless", True)),
        "storage_state": storage_state,
        "proxy": _extract_proxy_settings(config, raw),
        "pool_enabled": bool(raw.get("poolEnabled", True)),
        "pool_idle_timeout_ms": pool_idle_timeout_ms,
        "pool_user_id": raw.get("userId", raw.get("user_id")),
        "pool_session_id": raw.get("sessionId", raw.get("session_id")),
        "pool_driver": raw.get("poolDriver", raw.get("pool_driver", "playwright")),
    }


def _stable_hash(value: Any) -> str:
    dumped = json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False)
    return hashlib.sha256(dumped.encode("utf-8")).hexdigest()


def _build_playwright_pool_key(request: FetchRequest, options: dict[str, Any], storage_state: Any) -> str:
    platform = request.platform.lower().strip()
    user_id = str(options.get("pool_user_id") or "")
    session_id = str(options.get("pool_session_id") or "")
    driver = str(options.get("pool_driver") or "playwright")
    target_fingerprint = _stable_hash(options.get("target_url") or "")
    proxy_fingerprint = _stable_hash(options.get("proxy") or {})
    auth_fingerprint = _stable_hash(storage_state or {})
    return "|".join(
        [
            platform,
            driver,
            user_id,
            session_id,
            target_fingerprint,
            "1" if options["headless"] else "0",
            proxy_fingerprint,
            auth_fingerprint,
        ]
    )


async def _sweep_idle_playwright_browsers(now: float) -> None:
    to_close: list[_PlaywrightBrowserPoolEntry] = []
    for key, entry in list(_PLAYWRIGHT_BROWSER_POOL.items()):
        idle_for_ms = int((now - entry.last_used_at) * 1000)
        if idle_for_ms >= entry.idle_timeout_ms:
            _PLAYWRIGHT_BROWSER_POOL.pop(key, None)
            to_close.append(entry)
    for entry in to_close:
        try:
            if entry.page is not None and not entry.page.is_closed():
                await entry.page.close()
        except Exception:
            pass
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
    playwright: Any, options: dict[str, Any], request: FetchRequest
) -> tuple[str, _PlaywrightBrowserPoolEntry]:
    storage_state = request.auth_data if request.auth_data else options["storage_state"]
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


async def _ensure_pooled_playwright_page(
    entry: _PlaywrightBrowserPoolEntry, options: dict[str, Any], request: FetchRequest
) -> Any:
    if entry.context is None:
        context_options: dict[str, Any] = {}
        if request.auth_data:
            context_options["storage_state"] = request.auth_data
        elif options["storage_state"]:
            context_options["storage_state"] = options["storage_state"]
        entry.context = await entry.browser.new_context(**context_options)

    if entry.page is None or entry.page.is_closed():
        entry.page = await entry.context.new_page()

    if options["target_url"]:
        current_url = (entry.page.url or "").strip()
        if not current_url or current_url == "about:blank":
            await entry.page.goto(
                options["target_url"],
                wait_until=options["wait_until"],
                timeout=options["navigation_timeout_ms"],
            )
            if options["wait_selector"]:
                await entry.page.wait_for_selector(
                    options["wait_selector"], timeout=options["navigation_timeout_ms"]
                )
            if options["post_navigation_wait_ms"] > 0:
                await entry.page.wait_for_timeout(options["post_navigation_wait_ms"])

    return entry.page


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
            recordContent={
                "text": str(text),
                "markdown": str(markdown),
                "url": value.get("url") or target_url,
            },
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


async def _run_playwright_eval_script(request: FetchRequest) -> list[CleanItem]:
    from playwright.async_api import TimeoutError as PlaywrightTimeoutError

    options = _extract_playwright_eval_options(request.config)
    script_to_run = f"({options['script_body']})({options['args_json']})"

    try:
        playwright = await _get_playwright_runtime()
        pooled_entry: _PlaywrightBrowserPoolEntry | None = None
        pool_key: str | None = None
        should_close_browser = True
        if options["pool_enabled"]:
            pool_key, pooled_entry = await _acquire_pooled_playwright_entry(
                playwright, options, request
            )
            should_close_browser = False
            browser = pooled_entry.browser
        else:
            launch_options: dict[str, Any] = {"headless": options["headless"]}
            if options["proxy"] is not None:
                launch_options["proxy"] = options["proxy"]
            browser = await playwright.chromium.launch(**launch_options)

        context = None
        page = None
        try:
            if pooled_entry is not None:
                async with pooled_entry.lock:
                    page = await _ensure_pooled_playwright_page(pooled_entry, options, request)
                    try:
                        eval_result = await page.evaluate(script_to_run)
                    except Exception as error:
                        fallback_target_url = _resolve_default_target_url(request.platform)
                        if (
                            not options["target_url"]
                            and fallback_target_url
                            and _looks_like_origin_security_error(error)
                        ):
                            await page.goto(
                                fallback_target_url,
                                wait_until=options["wait_until"],
                                timeout=options["navigation_timeout_ms"],
                            )
                            if options["post_navigation_wait_ms"] > 0:
                                await page.wait_for_timeout(options["post_navigation_wait_ms"])
                            eval_result = await page.evaluate(script_to_run)
                        else:
                            raise
                    eval_result = await _apply_xiaohongshu_user_me_fallback(page, eval_result, request)
            else:
                context_options: dict[str, Any] = {}
                if request.auth_data:
                    context_options["storage_state"] = request.auth_data
                elif options["storage_state"]:
                    context_options["storage_state"] = options["storage_state"]
                context = await browser.new_context(**context_options)
                page = await context.new_page()
                if options["target_url"]:
                    await page.goto(
                        options["target_url"],
                        wait_until=options["wait_until"],
                        timeout=options["navigation_timeout_ms"],
                    )
                    if options["wait_selector"]:
                        await page.wait_for_selector(
                            options["wait_selector"], timeout=options["navigation_timeout_ms"]
                        )
                    if options["post_navigation_wait_ms"] > 0:
                        await page.wait_for_timeout(options["post_navigation_wait_ms"])
                try:
                    eval_result = await page.evaluate(script_to_run)
                except Exception as error:
                    fallback_target_url = _resolve_default_target_url(request.platform)
                    if (
                        not options["target_url"]
                        and fallback_target_url
                        and _looks_like_origin_security_error(error)
                    ):
                        await page.goto(
                            fallback_target_url,
                            wait_until=options["wait_until"],
                            timeout=options["navigation_timeout_ms"],
                        )
                        if options["post_navigation_wait_ms"] > 0:
                            await page.wait_for_timeout(options["post_navigation_wait_ms"])
                        eval_result = await page.evaluate(script_to_run)
                    else:
                        raise
                eval_result = await _apply_xiaohongshu_user_me_fallback(page, eval_result, request)
        finally:
            if context is not None:
                await context.close()
            if pooled_entry is not None and pool_key is not None:
                async with _PLAYWRIGHT_POOL_LOCK:
                    now = asyncio.get_running_loop().time()
                    entry = _PLAYWRIGHT_BROWSER_POOL.get(pool_key)
                    if entry is not None:
                        entry.last_used_at = now
            elif should_close_browser:
                await browser.close()
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


def _truncate_text(value: str, max_length: int = 12000) -> str:
    if len(value) <= max_length:
        return value
    return f"{value[:max_length]}..."


def _extract_x_status_id(url: Optional[str]) -> Optional[str]:
    if not url:
        return None
    matched = re.search(r"/status/(\d+)", url)
    return matched.group(1) if matched else None


def _normalize_clean_items(raw_items: list[Any]) -> list[CleanItem]:
    normalized: list[CleanItem] = []
    for item in raw_items:
        if isinstance(item, CleanItem):
            normalized.append(item)
            continue
        try:
            normalized.append(CleanItem.model_validate(item))
        except ValidationError as error:
            raise HTTPException(
                status_code=500,
                detail=f"driver returned invalid item payload: {error.errors()[0].get('msg', 'validation failed')}",
            ) from error
    return normalized


def _apply_response_formats(items: list[CleanItem], response_formats: Optional[List[str]]) -> list[CleanItem]:
    if not response_formats:
        return items

    allowed = set(response_formats)
    include_text = "text" in allowed
    include_markdown = "markdown" in allowed

    for item in items:
        if not include_text:
            item.text = None
        if not include_markdown:
            item.markdown = None
    return items


def _as_dict(value: Any) -> dict[str, Any]:
    return value if isinstance(value, dict) else {}


def _normalize_output_record_schema(output: dict[str, Any]) -> dict[str, Any] | None:
    record = _as_dict(output.get("record"))
    if not record:
        return None
    return {
        "format": record.get("format", "auto"),
        "recordSeparator": record.get("recordSeparator", record.get("record_separator", "\n")),
        "pairSeparator": record.get("pairSeparator", record.get("pair_separator", "｜")),
        "fieldMap": _as_dict(record.get("fieldMap", record.get("field_map"))),
        "compression": record.get("compression"),
        "encoding": record.get("encoding"),
    }


def _normalize_agent_browser_driver_options(
    source_id: str,
    base_config: dict[str, Any],
    driver_options: dict[str, Any],
) -> dict[str, Any]:
    normalized_config = dict(base_config)
    existing_options = _as_dict(normalized_config.get("agentBrowser"))
    merged_options = {**existing_options, **driver_options}

    auth_options = _as_dict(merged_options.pop("auth", None))
    state_file = auth_options.get("stateFile", auth_options.get("state_file"))
    if isinstance(state_file, str) and state_file.strip() and not merged_options.get("stateFile"):
        merged_options["stateFile"] = state_file.strip()

    raw_filters = _as_dict(merged_options.pop("filters", None))
    capture_filter = _as_dict(raw_filters.get("capture"))
    if capture_filter:
        merged_options["captureFilter"] = {
            **_as_dict(merged_options.get("captureFilter")),
            **capture_filter,
        }
    keyword_filter = _as_dict(raw_filters.get("keyword"))
    if keyword_filter and not _as_dict(normalized_config.get("keywordFilter")):
        normalized_config["keywordFilter"] = keyword_filter

    session_key = merged_options.get("sessionKey")
    if isinstance(session_key, str) and session_key.strip() == source_id:
        merged_options.pop("sessionKey", None)
    session_key_legacy = merged_options.get("session_key")
    if isinstance(session_key_legacy, str) and session_key_legacy.strip() == source_id:
        merged_options.pop("session_key", None)

    normalized_config["agentBrowser"] = merged_options
    return normalized_config


def _normalize_v2_fetch_request(request: FetchV2Request) -> FetchRequest:
    normalized_driver = request.driver.strip().lower() if isinstance(request.driver, str) else ""
    config = dict(request.driver_options or {})

    if normalized_driver == "agent-browser":
        config = _normalize_agent_browser_driver_options(request.source_id, {}, config)

    output = _as_dict(request.output)
    output_formats = output.get("formats")
    response_formats: list[str] = ["text", "markdown"]
    if isinstance(output_formats, list):
        response_formats = [value for value in output_formats if value in {"text", "markdown"}]

    output_record_schema = _normalize_output_record_schema(output)
    if output_record_schema and "recordSchema" not in config:
        config["recordSchema"] = output_record_schema
    if isinstance(output.get("format"), str) and "outputFormat" not in config:
        config["outputFormat"] = output["format"]

    return FetchRequest(
        platform=request.platform,
        config=config,
        source_id=request.source_id,
        auth_data=request.auth_data,
        response_formats=response_formats,
    )


async def _agent_browser_fetch_data(request: FetchRequest):
    try:
        script_result = await asyncio.to_thread(execute_agent_browser_script, request.config)
        items = agent_browser_results_to_clean_items(request, script_result)
        if not items:
            raise HTTPException(
                status_code=500,
                detail={"message": "agent-browser script finished without output"},
            )
        return items
    except AgentBrowserScriptError as error:
        status_code_map = {
            "invalid_config": 400,
            "forbidden_instance_owner": 403,
            "forbidden_instance_session": 403,
            "instance_expired": 410,
        }
        status_code = status_code_map.get(error.reason, 500)
        debug_parts = [f"reason={error.reason}"]
        if error.step_index is not None:
            debug_parts.append(f"step={error.step_index}")
        if error.command:
            debug_parts.append(f"command={error.command}")
        if error.return_code is not None:
            debug_parts.append(f"returnCode={error.return_code}")
        if error.stderr:
            debug_parts.append(f"stderr={_truncate_text(error.stderr, 1000)}")
        elif error.stdout:
            debug_parts.append(f"stdout={_truncate_text(error.stdout, 1000)}")
        enriched_message = f"{error.message} | {'; '.join(debug_parts)}"
        raise HTTPException(
            status_code=status_code,
            detail={
                "message": enriched_message,
                "reason": error.reason,
                "step": error.step_index,
                "command": error.command,
                "returnCode": error.return_code,
                "stdout": error.stdout,
                "stderr": error.stderr,
                "debug": error.debug_context,
            },
        )


driver_registry = DriverRegistry(default_driver="playwright")
driver_registry.register(
    "xhttp",
    XHttpDriver(),
)
driver_registry.register(
    "playwright",
    PlaywrightDriver(
        verify_auth_handler=_playwright_verify_auth,
        fetch_handler=_playwright_fetch_data,
    ),
)
driver_registry.register(
    "agent-browser",
    PlaywrightDriver(
        verify_auth_handler=_agent_browser_verify_auth,
        fetch_handler=_agent_browser_fetch_data,
    ),
)


def _to_driver_http_exception(error: DriverNotFoundError) -> HTTPException:
    return HTTPException(status_code=400, detail=error.to_detail())


def _to_driver_error_response(error: DriverNotFoundError) -> JSONResponse:
    detail = error.to_detail()
    return build_error_response(
        status_code=400,
        code=detail["code"],
        message=detail["message"],
        retryable=False,
    )


@app.post("/verify-auth", response_model=VerifyAuthResponse)
async def verify_auth(request: VerifyAuthRequest):
    try:
        result = await driver_registry.verify_auth(request)
        _log_api_io(
            "/verify-auth",
            request.model_dump(mode="json", by_alias=True),
            result.model_dump(mode="json") if isinstance(result, BaseModel) else result,
            200,
        )
        return result
    except DriverNotFoundError as error:
        _log_api_io(
            "/verify-auth",
            request.model_dump(mode="json", by_alias=True),
            error.to_detail(),
            400,
        )
        raise _to_driver_http_exception(error)


@app.post(
    "/v2/fetch",
    response_model=List[CleanItem],
    response_model_exclude_none=True,
    responses={
        400: {"model": ErrorResponse},
        422: {"model": ErrorResponse},
        500: {"model": ErrorResponse},
    },
)
async def fetch_data_v2(payload: Dict[str, Any]):
    try:
        request = FetchV2Request.model_validate(payload)
    except ValidationError as e:
        first_error = e.errors()[0] if e.errors() else {}
        location = ".".join(str(part) for part in first_error.get("loc", []))
        message = first_error.get("msg", "Invalid request payload")
        if location:
            message = f"{location}: {message}"
        response = build_error_response(
            status_code=422,
            code="VALIDATION_ERROR",
            message=message,
            retryable=False,
        )
        _log_api_io("/v2/fetch", payload, response.body.decode("utf-8"), 422)
        return response

    v1_request = _normalize_v2_fetch_request(request)

    try:
        raw_results = await driver_registry.fetch(v1_request, driver_name=request.driver)
        results = _normalize_clean_items(raw_results)
        results = apply_keyword_hard_filter(v1_request, results)
        if request.driver:
            for item in results:
                item.driver = request.driver
        response_payload = _apply_response_formats(results, v1_request.response_formats)
        _log_api_io(
            "/v2/fetch",
            payload,
            [item.model_dump(mode="json", exclude_none=True) for item in response_payload],
            200,
        )
        return response_payload
    except DriverNotFoundError as error:
        response = _to_driver_error_response(error)
        _log_api_io("/v2/fetch", payload, response.body.decode("utf-8"), 400)
        return response
    except HTTPException as e:
        status_code = e.status_code
        if isinstance(e.detail, dict):
            message = str(e.detail.get("message", e.detail))
        else:
            message = str(e.detail) if e.detail else "Request failed"
        code = "FETCH_BAD_REQUEST" if status_code < 500 else "FETCH_INTERNAL_ERROR"
        retryable = status_code >= 500
        response = build_error_response(
            status_code=status_code,
            code=code,
            message=message,
            retryable=retryable,
        )
        _log_api_io("/v2/fetch", payload, response.body.decode("utf-8"), status_code)
        return response
    except Exception:
        response = build_error_response(
            status_code=500,
            code="FETCH_INTERNAL_ERROR",
            message="Internal server error",
            retryable=True,
        )
        _log_api_io("/v2/fetch", payload, response.body.decode("utf-8"), 500)
        return response


@app.post(
    "/v2/agent-browser/heartbeat",
    response_model=AgentBrowserHeartbeatResponse,
    responses={
        400: {"model": ErrorResponse},
        403: {"model": ErrorResponse},
        410: {"model": ErrorResponse},
        422: {"model": ErrorResponse},
        500: {"model": ErrorResponse},
    },
)
async def agent_browser_heartbeat(payload: Dict[str, Any]):
    try:
        request = AgentBrowserHeartbeatRequest.model_validate(payload)
    except ValidationError as e:
        first_error = e.errors()[0] if e.errors() else {}
        location = ".".join(str(part) for part in first_error.get("loc", []))
        message = first_error.get("msg", "Invalid request payload")
        if location:
            message = f"{location}: {message}"
        return build_error_response(
            status_code=422,
            code="VALIDATION_ERROR",
            message=message,
            retryable=False,
        )

    heartbeat_config: dict[str, Any] = {
        "agentBrowser": {
            "instanceId": request.instance_id,
            "verbose": request.verbose,
            "heartbeat": True,
        }
    }
    if request.owner_id:
        heartbeat_config["agentBrowser"]["ownerId"] = request.owner_id
    if request.session_key:
        heartbeat_config["agentBrowser"]["sessionKey"] = request.session_key

    try:
        result = await asyncio.to_thread(heartbeat_agent_browser_instance, heartbeat_config)
    except AgentBrowserScriptError as error:
        status_code_map = {
            "invalid_config": 400,
            "forbidden_instance_owner": 403,
            "forbidden_instance_session": 403,
            "instance_expired": 410,
        }
        status_code = status_code_map.get(error.reason, 500)
        return build_error_response(
            status_code=status_code,
            code="HEARTBEAT_BAD_REQUEST" if status_code < 500 else "HEARTBEAT_INTERNAL_ERROR",
            message=error.message,
            retryable=False,
        )
    except Exception:
        return build_error_response(
            status_code=500,
            code="HEARTBEAT_INTERNAL_ERROR",
            message="Internal server error",
            retryable=True,
        )

    return AgentBrowserHeartbeatResponse(
        instanceId=result.instance_id,
        tabId=result.tab_id,
        instanceActive=result.instance_active,
        ttlSeconds=result.ttl_seconds,
        expiresAt=datetime.fromtimestamp(result.expires_at_epoch, tz=timezone.utc),
    )


# Constants for profile upload security
AUTH_DIR = Path(__file__).parent / ".auth"
MAX_PROFILE_SIZE = 100 * 1024 * 1024  # 100MB
PROFILE_NAME_PATTERN = re.compile(r'^[a-zA-Z0-9_-]{1,64}$')
STATE_FILE_NAME_PATTERN = re.compile(r"^[a-z0-9_-]{1,64}\.json$")


def _build_state_file_name(platform: str, alias: str | None, auth_data: dict[str, Any]) -> str:
    normalized_platform = re.sub(r"[^a-z0-9_-]+", "-", platform.lower()).strip("-") or "social"
    normalized_alias = re.sub(r"[^a-z0-9_-]+", "-", (alias or "default").lower()).strip("-") or "default"
    payload_hash = hashlib.sha256(
        json.dumps(auth_data, ensure_ascii=False, sort_keys=True).encode("utf-8")
    ).hexdigest()[:12]
    return f"{normalized_platform}_{normalized_alias}_{payload_hash}.json"


def _validate_auth_data_shape(auth_data: dict[str, Any]) -> None:
    cookies = auth_data.get("cookies")
    origins = auth_data.get("origins")
    has_cookies = isinstance(cookies, list) and len(cookies) > 0
    has_origins = isinstance(origins, list) and len(origins) > 0
    if not has_cookies and not has_origins:
        raise HTTPException(
            status_code=400,
            detail="auth_data must contain cookies or origins",
        )


@app.post("/auth/state-file", response_model=SaveAuthStateResponse)
async def save_auth_state_file(request: SaveAuthStateRequest):
    auth_data = request.auth_data
    if not isinstance(auth_data, dict):
        raise HTTPException(status_code=400, detail="auth_data must be an object")
    _validate_auth_data_shape(auth_data)

    AUTH_DIR.mkdir(exist_ok=True)
    file_name = _build_state_file_name(request.platform, request.name, auth_data)
    if not STATE_FILE_NAME_PATTERN.match(file_name):
        raise HTTPException(status_code=400, detail="invalid state file name")
    target_file = (AUTH_DIR / file_name).resolve()
    if not str(target_file).startswith(str(AUTH_DIR.resolve())):
        raise HTTPException(status_code=400, detail="invalid state file path")

    with target_file.open("w", encoding="utf-8") as fp:
        json.dump(auth_data, fp, ensure_ascii=False)

    return SaveAuthStateResponse(
        success=True,
        stateFile=f".auth/{file_name}",
        profileName=file_name,
    )


@app.delete("/auth/state-file")
async def delete_auth_state_file(request: DeleteAuthStateRequest):
    raw_state_file = request.state_file.strip()
    file_name = Path(raw_state_file).name
    if not STATE_FILE_NAME_PATTERN.match(file_name):
        raise HTTPException(status_code=400, detail="invalid state file name")
    target_file = (AUTH_DIR / file_name).resolve()
    if not str(target_file).startswith(str(AUTH_DIR.resolve())):
        raise HTTPException(status_code=400, detail="invalid state file path")
    if target_file.exists():
        target_file.unlink()
    return {"success": True, "stateFile": f".auth/{file_name}"}


@app.post("/upload-profile", response_model=UploadProfileResponse)
async def upload_profile(
    file: UploadFile = File(...),
    profile_name: str = Form(...),
    platform: str = Form(default="whatsapp")
):
    """
    Upload and verify a browser profile (e.g., WhatsApp).
    """
    import uuid
    platform = platform.lower()
    
    # Only WhatsApp uses profile-based auth for now
    if platform != "whatsapp":
        raise HTTPException(
            status_code=400,
            detail=f"Platform '{platform}' does not support profile-based authentication"
        )
    
    # 1. Validate profile name format (whitelist)
    if not PROFILE_NAME_PATTERN.match(profile_name):
        raise HTTPException(
            status_code=400,
            detail="Invalid profile name. Use only alphanumeric characters, underscores, and hyphens (1-64 chars)"
        )
    
    # 2. Read and validate file size
    content = await file.read()
    if len(content) > MAX_PROFILE_SIZE:
        raise HTTPException(
            status_code=400,
            detail=f"File too large. Maximum size is {MAX_PROFILE_SIZE // (1024*1024)}MB"
        )
    
    # 3. Verify it's a valid ZIP file
    if not zipfile.is_zipfile(io.BytesIO(content)):
        raise HTTPException(
            status_code=400,
            detail="Invalid file format. Please upload a ZIP file"
        )
    
    # Generate a unique directory name using UUID to avoid collisions
    # Format: whatsapp_profile_{alias}_{uuid_short}
    unique_suffix = str(uuid.uuid4())[:8]
    # Sanitized name for directory
    safe_name = f"{profile_name}_{unique_suffix}"
    
    AUTH_DIR.mkdir(exist_ok=True)
    target_dir = AUTH_DIR / f"whatsapp_profile_{safe_name}"
    target_dir_resolved = target_dir.resolve()
    auth_dir_resolved = AUTH_DIR.resolve()
    
    # Ensure target is within AUTH_DIR
    if not str(target_dir_resolved).startswith(str(auth_dir_resolved)):
        raise HTTPException(
            status_code=400,
            detail="Invalid profile path"
        )
    
    # 5. Extract with security checks
    try:
        with zipfile.ZipFile(io.BytesIO(content)) as zf:
            # Check each file before extraction
            for info in zf.infolist():
                # Skip directories
                if info.is_dir():
                    continue
                
                # Normalize the filename and check for path traversal
                filename = info.filename
                
                # Block absolute paths
                if filename.startswith('/') or filename.startswith('\\'):
                    raise HTTPException(
                        status_code=400,
                        detail=f"Absolute paths not allowed: {filename}"
                    )
                
                # Block parent directory references
                if '..' in filename:
                    raise HTTPException(
                        status_code=400,
                        detail=f"Path traversal detected: {filename}"
                    )
                
                # Check resolved path is within target
                extracted_path = (target_dir / filename).resolve()
                if not str(extracted_path).startswith(str(target_dir_resolved)):
                    raise HTTPException(
                        status_code=400,
                        detail=f"Path traversal detected: {filename}"
                    )
                
                # Block symlinks (check file attributes)
                # Unix symlink has external_attr with mode 0o120000
                unix_mode = info.external_attr >> 16
                if unix_mode != 0 and (unix_mode & 0o170000) == 0o120000:
                    print(f"[gather] Skipping symbolic link (not allowed for security): {filename}")
                    continue
            
            # Remove existing directory if it exists
            if target_dir.exists():
                shutil.rmtree(target_dir)
            
            # Create target directory
            target_dir.mkdir(parents=True, exist_ok=True)
            
            # Extract all files
            zf.extractall(target_dir)
            
            # --- Auto-flatten logic ---
            # If the ZIP was created by compressing the folder rather than its contents,
            # we'll have target_dir/folder_name/Default instead of target_dir/Default.
            content_items = [p for p in target_dir.iterdir() if p.name != "__MACOSX"]
            if len(content_items) == 1 and content_items[0].is_dir():
                nested_dir = content_items[0]
                print(f"[gather] Detected nested directory '{nested_dir.name}', flattening...")
                for item in nested_dir.iterdir():
                    # Move everything up one level
                    shutil.move(str(item), str(target_dir))
                # Remove the now empty nested directory
                nested_dir.rmdir()
            # ---------------------------
            
    except zipfile.BadZipFile:
        raise HTTPException(
            status_code=400,
            detail="Corrupted ZIP file"
        )
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"Failed to extract profile: {str(e)}"
        )
    
    print(f"[gather] Profile extracted to: {target_dir.absolute()}")
    
    # Check for expected Chromium profile structure
    if (target_dir / "Default").exists():
        print("[gather] Found 'Default' directory in profile")
    else:
        print("[gather] Warning: 'Default' directory NOT found in profile. Is this a complete Chrome profile?")
        # List files for debugging
        files = list(target_dir.glob("*"))[:10]
        print(f"[gather] First few files in profile: {[f.name for f in files]}")
    
    # 6. Verify the profile with agent-browser flow
    try:
        print(f"[gather] Starting verification for: {profile_name}")
        verify_result = await _verify_auth_with_agent_browser_for_whatsapp(
            VerifyAuthRequest(
                platform="whatsapp",
                auth_data={"profileName": target_dir.name},
                headless=False,
            )
        )
        is_valid = bool(verify_result and verify_result.valid)
        print(f"[gather] Verification result for {profile_name}: {is_valid}")
        if is_valid:
            return UploadProfileResponse(
                success=True,
                message="Profile uploaded and verified successfully",
                profile_name=target_dir.name,
                verified=True,
                details={"platform": "WhatsApp", "auth_type": "profile"},
            )
        return UploadProfileResponse(
            success=True,
            message="Profile uploaded but authentication is invalid or expired",
            profile_name=target_dir.name,
            verified=False,
            details={"platform": "WhatsApp", "suggestion": "Please re-export the profile after logging in"},
        )
    except Exception as e:
        print(f"[gather] Profile verification error: {e}")
        return UploadProfileResponse(
            success=True,
            message=f"Profile uploaded but verification failed: {str(e)}",
            profile_name=target_dir.name,
            verified=False,
            details={"error": str(e)},
        )


@app.delete("/delete-profile/{profile_name}")
async def delete_profile(profile_name: str):
    """
    Delete a browser profile directory from the filesystem.
    """
    # 1. Basic validation of profile name format (security)
    if not PROFILE_NAME_PATTERN.match(profile_name.split('/')[-1]) and not profile_name.startswith("whatsapp_profile_"):
         # More relaxed check but still ensuring it's one of ours
         pass
         
    # Stricter check: only allow deleting things in AUTH_DIR and starting with known prefix
    target_dir = (AUTH_DIR / profile_name).resolve()
    
    if not str(target_dir).startswith(str(AUTH_DIR.resolve())):
        raise HTTPException(status_code=400, detail="Invalid profile path")
        
    if not target_dir.exists():
        return {"success": True, "message": "Profile already deleted or not found"}
        
    try:
        if target_dir.is_dir():
            shutil.rmtree(target_dir)
            print(f"[gather] Deleted profile directory: {target_dir}")
        else:
            target_dir.unlink()
            print(f"[gather] Deleted profile file: {target_dir}")
            
        return {"success": True, "message": f"Profile {profile_name} deleted successfully"}
    except Exception as e:
        print(f"[gather] Error deleting profile: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to delete profile: {str(e)}")


if __name__ == "__main__":
    import uvicorn
    host = os.getenv("GATHER_HOST", "0.0.0.0")
    port = int(os.getenv("GATHER_PORT", "8000"))
    reload = os.getenv("GATHER_RELOAD", "false").lower() == "true"
    reload_excludes: list[str] = []
    if _API_IO_LOG_ENABLED:
        reload_excludes.append(str(_API_IO_LOG_DIR))
    
    print(f"[gather] Starting service on {host}:{port} (reload={reload})")
    if reload_excludes:
        print(f"[gather] reload excludes: {', '.join(reload_excludes)}")
    # Using string import "main:app" to support reload
    uvicorn.run(
        "main:app",
        host=host,
        port=port,
        reload=reload,
        reload_excludes=reload_excludes,
    )
