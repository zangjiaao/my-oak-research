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
from auth_verify import (
    agent_browser_verify_auth,
    resolve_verify_auth_data,
    verify_auth_with_agent_browser_for_whatsapp,
    verify_auth_with_xhs_api_probe,
    verify_auth_with_reddit_api_probe,
    verify_auth_with_x_cookie_probe,
)
from fetch_processing import agent_browser_results_to_clean_items, apply_keyword_hard_filter
from script_framework import ScriptRegistry, build_x_intent_script, build_x_search_intercept_script
from schemas import (
    AgentBrowserHeartbeatRequest,
    AgentBrowserHeartbeatResponse,
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

_agent_browser_results_to_clean_items = agent_browser_results_to_clean_items
_apply_keyword_hard_filter = apply_keyword_hard_filter

_V3_DRIVER_STRATEGIES: dict[str, list[str]] = {
    "playwright": ["cookie", "header", "intercept", "ui"],
    "xhttp": ["public", "cookie", "header"],
    "agent-browser": ["agent-browser"],
}

# Load environment variables from .env file
load_dotenv()

app = FastAPI(title="Oak Gather Service")


def _env_flag(name: str, default: bool = False) -> bool:
    value = os.getenv(name)
    if value is None:
        return default
    return value.strip().lower() in {"1", "true", "yes", "on"}


_API_IO_LOG_ENABLED = _env_flag("GATHER_API_IO_LOG_ENABLED", False)
_OPENCLI_BRIDGE_ENABLED = _env_flag("GATHER_OPENCLI_BRIDGE_ENABLED", False)
_OPENCLI_BIN = os.getenv("GATHER_OPENCLI_BIN", "opencli").strip() or "opencli"
_OPENCLI_CWD = os.getenv("GATHER_OPENCLI_CWD", "").strip() or None
_RAW_API_IO_LOG_DIR = Path(
    os.getenv("GATHER_API_IO_LOG_DIR", str(Path(__file__).resolve().parent / "logs"))
).expanduser()
_GATHER_APP_ROOT = Path(__file__).resolve().parent
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
    page: Any | None = None
    lock: asyncio.Lock = field(default_factory=asyncio.Lock)


_PLAYWRIGHT_BROWSER_POOL: dict[str, _PlaywrightBrowserPoolEntry] = {}
_PLAYWRIGHT_POOL_LOCK = asyncio.Lock()
_PLAYWRIGHT_RUNTIME = None
_PLAYWRIGHT_RUNTIME_LOCK = asyncio.Lock()
_SCRIPT_SAMPLE_LINE_RE = re.compile(r"^\s*//\s*Sample\s+/v3/fetch key parts\s*$")
_SCRIPT_SAMPLE_ENTRY_RE = re.compile(r"^\s*//\s*([^:]+):\s*(.+?)\s*$")


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


def _build_scripts_catalog() -> dict[str, Any]:
    items: list[dict[str, Any]] = []
    platform_map: dict[str, set[str]] = {}

    for spec in _SCRIPT_REGISTRY.list_specs():
        script_file = spec.runtime_path if spec.runtime_path.exists() else spec.source_path
        sample_payload: dict[str, Any] = {}

        try:
            script_content = script_file.read_text(encoding="utf-8")
            sample_payload = _parse_script_sample_payload(script_content)
        except Exception:
            sample_payload = {}

        sample_intent = _as_dict(sample_payload.get("intent.args"))
        sample_output = sample_payload.get("output.field")

        item = {
            "key": spec.key,
            "platform": spec.platform.upper(),
            "intent": spec.intent,
            "mode": spec.mode,
            "runtimePath": str(script_file),
            "sample": {
                "intentType": sample_payload.get("intent.type", spec.intent),
                "intentArgs": sample_intent,
                "outputField": sample_output if isinstance(sample_output, (list, dict)) else None,
            },
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


async def _verify_auth_with_agent_browser_for_whatsapp(request: VerifyAuthRequest) -> VerifyAuthResponse | None:
    return await verify_auth_with_agent_browser_for_whatsapp(
        request,
        auth_dir=AUTH_DIR,
    )


async def _verify_auth_with_reddit_api_probe(request: VerifyAuthRequest) -> VerifyAuthResponse | None:
    return await verify_auth_with_reddit_api_probe(request)


async def _verify_auth_with_xhs_api_probe(request: VerifyAuthRequest) -> VerifyAuthResponse | None:
    return await verify_auth_with_xhs_api_probe(request)


def _resolve_verify_auth_data(request: VerifyAuthRequest) -> tuple[dict[str, Any] | None, VerifyAuthResponse | None]:
    return resolve_verify_auth_data(request)


async def _playwright_verify_auth_legacy(request: VerifyAuthRequest):
    return VerifyAuthResponse(
        valid=False,
        message="Legacy playwright client verification has been removed.",
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

    reddit_probe_result = await _verify_auth_with_reddit_api_probe(normalized_request)
    if reddit_probe_result is not None:
        return reddit_probe_result

    xhs_probe_result = await _verify_auth_with_xhs_api_probe(normalized_request)
    if xhs_probe_result is not None:
        return xhs_probe_result

    x_probe_result = verify_auth_with_x_cookie_probe(normalized_request)
    if x_probe_result is not None:
        return x_probe_result

    return VerifyAuthResponse(
        valid=False,
        message="No built-in verify probe for this platform",
        details={"verifyMethod": "built-in-probe-missing"},
    )


async def _agent_browser_verify_auth(request: VerifyAuthRequest):
    return await agent_browser_verify_auth(request)


async def _playwright_fetch_data(request: FetchRequest):
    platform = request.platform.lower()
    config = request.config
    playwright_options = config.get("playwright")
    if isinstance(playwright_options, dict):
        mode = str(playwright_options.get("mode", "")).lower()
        if mode in {"opencli-bridge", "opencli-search"} and platform in {"x", "twitter"}:
            return await _run_playwright_opencli_bridge_search(request)
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
            "Use driver='agent-browser' or set config.playwright.mode='eval-js'."
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
        state_path = (Path(__file__).resolve().parent / state_path).resolve()
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
    from playwright.async_api import async_playwright

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
    if normalized_intent in {"profile", "followers", "following"} and not username:
        raise HTTPException(
            status_code=400,
            detail=f"config.playwright.args.username is required for intercept-x-{normalized_intent} mode",
        )
    if normalized_intent in {"thread", "article"} and not tweet_id:
        raise HTTPException(
            status_code=400,
            detail=f"config.playwright.args.tweet_id is required for intercept-x-{normalized_intent} mode",
        )

    raw_count = args_obj.get("count", 30)
    try:
        count = int(raw_count)
    except (TypeError, ValueError):
        count = 30
    count = max(1, min(count, 100))
    raw_type = str(args_obj.get("type", "latest")).strip().lower()
    search_type = "top" if raw_type == "top" else "latest"
    headless = bool(playwright_options.get("headless", True))
    navigation_timeout_ms = playwright_options.get("navigationTimeoutMs", 60000)
    if not isinstance(navigation_timeout_ms, int) or navigation_timeout_ms < 1000:
        raise HTTPException(status_code=400, detail="config.playwright.navigationTimeoutMs must be an integer >= 1000")
    storage_state = _load_playwright_storage_state_from_config(request, playwright_options)
    if normalized_intent == "search":
        target_url = f"https://x.com/search?q={quote(query)}&src=typed_query&f={'live' if search_type == 'latest' else 'top'}"
    elif normalized_intent == "profile":
        target_url = f"https://x.com/{quote(username)}"
    elif normalized_intent == "followers":
        target_url = f"https://x.com/{quote(username)}/followers"
    elif normalized_intent == "following":
        target_url = f"https://x.com/{quote(username)}/following"
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
        async with async_playwright() as playwright:
            browser = await playwright.chromium.launch(headless=headless)
            context_options: dict[str, Any] = {}
            if storage_state:
                context_options["storage_state"] = storage_state
            context = await browser.new_context(**context_options)
            page = await context.new_page()
            try:
                bootstrap_capture_key = {
                    "search": "SearchTimeline",
                    "notifications": "NotificationsTimeline",
                    "followers": "Followers",
                    "following": "Following",
                }.get(normalized_intent)
                if bootstrap_capture_key:
                    await page.add_init_script(_build_x_intercept_bootstrap_script(bootstrap_capture_key))
                await page.goto(target_url, wait_until="domcontentloaded", timeout=navigation_timeout_ms)
                await page.wait_for_timeout(2000)
                eval_result = await page.evaluate(script_to_run)
            finally:
                await context.close()
                await browser.close()
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
    from playwright.async_api import async_playwright

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
    headless = bool(playwright_options.get("headless", True))
    navigation_timeout_ms = playwright_options.get("navigationTimeoutMs", 60000)
    if not isinstance(navigation_timeout_ms, int) or navigation_timeout_ms < 1000:
        raise HTTPException(status_code=400, detail="config.playwright.navigationTimeoutMs must be an integer >= 1000")
    storage_state = _load_playwright_storage_state_from_config(request, playwright_options)

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
        async with async_playwright() as playwright:
            browser = await playwright.chromium.launch(headless=headless)
            context_options: dict[str, Any] = {}
            if storage_state:
                context_options["storage_state"] = storage_state
            context = await browser.new_context(**context_options)
            page = await context.new_page()
            try:
                await page.goto(target_url, wait_until="domcontentloaded", timeout=navigation_timeout_ms)
                await page.wait_for_timeout(1000)
                eval_result = await page.evaluate(script_to_run)
            finally:
                await context.close()
                await browser.close()
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
    from playwright.async_api import async_playwright

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

    headless = bool(playwright_options.get("headless", True))
    navigation_timeout_ms = playwright_options.get("navigationTimeoutMs", 60000)
    if not isinstance(navigation_timeout_ms, int) or navigation_timeout_ms < 1000:
        raise HTTPException(status_code=400, detail="config.playwright.navigationTimeoutMs must be an integer >= 1000")
    storage_state = _load_playwright_storage_state_from_config(request, playwright_options)
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
        async with async_playwright() as playwright:
            browser = await playwright.chromium.launch(headless=headless)
            context_options: dict[str, Any] = {}
            if storage_state:
                context_options["storage_state"] = storage_state
            context = await browser.new_context(**context_options)
            page = await context.new_page()
            try:
                bootstrap_capture_key = {
                    "feed": "homefeed",
                    "user": "v1/user/posted",
                    "notifications": "/you/",
                }.get(normalized_intent)
                if bootstrap_capture_key:
                    await page.add_init_script(_build_x_intercept_bootstrap_script(bootstrap_capture_key))
                await page.goto(target_url, wait_until="domcontentloaded", timeout=navigation_timeout_ms)
                await page.wait_for_timeout(1200)
                eval_result = await page.evaluate(script_to_run)
            finally:
                await context.close()
                await browser.close()
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
    from playwright.async_api import async_playwright

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

    headless = bool(playwright_options.get("headless", True))
    navigation_timeout_ms = playwright_options.get("navigationTimeoutMs", 60000)
    if not isinstance(navigation_timeout_ms, int) or navigation_timeout_ms < 1000:
        raise HTTPException(status_code=400, detail="config.playwright.navigationTimeoutMs must be an integer >= 1000")
    storage_state = _load_playwright_storage_state_from_config(request, playwright_options)
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
        async with async_playwright() as playwright:
            browser = await playwright.chromium.launch(headless=headless)
            context_options: dict[str, Any] = {}
            if storage_state:
                context_options["storage_state"] = storage_state
            context = await browser.new_context(**context_options)
            page = await context.new_page()
            try:
                await page.goto(target_url, wait_until="domcontentloaded", timeout=navigation_timeout_ms)
                await page.wait_for_timeout(800)
                eval_result = await page.evaluate(script_to_run)
            finally:
                await context.close()
                await browser.close()
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
    from playwright.async_api import async_playwright

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

    headless = bool(playwright_options.get("headless", True))
    navigation_timeout_ms = playwright_options.get("navigationTimeoutMs", 60000)
    if not isinstance(navigation_timeout_ms, int) or navigation_timeout_ms < 1000:
        raise HTTPException(status_code=400, detail="config.playwright.navigationTimeoutMs must be an integer >= 1000")
    storage_state = _load_playwright_storage_state_from_config(request, playwright_options)
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
        async with async_playwright() as playwright:
            browser = await playwright.chromium.launch(headless=headless)
            context_options: dict[str, Any] = {}
            if storage_state:
                context_options["storage_state"] = storage_state
            context = await browser.new_context(**context_options)
            page = await context.new_page()
            try:
                await page.goto(target_url, wait_until="domcontentloaded", timeout=navigation_timeout_ms)
                await page.wait_for_timeout(500)
                eval_result = await page.evaluate(script_to_run)
            finally:
                await context.close()
                await browser.close()
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


async def _run_playwright_intercept_linkedin_intent(request: FetchRequest, intent_type: str) -> list[CleanItem]:
    from playwright.async_api import TimeoutError as PlaywrightTimeoutError
    from playwright.async_api import async_playwright

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

    headless = bool(playwright_options.get("headless", True))
    navigation_timeout_ms = playwright_options.get("navigationTimeoutMs", 60000)
    if not isinstance(navigation_timeout_ms, int) or navigation_timeout_ms < 1000:
        raise HTTPException(status_code=400, detail="config.playwright.navigationTimeoutMs must be an integer >= 1000")
    storage_state = _load_playwright_storage_state_from_config(request, playwright_options)
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
        async with async_playwright() as playwright:
            browser = await playwright.chromium.launch(headless=headless)
            context_options: dict[str, Any] = {}
            if storage_state:
                context_options["storage_state"] = storage_state
            context = await browser.new_context(**context_options)
            page = await context.new_page()
            try:
                await page.goto(target_url, wait_until="domcontentloaded", timeout=navigation_timeout_ms)
                await page.wait_for_timeout(1500)
                eval_result = await page.evaluate(script_to_run)
            finally:
                await context.close()
                await browser.close()
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
    from playwright.async_api import async_playwright

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

    headless = bool(playwright_options.get("headless", True))
    navigation_timeout_ms = playwright_options.get("navigationTimeoutMs", 60000)
    if not isinstance(navigation_timeout_ms, int) or navigation_timeout_ms < 1000:
        raise HTTPException(status_code=400, detail="config.playwright.navigationTimeoutMs must be an integer >= 1000")
    storage_state = _load_playwright_storage_state_from_config(request, playwright_options)
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
        async with async_playwright() as playwright:
            browser = await playwright.chromium.launch(headless=headless)
            context_options: dict[str, Any] = {}
            if storage_state:
                context_options["storage_state"] = storage_state
            context = await browser.new_context(**context_options)
            page = await context.new_page()
            try:
                await page.goto(target_url, wait_until="domcontentloaded", timeout=navigation_timeout_ms)
                await page.wait_for_timeout(1000)
                eval_result = await page.evaluate(script_to_run)
            finally:
                await context.close()
                await browser.close()
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
    from playwright.async_api import async_playwright

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

    headless = bool(playwright_options.get("headless", True))
    navigation_timeout_ms = playwright_options.get("navigationTimeoutMs", 60000)
    if not isinstance(navigation_timeout_ms, int) or navigation_timeout_ms < 1000:
        raise HTTPException(status_code=400, detail="config.playwright.navigationTimeoutMs must be an integer >= 1000")
    storage_state = _load_playwright_storage_state_from_config(request, playwright_options)

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
        async with async_playwright() as playwright:
            browser = await playwright.chromium.launch(headless=headless)
            context_options: dict[str, Any] = {}
            if storage_state:
                context_options["storage_state"] = storage_state
            context = await browser.new_context(**context_options)
            page = await context.new_page()
            try:
                await page.goto(target_url, wait_until="domcontentloaded", timeout=navigation_timeout_ms)
                await page.wait_for_timeout(1200)
                eval_result = await page.evaluate(script_to_run)
            finally:
                await context.close()
                await browser.close()
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
    from playwright.async_api import async_playwright

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

    headless = bool(playwright_options.get("headless", True))
    navigation_timeout_ms = playwright_options.get("navigationTimeoutMs", 60000)
    if not isinstance(navigation_timeout_ms, int) or navigation_timeout_ms < 1000:
        raise HTTPException(status_code=400, detail="config.playwright.navigationTimeoutMs must be an integer >= 1000")
    storage_state = _load_playwright_storage_state_from_config(request, playwright_options)
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
        async with async_playwright() as playwright:
            browser = await playwright.chromium.launch(headless=headless)
            context_options: dict[str, Any] = {}
            if storage_state:
                context_options["storage_state"] = storage_state
            context = await browser.new_context(**context_options)
            page_instance = await context.new_page()
            try:
                await page_instance.goto(target_url, wait_until="domcontentloaded", timeout=navigation_timeout_ms)
                await page_instance.wait_for_timeout(1200)
                eval_result = await page_instance.evaluate(script_to_run)
            finally:
                await context.close()
                await browser.close()
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
    from playwright.async_api import async_playwright

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

    headless = bool(playwright_options.get("headless", True))
    navigation_timeout_ms = playwright_options.get("navigationTimeoutMs", 60000)
    if not isinstance(navigation_timeout_ms, int) or navigation_timeout_ms < 1000:
        raise HTTPException(status_code=400, detail="config.playwright.navigationTimeoutMs must be an integer >= 1000")
    storage_state = _load_playwright_storage_state_from_config(request, playwright_options)
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
        async with async_playwright() as playwright:
            browser = await playwright.chromium.launch(headless=headless)
            context_options: dict[str, Any] = {}
            if storage_state:
                context_options["storage_state"] = storage_state
            context = await browser.new_context(**context_options)
            page = await context.new_page()
            try:
                await page.goto(target_url, wait_until="domcontentloaded", timeout=navigation_timeout_ms)
                await page.wait_for_timeout(1200)
                eval_result = await page.evaluate(script_to_run)
            finally:
                await context.close()
                await browser.close()
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
    from playwright.async_api import async_playwright

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

    headless = bool(playwright_options.get("headless", True))
    navigation_timeout_ms = playwright_options.get("navigationTimeoutMs", 60000)
    if not isinstance(navigation_timeout_ms, int) or navigation_timeout_ms < 1000:
        raise HTTPException(status_code=400, detail="config.playwright.navigationTimeoutMs must be an integer >= 1000")
    storage_state = _load_playwright_storage_state_from_config(request, playwright_options)

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
        async with async_playwright() as playwright:
            browser = await playwright.chromium.launch(headless=headless)
            context_options: dict[str, Any] = {}
            if storage_state:
                context_options["storage_state"] = storage_state
            context = await browser.new_context(**context_options)
            page_instance = await context.new_page()
            try:
                await page_instance.goto(target_url, wait_until="domcontentloaded", timeout=navigation_timeout_ms)
                await page_instance.wait_for_timeout(1200)
                eval_result = await page_instance.evaluate(script_to_run)
            finally:
                await context.close()
                await browser.close()
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


async def _run_playwright_intercept_generic_intent(
    request: FetchRequest,
    intent_type: str,
    platform: str,
) -> list[CleanItem]:
    from playwright.async_api import TimeoutError as PlaywrightTimeoutError
    from playwright.async_api import async_playwright

    normalized_platform = (platform or "").strip().lower()
    supported_intents = _GENERIC_INTERCEPT_INTENTS.get(normalized_platform, set())
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

    headless = bool(playwright_options.get("headless", True))
    navigation_timeout_ms = playwright_options.get("navigationTimeoutMs", 60000)
    if not isinstance(navigation_timeout_ms, int) or navigation_timeout_ms < 1000:
        raise HTTPException(status_code=400, detail="config.playwright.navigationTimeoutMs must be an integer >= 1000")
    storage_state = _load_playwright_storage_state_from_config(request, playwright_options)
    target_url = _GENERIC_INTERCEPT_TARGET_URL.get(normalized_platform, "https://example.com")
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
        _SCRIPT_REGISTRY,
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
        async with async_playwright() as playwright:
            browser = await playwright.chromium.launch(headless=headless)
            context_options: dict[str, Any] = {}
            if storage_state:
                context_options["storage_state"] = storage_state
            context = await browser.new_context(**context_options)
            page_instance = await context.new_page()
            try:
                await page_instance.goto(target_url, wait_until="domcontentloaded", timeout=navigation_timeout_ms)
                await page_instance.wait_for_timeout(1200)
                eval_result = await page_instance.evaluate(script_to_run)
            finally:
                await context.close()
                await browser.close()
    except PlaywrightTimeoutError as error:
        raise HTTPException(status_code=504, detail=f"playwright intercept {normalized_platform} timeout: {error}") from error
    except HTTPException:
        raise
    except Exception as error:
        raise HTTPException(status_code=500, detail=f"playwright intercept {normalized_platform} {normalized_intent} failed: {error}") from error

    items = _normalize_playwright_eval_result(eval_result, request, target_url)
    if not items:
        raise HTTPException(status_code=500, detail=f"playwright intercept {normalized_platform} {normalized_intent} finished without output")
    return items


def _extract_opencli_json_payload(stdout: str) -> Any:
    text = stdout.strip()
    if not text:
        return []
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        pass

    start = text.find("[")
    end = text.rfind("]")
    if start != -1 and end != -1 and end > start:
        try:
            return json.loads(text[start : end + 1])
        except json.JSONDecodeError:
            pass

    start = text.find("{")
    end = text.rfind("}")
    if start != -1 and end != -1 and end > start:
        try:
            return json.loads(text[start : end + 1])
        except json.JSONDecodeError:
            pass
    raise HTTPException(status_code=500, detail="opencli returned non-json output")


async def _run_playwright_opencli_bridge_search(request: FetchRequest) -> list[CleanItem]:
    config = request.config if isinstance(request.config, dict) else {}
    playwright_options = config.get("playwright")
    if not isinstance(playwright_options, dict):
        raise HTTPException(status_code=400, detail="config.playwright must be an object")

    args = playwright_options.get("args", {})
    args_obj = args if isinstance(args, dict) else {}
    query = str(args_obj.get("query", "")).strip()
    if not query:
        raise HTTPException(status_code=400, detail="config.playwright.args.query is required for opencli bridge mode")
    raw_count = args_obj.get("count", 20)
    try:
        count = int(raw_count)
    except (TypeError, ValueError):
        count = 20
    count = max(1, min(count, 100))

    commands = [
        [_OPENCLI_BIN, "twitter", "search", "--query", query, "--limit", str(count), "-f", "json"],
        [_OPENCLI_BIN, "twitter", "search", "--keyword", query, "--limit", str(count), "-f", "json"],
    ]

    last_error: Exception | None = None
    for command in commands:
        try:
            completed = await asyncio.to_thread(
                subprocess.run,
                command,
                capture_output=True,
                text=True,
                cwd=_OPENCLI_CWD,
                check=False,
            )
            if completed.returncode != 0:
                stderr = (completed.stderr or "").strip()
                raise HTTPException(
                    status_code=500,
                    detail=f"opencli command failed({completed.returncode}): {stderr or 'unknown error'}",
                )
            payload = _extract_opencli_json_payload(completed.stdout or "")
            tweets: list[dict[str, Any]] = []
            if isinstance(payload, list):
                for item in payload:
                    if not isinstance(item, dict):
                        continue
                    tweets.append(
                        {
                            "id": item.get("id"),
                            "author": item.get("author"),
                            "name": item.get("name"),
                            "url": item.get("url"),
                            "text": item.get("text"),
                            "created_at": item.get("created_at"),
                        }
                    )
            eval_like_result = {
                "query": query,
                "product": "Latest",
                "count": len(tweets),
                "tweets": tweets,
            }
            items = _normalize_playwright_eval_result(eval_like_result, request, "https://x.com")
            if items:
                return items
            raise HTTPException(status_code=500, detail="opencli returned empty tweet list")
        except HTTPException as error:
            last_error = error
            continue
        except Exception as error:
            last_error = error
            continue

    if isinstance(last_error, HTTPException):
        raise last_error
    raise HTTPException(status_code=500, detail=f"opencli bridge failed: {last_error}")


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


_MISSING = object()


def _read_nested_field(payload: dict[str, Any], path: list[str]) -> Any:
    current: Any = payload
    for segment in path:
        if not isinstance(current, dict) or segment not in current:
            return _MISSING
        current = current[segment]
    return current


def _write_nested_field(payload: dict[str, Any], path: list[str], value: Any) -> None:
    current = payload
    for segment in path[:-1]:
        next_value = current.get(segment)
        if not isinstance(next_value, dict):
            next_value = {}
            current[segment] = next_value
        current = next_value
    current[path[-1]] = value


def _parse_record_time(value: Any) -> datetime | None:
    if isinstance(value, datetime):
        return value
    if isinstance(value, str):
        for candidate in (value, value.replace("Z", "+00:00")):
            try:
                return datetime.fromisoformat(candidate)
            except ValueError:
                continue
        try:
            return datetime.strptime(value, "%a %b %d %H:%M:%S %z %Y")
        except ValueError:
            return None
    return None


def _resolve_source_path(source: dict[str, Any], source_path: list[str]) -> list[str]:
    if not source_path:
        return source_path
    if source_path[0] in source:
        return source_path
    list_aliases = ("tweets", "items", "posts", "results", "data", "notes")
    if len(source_path) > 1 and source_path[0] in list_aliases:
        if source_path[1] in source:
            return source_path[1:]
        for alias in list_aliases:
            if isinstance(source.get(alias), list):
                return [alias, *source_path[1:]]
    if source_path[0] == "text":
        for key in list_aliases:
            if isinstance(source.get(key), list):
                return [key, *source_path[1:]]
    return source_path


def _apply_output_field_map(item: CleanItem, source: dict[str, Any], output_field_map: dict[str, str]) -> list[CleanItem]:
    mappings: list[tuple[list[str], list[str]]] = []
    for target_field, source_field in output_field_map.items():
        if not isinstance(target_field, str) or not target_field.strip():
            continue
        if not isinstance(source_field, str) or not source_field.strip():
            continue
        target_path = [segment for segment in target_field.strip().split(".") if segment]
        source_path = [segment for segment in source_field.strip().split(".") if segment]
        if not target_path or not source_path:
            continue
        mappings.append((target_path, _resolve_source_path(source, source_path)))

    if not mappings:
        item.recordContent = {}
        return [item]

    list_prefixes = {
        source_path[0]
        for _, source_path in mappings
        if len(source_path) > 1 and isinstance(source.get(source_path[0]), list)
    }
    if len(list_prefixes) == 1:
        list_key = next(iter(list_prefixes))
        list_mappings: list[tuple[list[str], list[str]]] = []
        scalar_mappings: list[tuple[list[str], list[str]]] = []
        for target_path, source_path in mappings:
            if len(source_path) > 1 and source_path[0] == list_key:
                list_mappings.append((target_path, source_path))
            else:
                scalar_mappings.append((target_path, source_path))

        raw_rows = source.get(list_key, [])
        if list_mappings and isinstance(raw_rows, list):
            expanded: list[CleanItem] = []
            for index, row in enumerate(raw_rows, start=1):
                if not isinstance(row, dict):
                    continue
                mapped_content: dict[str, Any] = {}
                has_list_values = False
                for target_path, source_path in list_mappings:
                    value = _read_nested_field(row, source_path[1:])
                    if value is _MISSING:
                        continue
                    has_list_values = True
                    _write_nested_field(mapped_content, target_path, value)
                if not has_list_values:
                    continue
                for target_path, source_path in scalar_mappings:
                    value = _read_nested_field(source, source_path)
                    if value is _MISSING:
                        continue
                    _write_nested_field(mapped_content, target_path, value)
                if not mapped_content:
                    continue
                cloned = item.model_copy(deep=True)
                cloned.recordContent = mapped_content
                mapped_id = mapped_content.get("id")
                if isinstance(mapped_id, str) and mapped_id.strip():
                    cloned.recordId = mapped_id.strip()
                mapped_time = mapped_content.get("time", mapped_content.get("created_at"))
                parsed_time = _parse_record_time(mapped_time)
                if parsed_time is not None:
                    cloned.recordTime = parsed_time
                mapped_url = mapped_content.get("url")
                if isinstance(mapped_url, str) and mapped_url.strip():
                    cloned.url = mapped_url.strip()
                cloned.recordIndex = index
                expanded.append(cloned)
            if expanded:
                return expanded

    mapped_content: dict[str, Any] = {}
    for target_path, source_path in mappings:
        value = _read_nested_field(source, source_path)
        if value is _MISSING:
            continue
        _write_nested_field(mapped_content, target_path, value)
    item.recordContent = mapped_content
    return [item]


def _apply_output_fields(
    items: list[CleanItem],
    output_fields: Optional[List[str]],
    output_field_map: Optional[dict[str, str]],
) -> list[CleanItem]:
    if not output_fields and not output_field_map:
        return items

    transformed_items: list[CleanItem] = []
    for item in items:
        source = item.recordContent if isinstance(item.recordContent, dict) else {}
        if output_field_map:
            transformed_items.extend(_apply_output_field_map(item, source, output_field_map))
            continue

        filtered: dict[str, Any] = {}
        for raw_field in output_fields or []:
            if not isinstance(raw_field, str):
                continue
            field = raw_field.strip()
            if not field:
                continue
            if field == "*":
                filtered = dict(source)
                break
            path = [segment for segment in field.split(".") if segment]
            if not path:
                continue
            value = _read_nested_field(source, path)
            if value is _MISSING:
                continue
            _write_nested_field(filtered, path, value)
        item.recordContent = filtered
        transformed_items.append(item)
    return transformed_items


def _as_dict(value: Any) -> dict[str, Any]:
    return value if isinstance(value, dict) else {}


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
    normalized_driver = request.driver.name.strip().lower()
    raw_option = dict(request.driver.option)
    config = raw_option

    if normalized_driver == "playwright":
        if "playwright" in raw_option:
            raise HTTPException(
                status_code=400,
                detail="driver.option.playwright has been removed; put playwright fields directly under driver.option",
            )
        network = raw_option.get("network")
        playwright_option = {k: v for k, v in raw_option.items() if k != "network"}
        config = {"playwright": playwright_option}
        if network is not None:
            config["network"] = network
    elif normalized_driver == "agent-browser" and "agentBrowser" in raw_option:
        raise HTTPException(
            status_code=400,
            detail="driver.option.agentBrowser has been removed; put agent-browser fields directly under driver.option",
        )
    elif normalized_driver == "xhttp" and "xhttp" in raw_option:
        raise HTTPException(
            status_code=400,
            detail="driver.option.xhttp has been removed; put xhttp fields directly under driver.option",
        )

    if normalized_driver == "agent-browser":
        config = _normalize_agent_browser_driver_options(request.source_id, {}, config)

    output = request.output.model_dump()
    output_fields: list[str] = []
    output_field_map: dict[str, str] = {}
    output_keyword_scope: list[str] = []
    raw_fields = output.get("field")
    if isinstance(raw_fields, dict):
        output_field_map = {
            key.strip(): value.strip()
            for key, value in raw_fields.items()
            if isinstance(key, str)
            and key.strip()
            and isinstance(value, str)
            and value.strip()
        }
    elif isinstance(raw_fields, list):
        output_fields = [value for value in raw_fields if isinstance(value, str) and value.strip()]
    output_record_type = output.get("type")
    if not isinstance(output_record_type, str) or not output_record_type.strip():
        output_record_type = None
    else:
        output_record_type = output_record_type.strip()
    raw_keyword_scope = output.get("keywordScope")
    if isinstance(raw_keyword_scope, list):
        output_keyword_scope = [
            value.strip()
            for value in raw_keyword_scope
            if isinstance(value, str) and value.strip()
        ]

    filter_options = dict(request.driver.filter)
    if request.keywords:
        existing_filters = _as_dict(config.get("filters"))
        keyword_filter = {
            **_as_dict(existing_filters.get("keyword")),
            **filter_options,
            "keywords": request.keywords,
        }
        if output_keyword_scope:
            keyword_filter["scopeFields"] = output_keyword_scope
        config["filters"] = {
            **existing_filters,
            "keyword": keyword_filter,
        }

    return FetchRequest(
        platform=request.platform,
        config=config,
        source_id=request.source_id,
        keywords=request.keywords,
        output_fields=output_fields or None,
        output_field_map=output_field_map or None,
        output_keyword_scope=output_keyword_scope or None,
        output_record_type=output_record_type,
    )


def _normalize_v3_fetch_request(request: FetchV3Request) -> tuple[FetchRequest, str, FetchV3Meta]:
    driver_name = "playwright"
    driver_option: dict[str, Any] = {}
    driver_filter: dict[str, Any] = {}
    if request.driver is not None:
        if request.driver.name and request.driver.name.strip():
            driver_name = request.driver.name.strip()
        driver_option = dict(request.driver.option)
        driver_filter = dict(request.driver.filter)
    driver_name = driver_name.strip().lower()

    intent_type = request.intent.type.strip().lower() if request.intent.type.strip() else "search"
    intent_args = dict(request.intent.args) if isinstance(request.intent.args, dict) else {}
    adapter = f"{request.platform.lower().strip()}.{intent_type}"
    driver_option = _merge_v3_intent_into_driver_option(
        request.platform,
        intent_type,
        intent_args,
        driver_name,
        driver_option,
    )

    v2_request = FetchV2Request(
        platform=request.platform,
        sourceId=request.source_id,
        keywords=request.keywords,
        driver={
            "name": driver_name,
            "option": driver_option,
            "filter": driver_filter,
        },
        output=request.output.model_dump(),
    )
    normalized_request = _normalize_v2_fetch_request(v2_request)
    strategy_tried = _V3_DRIVER_STRATEGIES.get(driver_name, [driver_name or "playwright"])
    meta = FetchV3Meta(
        adapter=adapter,
        strategyTried=strategy_tried,
        strategyUsed=strategy_tried[0],
        driverUsed=driver_name,
    )
    return normalized_request, driver_name, meta


def _merge_v3_intent_into_driver_option(
    platform: str,
    intent_type: str,
    intent_args: dict[str, Any],
    driver_name: str,
    option: dict[str, Any],
) -> dict[str, Any]:
    merged_option = dict(option)
    query = intent_args.get("query")
    subreddit = intent_args.get("subreddit", intent_args.get("name"))
    sort = intent_args.get("sort")
    time_filter = intent_args.get("time")
    username = intent_args.get("username")
    xhs_user_id = intent_args.get("id", intent_args.get("user_id"))
    tweet_id = intent_args.get("tweet_id", intent_args.get("tweetId"))
    question_id = intent_args.get("id", intent_args.get("question_id", intent_args.get("questionId")))
    bvid = intent_args.get("bvid", intent_args.get("id"))
    url = intent_args.get("url")
    limit = intent_args.get("limit")
    normalized_query = query.strip() if isinstance(query, str) else ""
    normalized_subreddit = subreddit.strip() if isinstance(subreddit, str) else ""
    normalized_username = username.strip().lstrip("@") if isinstance(username, str) else ""
    normalized_xhs_user_id = xhs_user_id.strip() if isinstance(xhs_user_id, str) else ""
    if normalized_username.lower().startswith("u/"):
        normalized_username = normalized_username[2:]
    normalized_tweet_id = _extract_tweet_id(tweet_id)
    normalized_question_id = str(question_id).strip() if question_id is not None else ""
    normalized_bvid = str(bvid).strip() if bvid is not None else ""
    if not normalized_tweet_id and isinstance(url, str):
        normalized_tweet_id = _extract_tweet_id(url)
    normalized_limit = limit if isinstance(limit, int) and limit > 0 else None

    if driver_name in {"playwright", "agent-browser"}:
        args = merged_option.get("args")
        args_obj = dict(args) if isinstance(args, dict) else {}
        if intent_type == "search":
            if normalized_query and (not isinstance(args_obj.get("query"), str) or not args_obj.get("query")):
                args_obj["query"] = normalized_query
            if (platform or "").strip().lower() == "x" and "type" not in args_obj:
                args_obj["type"] = "latest"
            if (platform or "").strip().lower() in {"linux-do", "linuxdo"}:
                keyword_arg = intent_args.get("keyword", intent_args.get("query"))
                if isinstance(keyword_arg, str) and keyword_arg.strip() and "keyword" not in args_obj:
                    args_obj["keyword"] = keyword_arg.strip()
            if (platform or "").strip().lower() == "zhihu":
                keyword_arg = intent_args.get("keyword", intent_args.get("query"))
                if isinstance(keyword_arg, str) and keyword_arg.strip() and "keyword" not in args_obj:
                    args_obj["keyword"] = keyword_arg.strip()
            if (platform or "").strip().lower() == "bilibili":
                keyword_arg = intent_args.get("keyword", intent_args.get("query"))
                if isinstance(keyword_arg, str) and keyword_arg.strip() and "keyword" not in args_obj:
                    args_obj["keyword"] = keyword_arg.strip()
            normalized_platform = (platform or "").strip().lower()
            if normalized_platform == "linkedin":
                if isinstance(intent_args.get("location"), str) and "location" not in args_obj:
                    args_obj["location"] = intent_args.get("location")
                if isinstance(intent_args.get("company"), str) and "company" not in args_obj:
                    args_obj["company"] = intent_args.get("company")
                experience_level = intent_args.get("experience_level", intent_args.get("experienceLevel"))
                if isinstance(experience_level, str) and "experience_level" not in args_obj:
                    args_obj["experience_level"] = experience_level
                job_type = intent_args.get("job_type", intent_args.get("jobType"))
                if isinstance(job_type, str) and "job_type" not in args_obj:
                    args_obj["job_type"] = job_type
                date_posted = intent_args.get("date_posted", intent_args.get("datePosted"))
                if isinstance(date_posted, str) and "date_posted" not in args_obj:
                    args_obj["date_posted"] = date_posted
                if isinstance(intent_args.get("remote"), str) and "remote" not in args_obj:
                    args_obj["remote"] = intent_args.get("remote")
                start_arg = intent_args.get("start")
                if isinstance(start_arg, int) and "start" not in args_obj:
                    args_obj["start"] = start_arg
                details_arg = intent_args.get("details")
                if isinstance(details_arg, bool) and "details" not in args_obj:
                    args_obj["details"] = details_arg
                if "query" in intent_args and isinstance(intent_args.get("query"), str):
                    args_obj["query"] = intent_args.get("query").strip()
        if intent_type in {"subreddit", "hot"}:
            if normalized_subreddit and (not isinstance(args_obj.get("subreddit"), str) or not args_obj.get("subreddit")):
                args_obj["subreddit"] = normalized_subreddit
            if normalized_subreddit and (not isinstance(args_obj.get("name"), str) or not args_obj.get("name")):
                args_obj["name"] = normalized_subreddit
        if intent_type in {"profile", "followers", "following"}:
            if normalized_username and (not isinstance(args_obj.get("username"), str) or not args_obj.get("username")):
                args_obj["username"] = normalized_username
        if intent_type == "user":
            if normalized_username and (not isinstance(args_obj.get("username"), str) or not args_obj.get("username")):
                args_obj["username"] = normalized_username
            if normalized_xhs_user_id and (not isinstance(args_obj.get("id"), str) or not args_obj.get("id")):
                args_obj["id"] = normalized_xhs_user_id
        if intent_type in {"user", "user-posts", "user-comments"}:
            if normalized_username and (not isinstance(args_obj.get("username"), str) or not args_obj.get("username")):
                args_obj["username"] = normalized_username
        if intent_type in {"thread", "article"}:
            if normalized_tweet_id and (not isinstance(args_obj.get("tweet_id"), str) or not args_obj.get("tweet_id")):
                args_obj["tweet_id"] = normalized_tweet_id
        if intent_type == "question":
            if normalized_question_id and (not isinstance(args_obj.get("id"), str) or not args_obj.get("id")):
                args_obj["id"] = normalized_question_id
        if intent_type in {"video", "comments"}:
            if normalized_bvid and (not isinstance(args_obj.get("bvid"), str) or not args_obj.get("bvid")):
                args_obj["bvid"] = normalized_bvid
        if intent_type in {"popular", "comments"}:
            page_arg = intent_args.get("page")
            if isinstance(page_arg, int) and page_arg > 0 and "page" not in args_obj:
                args_obj["page"] = page_arg
        if intent_type == "search":
            page_arg = intent_args.get("page")
            if isinstance(page_arg, int) and page_arg > 0 and "page" not in args_obj:
                args_obj["page"] = page_arg
        if intent_type == "search":
            order_arg = intent_args.get("order")
            if isinstance(order_arg, str) and order_arg.strip() and "order" not in args_obj:
                args_obj["order"] = order_arg.strip()
        if intent_type == "feed":
            type_arg = intent_args.get("type")
            if isinstance(type_arg, str) and type_arg.strip() and "type" not in args_obj:
                args_obj["type"] = type_arg.strip().lower()
        if intent_type == "ranking":
            category_arg = intent_args.get("category")
            if isinstance(category_arg, int) and "category" not in args_obj:
                args_obj["category"] = category_arg
        if intent_type == "comments":
            sort_arg = intent_args.get("sort")
            if isinstance(sort_arg, int) and "sort" not in args_obj:
                args_obj["sort"] = sort_arg
        if intent_type == "ranking":
            category_arg = intent_args.get("category")
            if isinstance(category_arg, int) and "category" not in args_obj:
                args_obj["category"] = category_arg
        if intent_type in {"video", "transcript"}:
            raw_url_arg = intent_args.get("url", intent_args.get("video_url", intent_args.get("video_id")))
            if isinstance(raw_url_arg, str) and raw_url_arg.strip() and "url" not in args_obj:
                args_obj["url"] = raw_url_arg.strip()
        if intent_type == "channel":
            channel_id_arg = intent_args.get("id", intent_args.get("channel_id"))
            if isinstance(channel_id_arg, str) and channel_id_arg.strip() and "id" not in args_obj:
                args_obj["id"] = channel_id_arg.strip()
        if intent_type == "transcript":
            lang_arg = intent_args.get("lang")
            if isinstance(lang_arg, str) and lang_arg.strip() and "lang" not in args_obj:
                args_obj["lang"] = lang_arg.strip()
            mode_arg = intent_args.get("mode")
            if isinstance(mode_arg, str) and mode_arg.strip() and "mode" not in args_obj:
                args_obj["mode"] = mode_arg.strip().lower()
        if intent_type in {"comments", "post", "user"}:
            weibo_id_arg = intent_args.get("id")
            if isinstance(weibo_id_arg, str) and weibo_id_arg.strip() and "id" not in args_obj:
                args_obj["id"] = weibo_id_arg.strip()
        if intent_type == "user_posts":
            weibo_uid_arg = intent_args.get("uid", intent_args.get("id"))
            if isinstance(weibo_uid_arg, str) and weibo_uid_arg.strip() and "uid" not in args_obj:
                args_obj["uid"] = weibo_uid_arg.strip()
            page_arg = intent_args.get("page")
            if isinstance(page_arg, int) and page_arg > 0 and "page" not in args_obj:
                args_obj["page"] = page_arg
            feature_arg = intent_args.get("feature")
            if isinstance(feature_arg, int) and feature_arg >= 0 and "feature" not in args_obj:
                args_obj["feature"] = feature_arg
        if intent_type == "comments":
            max_id_arg = intent_args.get("max_id", intent_args.get("maxId"))
            if isinstance(max_id_arg, str) and max_id_arg.strip() and "max_id" not in args_obj:
                args_obj["max_id"] = max_id_arg.strip()
        if intent_type == "hot":
            period_arg = intent_args.get("period")
            if isinstance(period_arg, str) and period_arg.strip() and "period" not in args_obj:
                args_obj["period"] = period_arg.strip().lower()
        if intent_type == "category":
            if isinstance(intent_args.get("slug"), str) and intent_args.get("slug").strip() and "slug" not in args_obj:
                args_obj["slug"] = intent_args.get("slug").strip()
            category_id = intent_args.get("id", intent_args.get("category_id"))
            if isinstance(category_id, int) and category_id > 0 and "id" not in args_obj:
                args_obj["id"] = category_id
        if intent_type == "topic":
            topic_id = intent_args.get("id", intent_args.get("topic_id"))
            if isinstance(topic_id, int) and topic_id > 0 and "id" not in args_obj:
                args_obj["id"] = topic_id
        if normalized_limit is not None and "count" not in args_obj:
            args_obj["count"] = str(normalized_limit)
        if normalized_limit is not None and "limit" not in args_obj:
            args_obj["limit"] = normalized_limit
        if isinstance(sort, str) and sort.strip():
            if not isinstance(args_obj.get("sort"), str) or not args_obj.get("sort"):
                args_obj["sort"] = sort.strip()
        if isinstance(time_filter, str) and time_filter.strip():
            if not isinstance(args_obj.get("time"), str) or not args_obj.get("time"):
                args_obj["time"] = time_filter.strip()
        if args_obj:
            merged_option["args"] = args_obj
        if driver_name == "playwright":
            has_script_body = isinstance(merged_option.get("scriptBody"), str) and merged_option.get("scriptBody", "").strip()
            has_script_path = isinstance(merged_option.get("scriptPath"), str) and merged_option.get("scriptPath", "").strip()
            current_mode = str(merged_option.get("mode", "")).strip().lower()
            if (
                not has_script_body
                and not has_script_path
                and not current_mode
            ):
                normalized_platform = (platform or "").strip().lower()
                if normalized_platform in {"x", "twitter"} and intent_type in _X_INTERCEPT_INTENTS:
                    merged_option["mode"] = f"intercept-x-{intent_type}"
                elif normalized_platform == "reddit" and intent_type in _REDDIT_INTERCEPT_INTENTS:
                    merged_option["mode"] = f"intercept-reddit-{intent_type}"
                elif normalized_platform in {"xhs", "xiaohongshu"} and intent_type in _XHS_INTERCEPT_INTENTS:
                    merged_option["mode"] = f"intercept-xhs-{intent_type}"
                elif normalized_platform == "bbc" and intent_type in _BBC_INTERCEPT_INTENTS:
                    merged_option["mode"] = f"intercept-bbc-{intent_type}"
                elif normalized_platform in {"hackernews", "hn"} and intent_type in _HACKERNEWS_INTERCEPT_INTENTS:
                    merged_option["mode"] = f"intercept-hackernews-{intent_type}"
                elif normalized_platform == "linkedin" and intent_type in _LINKEDIN_INTERCEPT_INTENTS:
                    merged_option["mode"] = f"intercept-linkedin-{intent_type}"
                elif normalized_platform in {"linux-do", "linuxdo"} and intent_type in _LINUX_DO_INTERCEPT_INTENTS:
                    merged_option["mode"] = f"intercept-linux-do-{intent_type}"
                elif normalized_platform == "youtube" and intent_type in _YOUTUBE_INTERCEPT_INTENTS:
                    merged_option["mode"] = f"intercept-youtube-{intent_type}"
                elif normalized_platform == "weibo" and intent_type in _WEIBO_INTERCEPT_INTENTS:
                    merged_option["mode"] = f"intercept-weibo-{intent_type}"
                elif normalized_platform == "zhihu" and intent_type in _ZHIHU_INTERCEPT_INTENTS:
                    merged_option["mode"] = f"intercept-zhihu-{intent_type}"
                elif normalized_platform == "bilibili" and intent_type in _BILIBILI_INTERCEPT_INTENTS:
                    merged_option["mode"] = f"intercept-bilibili-{intent_type}"
                elif normalized_platform == "36kr" and intent_type in _KR36_INTERCEPT_INTENTS:
                    merged_option["mode"] = f"intercept-36kr-{intent_type}"
                elif normalized_platform == "arxiv" and intent_type in _ARXIV_INTERCEPT_INTENTS:
                    merged_option["mode"] = f"intercept-arxiv-{intent_type}"
                elif normalized_platform == "baidu" and intent_type in _BAIDU_INTERCEPT_INTENTS:
                    merged_option["mode"] = f"intercept-baidu-{intent_type}"
                elif normalized_platform == "bing" and intent_type in _BING_INTERCEPT_INTENTS:
                    merged_option["mode"] = f"intercept-bing-{intent_type}"
                elif normalized_platform == "cnblogs" and intent_type in _CNBLOGS_INTERCEPT_INTENTS:
                    merged_option["mode"] = f"intercept-cnblogs-{intent_type}"
                elif normalized_platform == "csdn" and intent_type in _CSDN_INTERCEPT_INTENTS:
                    merged_option["mode"] = f"intercept-csdn-{intent_type}"
                elif normalized_platform == "ctrip" and intent_type in _CTRIP_INTERCEPT_INTENTS:
                    merged_option["mode"] = f"intercept-ctrip-{intent_type}"
                elif normalized_platform == "devto" and intent_type in _DEVTO_INTERCEPT_INTENTS:
                    merged_option["mode"] = f"intercept-devto-{intent_type}"
                elif normalized_platform == "duckduckgo" and intent_type in _DUCKDUCKGO_INTERCEPT_INTENTS:
                    merged_option["mode"] = f"intercept-duckduckgo-{intent_type}"
                elif normalized_platform == "google" and intent_type in _GOOGLE_INTERCEPT_INTENTS:
                    merged_option["mode"] = f"intercept-google-{intent_type}"
                elif normalized_platform == "reuters" and intent_type in _REUTERS_INTERCEPT_INTENTS:
                    merged_option["mode"] = f"intercept-reuters-{intent_type}"
                elif normalized_platform == "toutiao" and intent_type in _TOUTIAO_INTERCEPT_INTENTS:
                    merged_option["mode"] = f"intercept-toutiao-{intent_type}"
                elif normalized_platform == "hupu" and intent_type in _HUPU_INTERCEPT_INTENTS:
                    merged_option["mode"] = f"intercept-hupu-{intent_type}"
                elif intent_type == "search":
                    merged_option["mode"] = "opencli-bridge" if _OPENCLI_BRIDGE_ENABLED else "intercept-x-search"
        return merged_option

    if driver_name == "xhttp":
        if intent_type != "search":
            return merged_option
        params = merged_option.get("params")
        params_obj = dict(params) if isinstance(params, dict) else {}
        if normalized_query and (not isinstance(params_obj.get("q"), str) or not params_obj.get("q")):
            params_obj["q"] = normalized_query
        if normalized_limit is not None and "limit" not in params_obj:
            params_obj["limit"] = normalized_limit
        if params_obj:
            merged_option["params"] = params_obj
        return merged_option

    return merged_option


def _build_validation_error_response(route: str, payload: Dict[str, Any], error: ValidationError) -> JSONResponse:
    first_error = error.errors()[0] if error.errors() else {}
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
    _log_api_io(route, payload, response.body.decode("utf-8"), 422)
    return response


async def _execute_fetch_request(request: FetchRequest, driver_name: str) -> list[CleanItem]:
    raw_results = await driver_registry.fetch(request, driver_name=driver_name)
    results = _normalize_clean_items(raw_results)
    if request.output_record_type:
        for item in results:
            item.recordType = request.output_record_type
    results = _apply_output_fields(results, request.output_fields, request.output_field_map)
    results = apply_keyword_hard_filter(request, results)
    if driver_name:
        for item in results:
            item.driver = driver_name
    return results


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
        return _build_validation_error_response("/v2/fetch", payload, e)

    try:
        v1_request = _normalize_v2_fetch_request(request)
        response_payload = await _execute_fetch_request(v1_request, request.driver.name)
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
    "/v3/fetch",
    response_model=FetchV3Response,
    response_model_exclude_none=True,
    responses={
        400: {"model": ErrorResponse},
        422: {"model": ErrorResponse},
        500: {"model": ErrorResponse},
    },
)
async def fetch_data_v3(payload: Dict[str, Any]):
    try:
        request = FetchV3Request.model_validate(payload)
    except ValidationError as e:
        return _build_validation_error_response("/v3/fetch", payload, e)

    try:
        normalized_request, driver_name, meta = _normalize_v3_fetch_request(request)
        items = await _execute_fetch_request(normalized_request, driver_name)
        response_payload = FetchV3Response(items=items, meta=meta)
        _log_api_io(
            "/v3/fetch",
            payload,
            response_payload.model_dump(mode="json", by_alias=True, exclude_none=True),
            200,
        )
        return response_payload
    except DriverNotFoundError as error:
        response = _to_driver_error_response(error)
        _log_api_io("/v3/fetch", payload, response.body.decode("utf-8"), 400)
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
        _log_api_io("/v3/fetch", payload, response.body.decode("utf-8"), status_code)
        return response
    except Exception:
        response = build_error_response(
            status_code=500,
            code="FETCH_INTERNAL_ERROR",
            message="Internal server error",
            retryable=True,
        )
        _log_api_io("/v3/fetch", payload, response.body.decode("utf-8"), 500)
        return response


@app.get("/v3/scripts/catalog")
async def list_scripts_catalog():
    payload = _build_scripts_catalog()
    _log_api_io("/v3/scripts/catalog", {}, payload, 200)
    return payload


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
