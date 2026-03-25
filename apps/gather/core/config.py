"""Environment configuration, path constants, and platform intent registries."""

import os
import re
from pathlib import Path

from dotenv import load_dotenv

from libs.script_framework import ScriptRegistry

load_dotenv()


def _env_flag(name: str, default: bool = False) -> bool:
    value = os.getenv(name)
    if value is None:
        return default
    return value.strip().lower() in {"1", "true", "yes", "on"}


# ---------------------------------------------------------------------------
# Paths
# ---------------------------------------------------------------------------

GATHER_APP_ROOT = Path(__file__).resolve().parents[1]
SCRIPT_SOURCE_ROOT = GATHER_APP_ROOT / "scripts"
SCRIPT_RUNTIME_ROOT = GATHER_APP_ROOT / "scripts-dist"
REPO_ROOT = GATHER_APP_ROOT.parents[1]
AUTH_DIR = GATHER_APP_ROOT / ".auth"

# ---------------------------------------------------------------------------
# Feature flags & env
# ---------------------------------------------------------------------------

API_IO_LOG_ENABLED = _env_flag("GATHER_API_IO_LOG_ENABLED", False)
EXPOSE_INTERNAL_ERROR = _env_flag("GATHER_EXPOSE_INTERNAL_ERROR", False)
SEARCH_ALIAS_COMPAT_ENABLED = _env_flag("GATHER_SEARCH_ALIAS_COMPAT_ENABLED", True)

PLAYWRIGHT_POOL_SWEEP_INTERVAL_MS = max(
    1000,
    int(os.getenv("GATHER_PLAYWRIGHT_POOL_SWEEP_INTERVAL_MS", "5000")),
)

# ---------------------------------------------------------------------------
# API I/O log directory resolution
# ---------------------------------------------------------------------------

_RAW_API_IO_LOG_DIR = Path(
    os.getenv("GATHER_API_IO_LOG_DIR", str(GATHER_APP_ROOT / "logs"))
).expanduser()

if _RAW_API_IO_LOG_DIR.is_absolute():
    API_IO_LOG_DIR = _RAW_API_IO_LOG_DIR
elif str(_RAW_API_IO_LOG_DIR).startswith("apps/"):
    API_IO_LOG_DIR = (REPO_ROOT / _RAW_API_IO_LOG_DIR).resolve()
else:
    API_IO_LOG_DIR = (GATHER_APP_ROOT / _RAW_API_IO_LOG_DIR).resolve()

API_IO_LOG_MAX_CHARS = int(os.getenv("GATHER_API_IO_LOG_MAX_CHARS", "120000"))

if API_IO_LOG_ENABLED:
    try:
        API_IO_LOG_DIR.mkdir(parents=True, exist_ok=True)
    except Exception:
        pass

# ---------------------------------------------------------------------------
# Profile / auth-state file constants
# ---------------------------------------------------------------------------

MAX_PROFILE_SIZE = 100 * 1024 * 1024  # 100 MB
PROFILE_NAME_PATTERN = re.compile(r"^[a-zA-Z0-9_-]{1,64}$")
STATE_FILE_NAME_PATTERN = re.compile(r"^[a-z0-9_-]{1,64}\.json$")

# ---------------------------------------------------------------------------
# Script registry and per-platform intercept intents
# ---------------------------------------------------------------------------

SCRIPT_REGISTRY = ScriptRegistry(SCRIPT_SOURCE_ROOT, SCRIPT_RUNTIME_ROOT)

X_INTERCEPT_INTENTS = SCRIPT_REGISTRY.intents_for("x")
REDDIT_INTERCEPT_INTENTS = SCRIPT_REGISTRY.intents_for("reddit")
XHS_INTERCEPT_INTENTS = SCRIPT_REGISTRY.intents_for("xhs")
BBC_INTERCEPT_INTENTS = SCRIPT_REGISTRY.intents_for("bbc")
HACKERNEWS_INTERCEPT_INTENTS = SCRIPT_REGISTRY.intents_for("hackernews")
LINKEDIN_INTERCEPT_INTENTS = SCRIPT_REGISTRY.intents_for("linkedin")
LINUX_DO_INTERCEPT_INTENTS = SCRIPT_REGISTRY.intents_for("linux-do")
YOUTUBE_INTERCEPT_INTENTS = SCRIPT_REGISTRY.intents_for("youtube")
WEIBO_INTERCEPT_INTENTS = SCRIPT_REGISTRY.intents_for("weibo")
ZHIHU_INTERCEPT_INTENTS = SCRIPT_REGISTRY.intents_for("zhihu")
BILIBILI_INTERCEPT_INTENTS = SCRIPT_REGISTRY.intents_for("bilibili")
KR36_INTERCEPT_INTENTS = SCRIPT_REGISTRY.intents_for("36kr")
ARXIV_INTERCEPT_INTENTS = SCRIPT_REGISTRY.intents_for("arxiv")
BAIDU_INTERCEPT_INTENTS = SCRIPT_REGISTRY.intents_for("baidu")
BING_INTERCEPT_INTENTS = SCRIPT_REGISTRY.intents_for("bing")
CNBLOGS_INTERCEPT_INTENTS = SCRIPT_REGISTRY.intents_for("cnblogs")
CSDN_INTERCEPT_INTENTS = SCRIPT_REGISTRY.intents_for("csdn")
CTRIP_INTERCEPT_INTENTS = SCRIPT_REGISTRY.intents_for("ctrip")
DEVTO_INTERCEPT_INTENTS = SCRIPT_REGISTRY.intents_for("devto")
DUCKDUCKGO_INTERCEPT_INTENTS = SCRIPT_REGISTRY.intents_for("duckduckgo")
GOOGLE_INTERCEPT_INTENTS = SCRIPT_REGISTRY.intents_for("google")
REUTERS_INTERCEPT_INTENTS = SCRIPT_REGISTRY.intents_for("reuters")
TOUTIAO_INTERCEPT_INTENTS = SCRIPT_REGISTRY.intents_for("toutiao")
HUPU_INTERCEPT_INTENTS = SCRIPT_REGISTRY.intents_for("hupu")

SEARCH_INTENTS: set[str] = {"search"}

GENERIC_INTERCEPT_INTENTS: dict[str, set[str]] = {
    "36kr": KR36_INTERCEPT_INTENTS,
    "arxiv": ARXIV_INTERCEPT_INTENTS,
    "baidu": BAIDU_INTERCEPT_INTENTS,
    "bing": BING_INTERCEPT_INTENTS,
    "cnblogs": CNBLOGS_INTERCEPT_INTENTS,
    "csdn": CSDN_INTERCEPT_INTENTS,
    "ctrip": CTRIP_INTERCEPT_INTENTS,
    "devto": DEVTO_INTERCEPT_INTENTS,
    "duckduckgo": DUCKDUCKGO_INTERCEPT_INTENTS,
    "google": GOOGLE_INTERCEPT_INTENTS,
    "reuters": REUTERS_INTERCEPT_INTENTS,
    "toutiao": TOUTIAO_INTERCEPT_INTENTS,
    "hupu": HUPU_INTERCEPT_INTENTS,
}

GENERIC_INTERCEPT_TARGET_URL: dict[str, str] = {
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

# ---------------------------------------------------------------------------
# V3 driver strategy table
# ---------------------------------------------------------------------------

V3_DRIVER_STRATEGIES: dict[str, list[str]] = {
    "playwright": ["cookie", "header", "intercept", "ui"],
    "xhttp": ["public", "cookie", "header"],
}

# ---------------------------------------------------------------------------
# Platform alias and default target URLs
# ---------------------------------------------------------------------------

PLATFORM_ALIAS: dict[str, str] = {
    "x": "twitter",
    "twitter": "twitter",
    "xhs": "xiaohongshu",
}

PLATFORM_DEFAULT_URL: dict[str, str] = {
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

# ---------------------------------------------------------------------------
# Script catalog helpers
# ---------------------------------------------------------------------------

SCRIPT_SAMPLE_LINE_RE = re.compile(r"^\s*//\s*Sample\s+/v1/fetch key parts\s*$")
SCRIPT_SAMPLE_ENTRY_RE = re.compile(r"^\s*//\s*([^:]+):\s*(.+?)\s*$")
SCRIPT_ALLOWED_CATEGORIES = {"STREAM", "INTERACTIVE", "RETRIEVAL"}

# ---------------------------------------------------------------------------
# Playwright compatibility patch
# ---------------------------------------------------------------------------

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
