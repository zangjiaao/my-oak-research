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
import subprocess
import shutil
import zipfile
import traceback
from contextlib import asynccontextmanager, suppress
from pathlib import Path
from urllib.parse import quote, urlparse, urlunparse
from dataclasses import dataclass, field
from fastapi import FastAPI, HTTPException, UploadFile
from fastapi.responses import JSONResponse
from pydantic import BaseModel, ValidationError
from typing import List, Optional, Any, Dict
from datetime import datetime, timezone
from dotenv import load_dotenv
from drivers.playwright_driver import PlaywrightDriver
from drivers.registry import DriverRegistry, DriverNotFoundError
from drivers.xhttp_driver import XHttpDriver
from libs.auth_verify import (
    playwright_verify_auth,
)
from libs.fetch_processing import apply_keyword_hard_filter
from libs.script_framework import ScriptRegistry, build_x_intent_script, build_x_search_intercept_script
from schemas import (
    CleanItem,
    DeleteAuthStateRequest,
    ErrorResponse,
    FetchRequest,
    FetchV2Request,
    FetchV3Meta,
    FetchV3Request,
    FetchV3Response,
    SaveAuthStateRequest,
    SaveAuthStateResponse,
    UploadProfileResponse,
    VerifyAuthRequest,
    VerifyAuthResponse,
)

_apply_keyword_hard_filter = apply_keyword_hard_filter

_V3_DRIVER_STRATEGIES: dict[str, list[str]] = {
    "playwright": ["cookie", "header", "intercept", "ui"],
    "xhttp": ["public", "cookie", "header"],
}

# Load environment variables from .env file
load_dotenv()

try:
    import playwright.async_api as _playwright_async_api
    if not hasattr(_playwright_async_api, "TimeoutError"):
        try:
            from playwright._impl._errors import TimeoutError as _PlaywrightTimeoutError

            setattr(_playwright_async_api, "TimeoutError", _PlaywrightTimeoutError)
        except Exception:
            setattr(_playwright_async_api, "TimeoutError", TimeoutError)
except Exception:
    pass


@asynccontextmanager
async def _app_lifespan(_app: FastAPI):
    global _PLAYWRIGHT_POOL_SWEEP_TASK, _PLAYWRIGHT_RUNTIME
    if _PLAYWRIGHT_POOL_SWEEP_TASK is None or _PLAYWRIGHT_POOL_SWEEP_TASK.done():
        _PLAYWRIGHT_POOL_SWEEP_TASK = asyncio.create_task(_playwright_pool_sweep_loop())
    try:
        yield
    finally:
        if _PLAYWRIGHT_POOL_SWEEP_TASK is not None:
            _PLAYWRIGHT_POOL_SWEEP_TASK.cancel()
            with suppress(asyncio.CancelledError):
                await _PLAYWRIGHT_POOL_SWEEP_TASK
            _PLAYWRIGHT_POOL_SWEEP_TASK = None
        await _close_all_playwright_browsers()
        async with _PLAYWRIGHT_RUNTIME_LOCK:
            if _PLAYWRIGHT_RUNTIME is not None:
                await _PLAYWRIGHT_RUNTIME.stop()
                _PLAYWRIGHT_RUNTIME = None


def _env_flag(name: str, default: bool = False) -> bool:
    value = os.getenv(name)
    if value is None:
        return default
    return value.strip().lower() in {"1", "true", "yes", "on"}


_API_IO_LOG_ENABLED = _env_flag("GATHER_API_IO_LOG_ENABLED", False)
_EXPOSE_INTERNAL_ERROR = _env_flag("GATHER_EXPOSE_INTERNAL_ERROR", False)
_SEARCH_ALIAS_COMPAT_ENABLED = _env_flag("GATHER_SEARCH_ALIAS_COMPAT_ENABLED", True)
_RAW_API_IO_LOG_DIR = Path(
    os.getenv("GATHER_API_IO_LOG_DIR", str(Path(__file__).resolve().parents[2] / "logs"))
).expanduser()
_GATHER_APP_ROOT = Path(__file__).resolve().parents[2]
_SCRIPT_SOURCE_ROOT = _GATHER_APP_ROOT / "scripts"
_SCRIPT_RUNTIME_ROOT = _GATHER_APP_ROOT / "scripts-dist"
_SCRIPT_REGISTRY = ScriptRegistry(_SCRIPT_SOURCE_ROOT, _SCRIPT_RUNTIME_ROOT)
_X_INTERCEPT_INTENTS = _SCRIPT_REGISTRY.intents_for("x")
_REDDIT_INTERCEPT_INTENTS = _SCRIPT_REGISTRY.intents_for("reddit")
_XHS_INTERCEPT_INTENTS = _SCRIPT_REGISTRY.intents_for("xhs")
_BBC_INTERCEPT_INTENTS = _SCRIPT_REGISTRY.intents_for("bbc")
_HACKERNEWS_INTERCEPT_INTENTS = _SCRIPT_REGISTRY.intents_for("hackernews")
_LINKEDIN_INTERCEPT_INTENTS = _SCRIPT_REGISTRY.intents_for("linkedin")
_LINUX_DO_INTERCEPT_INTENTS = _SCRIPT_REGISTRY.intents_for("linux-do")
_YOUTUBE_INTERCEPT_INTENTS = _SCRIPT_REGISTRY.intents_for("youtube")
_WEIBO_INTERCEPT_INTENTS = _SCRIPT_REGISTRY.intents_for("weibo")
_ZHIHU_INTERCEPT_INTENTS = _SCRIPT_REGISTRY.intents_for("zhihu")
_BILIBILI_INTERCEPT_INTENTS = _SCRIPT_REGISTRY.intents_for("bilibili")
_KR36_INTERCEPT_INTENTS = _SCRIPT_REGISTRY.intents_for("36kr")
_ARXIV_INTERCEPT_INTENTS = _SCRIPT_REGISTRY.intents_for("arxiv")
_BAIDU_INTERCEPT_INTENTS = _SCRIPT_REGISTRY.intents_for("baidu")
_BING_INTERCEPT_INTENTS = _SCRIPT_REGISTRY.intents_for("bing")
_CNBLOGS_INTERCEPT_INTENTS = _SCRIPT_REGISTRY.intents_for("cnblogs")
_CSDN_INTERCEPT_INTENTS = _SCRIPT_REGISTRY.intents_for("csdn")
_CTRIP_INTERCEPT_INTENTS = _SCRIPT_REGISTRY.intents_for("ctrip")
_DEVTO_INTERCEPT_INTENTS = _SCRIPT_REGISTRY.intents_for("devto")
_DUCKDUCKGO_INTERCEPT_INTENTS = _SCRIPT_REGISTRY.intents_for("duckduckgo")
_GOOGLE_INTERCEPT_INTENTS = _SCRIPT_REGISTRY.intents_for("google")
_REUTERS_INTERCEPT_INTENTS = _SCRIPT_REGISTRY.intents_for("reuters")
_TOUTIAO_INTERCEPT_INTENTS = _SCRIPT_REGISTRY.intents_for("toutiao")
_HUPU_INTERCEPT_INTENTS = _SCRIPT_REGISTRY.intents_for("hupu")
_SEARCH_INTENTS = {"search"}
_GENERIC_INTERCEPT_INTENTS: dict[str, set[str]] = {
    "36kr": _KR36_INTERCEPT_INTENTS,
    "arxiv": _ARXIV_INTERCEPT_INTENTS,
    "baidu": _BAIDU_INTERCEPT_INTENTS,
    "bing": _BING_INTERCEPT_INTENTS,
    "cnblogs": _CNBLOGS_INTERCEPT_INTENTS,
    "csdn": _CSDN_INTERCEPT_INTENTS,
    "ctrip": _CTRIP_INTERCEPT_INTENTS,
    "devto": _DEVTO_INTERCEPT_INTENTS,
    "duckduckgo": _DUCKDUCKGO_INTERCEPT_INTENTS,
    "google": _GOOGLE_INTERCEPT_INTENTS,
    "reuters": _REUTERS_INTERCEPT_INTENTS,
    "toutiao": _TOUTIAO_INTERCEPT_INTENTS,
    "hupu": _HUPU_INTERCEPT_INTENTS,
}
_GENERIC_INTERCEPT_TARGET_URL: dict[str, str] = {
    "36kr": "https://36kr.com",
    "arxiv": "https://arxiv.org",
    "baidu": "https://www.baidu.com",
    "bing": "https://www.bing.com",
    "cnblogs": "https://zzk.cnblogs.com",
    "csdn": "https://so.csdn.net",
    "ctrip": "https://www.ctrip.com",
    "devto": "https://dev.to",
    "duckduckgo": "https://duckduckgo.com",
    "google": "https://www.google.com",
    "reuters": "https://www.reuters.com",
    "toutiao": "https://www.toutiao.com",
    "hupu": "https://bbs.hupu.com",
}
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


def _log_internal_fetch_error(route: str, payload: Dict[str, Any], error: Exception) -> None:
    try:
        print(
            json.dumps(
                {
                    "time": datetime.now(timezone.utc).isoformat(),
                    "level": "error",
                    "route": route,
                    "message": "Unhandled gather fetch exception",
                    "errorType": type(error).__name__,
                    "errorMessage": str(error),
                    "traceback": traceback.format_exc(),
                    "request": _truncate_for_log(
                        _redact_sensitive_for_log(payload),
                        _API_IO_LOG_MAX_CHARS,
                    ),
                },
                ensure_ascii=False,
            )
        )
    except Exception as log_error:  # pragma: no cover - logging must never break api
        print(f"[gather] failed to emit internal error log for {route}: {log_error}")


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

@dataclass
class _PlaywrightBrowserPoolEntry:
    browser: Any
    last_used_at: float
    idle_timeout_ms: int
    context: Any | None = None
    keeper_page: Any | None = None
    active_tabs: int = 0
    lock: asyncio.Lock = field(default_factory=asyncio.Lock)


_PLAYWRIGHT_BROWSER_POOL: dict[str, _PlaywrightBrowserPoolEntry] = {}
_PLAYWRIGHT_POOL_LOCK = asyncio.Lock()
_PLAYWRIGHT_RUNTIME = None
_PLAYWRIGHT_RUNTIME_LOCK = asyncio.Lock()
_PLAYWRIGHT_POOL_SWEEP_TASK: asyncio.Task[Any] | None = None
_PLAYWRIGHT_POOL_SWEEP_INTERVAL_MS = max(1000, int(os.getenv("GATHER_PLAYWRIGHT_POOL_SWEEP_INTERVAL_MS", "5000")))
_SCRIPT_SAMPLE_LINE_RE = re.compile(r"^\s*//\s*Sample\s+/v1/fetch key parts\s*$")
_SCRIPT_SAMPLE_ENTRY_RE = re.compile(r"^\s*//\s*([^:]+):\s*(.+?)\s*$")
_SCRIPT_ALLOWED_CATEGORIES = {"STREAM", "INTERACTIVE", "RETRIEVAL"}


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


async def root():
    return {"status": "ok", "service": "oak-gather"}


def _parse_script_sample_payload(script_content: str) -> dict[str, Any]:
    sample: dict[str, Any] = {}
    lines = script_content.splitlines()
    in_sample_block = False

    for line in lines:
        if not in_sample_block:
            if _SCRIPT_SAMPLE_LINE_RE.match(line):
                in_sample_block = True
            continue

        matched = _SCRIPT_SAMPLE_ENTRY_RE.match(line)
        if not matched:
            if line.strip().startswith("//"):
                continue
            break

        raw_key = matched.group(1).strip()
        raw_value = matched.group(2).strip()
        if not raw_key:
            continue
        try:
            sample[raw_key] = json.loads(raw_value)
        except json.JSONDecodeError:
            sample[raw_key] = raw_value

    return sample


def _normalize_script_category(value: Any) -> str | None:
    if not isinstance(value, str):
        return None
    normalized = value.strip().upper()
    if not normalized:
        return None
    if normalized in _SCRIPT_ALLOWED_CATEGORIES:
        return normalized
    return None


def _normalize_script_tags(value: Any) -> list[str]:
    if isinstance(value, list):
        return [str(item).strip() for item in value if str(item).strip()]
    if isinstance(value, str):
        return [part.strip() for part in re.split(r"[,\s]+", value) if part.strip()]
    return []


def _extract_script_meta(sample_payload: dict[str, Any]) -> dict[str, Any]:
    meta: dict[str, Any] = {}
    category = _normalize_script_category(sample_payload.get("category"))
    if category:
        meta["category"] = category
    title = sample_payload.get("title")
    if isinstance(title, str) and title.strip():
        meta["title"] = title.strip()
    description = sample_payload.get("description")
    if isinstance(description, str) and description.strip():
        meta["description"] = description.strip()

    auth_raw = sample_payload.get("auth")
    auth_obj = auth_raw if isinstance(auth_raw, dict) else {}
    auth_required = auth_obj.get("required", sample_payload.get("auth.required"))
    auth_kind = auth_obj.get("kind", sample_payload.get("auth.kind"))
    auth_description = auth_obj.get("description", sample_payload.get("auth.description"))

    auth_meta: dict[str, Any] = {}
    if isinstance(auth_required, bool):
        auth_meta["required"] = auth_required
    if isinstance(auth_kind, str) and auth_kind.strip():
        auth_meta["kind"] = auth_kind.strip()
    if isinstance(auth_description, str) and auth_description.strip():
        auth_meta["description"] = auth_description.strip()
    if auth_meta:
        meta["auth"] = auth_meta

    tags = _normalize_script_tags(sample_payload.get("tags"))
    if tags:
        meta["tags"] = tags

    return meta


def _build_scripts_catalog() -> dict[str, Any]:
    items: list[dict[str, Any]] = []
    platform_map: dict[str, set[str]] = {}

    for spec in _SCRIPT_REGISTRY.list_specs():
        runtime_file = spec.runtime_path if spec.runtime_path.exists() else spec.source_path
        sample_file = spec.source_path if spec.source_path.exists() else runtime_file
        sample_payload: dict[str, Any] = {}

        try:
            script_content = sample_file.read_text(encoding="utf-8")
            sample_payload = _parse_script_sample_payload(script_content)
        except Exception:
            sample_payload = {}

        sample_intent = _as_dict(sample_payload.get("intent.args"))
        if spec.intent in _SEARCH_INTENTS:
            sample_intent = _normalize_search_intent_args_for_catalog(
                spec.platform,
                sample_intent,
            )
        sample_output = sample_payload.get("output.field")
        script_meta = _extract_script_meta(sample_payload)

        item = {
            "key": spec.key,
            "platform": spec.platform.upper(),
            "intent": spec.intent,
            "mode": spec.mode,
            "runtimePath": str(runtime_file),
            "sample": {
                "intentType": sample_payload.get("intent.type", spec.intent),
                "intentArgs": sample_intent,
                "outputField": sample_output if isinstance(sample_output, (list, dict)) else None,
            },
            "meta": script_meta,
        }
        items.append(item)
        platform_map.setdefault(item["platform"], set()).add(spec.intent)

    platforms = [
        {"platform": platform, "intents": sorted(intents)}
        for platform, intents in sorted(platform_map.items(), key=lambda entry: entry[0])
    ]

    return {
        "total": len(items),
        "items": sorted(items, key=lambda entry: (entry["platform"], entry["intent"])),
        "platforms": platforms,
    }


def _normalize_search_intent_args_for_catalog(
    platform: str, intent_args: dict[str, Any]
) -> dict[str, Any]:
    query, _ = _extract_search_query(platform, intent_args, strict=False)
    normalized = dict(intent_args)
    if query:
        normalized["query"] = query
    normalized.pop("keyword", None)
    return normalized


async def _playwright_verify_auth_legacy(request: VerifyAuthRequest):
    return VerifyAuthResponse(
        valid=False,
        message="Legacy playwright client verification has been removed.",
        details={"verifyMethod": "removed-legacy-client"},
    )


async def _playwright_verify_auth(request: VerifyAuthRequest):
    return await playwright_verify_auth(request, auth_dir=AUTH_DIR)


async def _playwright_fetch_data(request: FetchRequest):
    platform = request.platform.lower()
    config = request.config
    playwright_options = config.get("playwright")
    if isinstance(playwright_options, dict):
        mode = str(playwright_options.get("mode", "")).lower()
        if mode in {"opencli-bridge", "opencli-search"} and platform in {"x", "twitter"}:
            raise HTTPException(
                status_code=400,
                detail=(
                    "playwright mode opencli-bridge/opencli-search has been removed; "
                    "please use intercept-x-search"
                ),
            )
        if mode in {"intercept-x-search", "intercept-search"} and platform in {"x", "twitter"}:
            return await _run_playwright_intercept_x_search(request)
        if mode.startswith("intercept-x-") and platform in {"x", "twitter"}:
            intent_type = mode.removeprefix("intercept-x-").strip().lower()
            return await _run_playwright_intercept_x_intent(request, intent_type)
        if mode.startswith("intercept-reddit-") and platform == "reddit":
            intent_type = mode.removeprefix("intercept-reddit-").strip().lower()
            return await _run_playwright_intercept_reddit_intent(request, intent_type)
        if mode.startswith("intercept-xhs-") and platform in {"xhs", "xiaohongshu"}:
            intent_type = mode.removeprefix("intercept-xhs-").strip().lower()
            return await _run_playwright_intercept_xhs_intent(request, intent_type)
        if mode.startswith("intercept-bbc-") and platform == "bbc":
            intent_type = mode.removeprefix("intercept-bbc-").strip().lower()
            return await _run_playwright_intercept_bbc_intent(request, intent_type)
        if mode.startswith("intercept-hackernews-") and platform in {"hackernews", "hn"}:
            intent_type = mode.removeprefix("intercept-hackernews-").strip().lower()
            return await _run_playwright_intercept_hackernews_intent(request, intent_type)
        if mode.startswith("intercept-hn-") and platform in {"hackernews", "hn"}:
            intent_type = mode.removeprefix("intercept-hn-").strip().lower()
            return await _run_playwright_intercept_hackernews_intent(request, intent_type)
        if mode.startswith("intercept-linkedin-") and platform == "linkedin":
            intent_type = mode.removeprefix("intercept-linkedin-").strip().lower()
            return await _run_playwright_intercept_linkedin_intent(request, intent_type)
        if mode.startswith("intercept-linux-do-") and platform in {"linux-do", "linuxdo"}:
            intent_type = mode.removeprefix("intercept-linux-do-").strip().lower()
            return await _run_playwright_intercept_linux_do_intent(request, intent_type)
        if mode.startswith("intercept-linuxdo-") and platform in {"linux-do", "linuxdo"}:
            intent_type = mode.removeprefix("intercept-linuxdo-").strip().lower()
            return await _run_playwright_intercept_linux_do_intent(request, intent_type)
        if mode.startswith("intercept-youtube-") and platform == "youtube":
            intent_type = mode.removeprefix("intercept-youtube-").strip().lower()
            return await _run_playwright_intercept_youtube_intent(request, intent_type)
        if mode.startswith("intercept-weibo-") and platform == "weibo":
            intent_type = mode.removeprefix("intercept-weibo-").strip().lower()
            return await _run_playwright_intercept_weibo_intent(request, intent_type)
        if mode.startswith("intercept-zhihu-") and platform == "zhihu":
            intent_type = mode.removeprefix("intercept-zhihu-").strip().lower()
            return await _run_playwright_intercept_zhihu_intent(request, intent_type)
        if mode.startswith("intercept-bilibili-") and platform == "bilibili":
            intent_type = mode.removeprefix("intercept-bilibili-").strip().lower()
            return await _run_playwright_intercept_bilibili_intent(request, intent_type)
        if mode.startswith("intercept-36kr-") and platform == "36kr":
            intent_type = mode.removeprefix("intercept-36kr-").strip().lower()
            return await _run_playwright_intercept_generic_intent(request, intent_type, platform="36kr")
        if mode.startswith("intercept-arxiv-") and platform == "arxiv":
            intent_type = mode.removeprefix("intercept-arxiv-").strip().lower()
            return await _run_playwright_intercept_generic_intent(request, intent_type, platform="arxiv")
        if mode.startswith("intercept-baidu-") and platform == "baidu":
            intent_type = mode.removeprefix("intercept-baidu-").strip().lower()
            return await _run_playwright_intercept_generic_intent(request, intent_type, platform="baidu")
        if mode.startswith("intercept-bing-") and platform == "bing":
            intent_type = mode.removeprefix("intercept-bing-").strip().lower()
            return await _run_playwright_intercept_generic_intent(request, intent_type, platform="bing")
        if mode.startswith("intercept-cnblogs-") and platform == "cnblogs":
            intent_type = mode.removeprefix("intercept-cnblogs-").strip().lower()
            return await _run_playwright_intercept_generic_intent(request, intent_type, platform="cnblogs")
        if mode.startswith("intercept-csdn-") and platform == "csdn":
            intent_type = mode.removeprefix("intercept-csdn-").strip().lower()
            return await _run_playwright_intercept_generic_intent(request, intent_type, platform="csdn")
        if mode.startswith("intercept-ctrip-") and platform == "ctrip":
            intent_type = mode.removeprefix("intercept-ctrip-").strip().lower()
            return await _run_playwright_intercept_generic_intent(request, intent_type, platform="ctrip")
        if mode.startswith("intercept-devto-") and platform == "devto":
            intent_type = mode.removeprefix("intercept-devto-").strip().lower()
            return await _run_playwright_intercept_generic_intent(request, intent_type, platform="devto")
        if mode.startswith("intercept-duckduckgo-") and platform == "duckduckgo":
            intent_type = mode.removeprefix("intercept-duckduckgo-").strip().lower()
            return await _run_playwright_intercept_generic_intent(request, intent_type, platform="duckduckgo")
        if mode.startswith("intercept-google-") and platform == "google":
            intent_type = mode.removeprefix("intercept-google-").strip().lower()
            return await _run_playwright_intercept_generic_intent(request, intent_type, platform="google")
        if mode.startswith("intercept-reuters-") and platform == "reuters":
            intent_type = mode.removeprefix("intercept-reuters-").strip().lower()
            return await _run_playwright_intercept_generic_intent(request, intent_type, platform="reuters")
        if mode.startswith("intercept-toutiao-") and platform == "toutiao":
            intent_type = mode.removeprefix("intercept-toutiao-").strip().lower()
            return await _run_playwright_intercept_generic_intent(request, intent_type, platform="toutiao")
        if mode.startswith("intercept-hupu-") and platform == "hupu":
            intent_type = mode.removeprefix("intercept-hupu-").strip().lower()
            return await _run_playwright_intercept_generic_intent(request, intent_type, platform="hupu")
        if mode in {"eval-js", "evaljs", "eval"}:
            return await _run_playwright_eval_script(request)

    raise HTTPException(
        status_code=400,
        detail=(
            f"playwright legacy clients have been removed for platform '{platform}'. "
            "Set config.playwright.mode='eval-js' or an intercept-* mode."
        ),
    )


def _strip_playwright_meta_block(script: str) -> str:
    return re.sub(r"/\*\s*@meta[\s\S]*?\*/", "", script, count=1).strip()


def _load_playwright_storage_state_from_config(
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
        state_path = (_GATHER_APP_ROOT / state_path).resolve()
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
            resolved = (_GATHER_APP_ROOT / resolved).resolve()
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
            state_path = (_GATHER_APP_ROOT / state_path).resolve()
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
        "script_body": _strip_playwright_meta_block(script_body or ""),
        "wait_until": wait_until,
        "navigation_timeout_ms": navigation_timeout_ms,
        "post_navigation_wait_ms": post_nav_wait_ms,
        "wait_selector": wait_selector.strip() if isinstance(wait_selector, str) else None,
        "args_json": args_json,
        "headless": bool(raw.get("headless", True)),
        "storage_state": storage_state,
        "proxy": _extract_proxy_settings(config, raw),
        "pool_enabled": pool_enabled,
        "pool_idle_timeout_ms": pool_idle_timeout_ms,
        "pool_user_id": pool_user_id,
        "pool_driver": raw.get("poolDriver", raw.get("pool_driver", "playwright")),
    }

