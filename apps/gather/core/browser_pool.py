"""Playwright browser pool management and application lifespan."""

import asyncio
import hashlib
import json
import logging
import os
from contextlib import asynccontextmanager, suppress
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from fastapi import FastAPI

from core.config import (
    API_IO_LOG_DIR,
    API_IO_LOG_ENABLED,
    PLAYWRIGHT_POOL_SWEEP_INTERVAL_MS,
)
from schemas import FetchRequest

logger = logging.getLogger("gather")


# ---------------------------------------------------------------------------
# Pool data structures
# ---------------------------------------------------------------------------

@dataclass
class PlaywrightBrowserPoolEntry:
    browser: Any
    last_used_at: float
    idle_timeout_ms: int
    context: Any | None = None
    keeper_page: Any | None = None
    active_tabs: int = 0
    lock: asyncio.Lock = field(default_factory=asyncio.Lock)


_BROWSER_POOL: dict[str, PlaywrightBrowserPoolEntry] = {}
_POOL_LOCK = asyncio.Lock()
_RUNTIME = None
_RUNTIME_LOCK = asyncio.Lock()
_SWEEP_TASK: asyncio.Task[Any] | None = None


def resolve_playwright_driver_node_path() -> Path:
    import playwright

    driver_dir = Path(playwright.__file__).resolve().parent / "driver"
    node_name = "node.exe" if os.name == "nt" else "node"
    return driver_dir / node_name


def ensure_playwright_driver_binary() -> Path:
    driver_node_path = resolve_playwright_driver_node_path()
    if not driver_node_path.exists():
        raise RuntimeError(
            "Playwright driver binary is missing "
            f"({driver_node_path}). "
            "This can be caused by a broken mirror wheel. "
            "Please reinstall Playwright from official PyPI and browsers: "
            "`cd apps/gather && uv pip install --python .venv/bin/python --index-url https://pypi.org/simple --force-reinstall playwright && uv run python -m playwright install chromium`"
        )
    return driver_node_path


# ---------------------------------------------------------------------------
# Hashing helpers
# ---------------------------------------------------------------------------

def _stable_hash(value: Any) -> str:
    dumped = json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False)
    return hashlib.sha256(dumped.encode("utf-8")).hexdigest()


def build_pool_key(
    request: FetchRequest, options: dict[str, Any], storage_state: Any
) -> str:
    platform = request.platform.lower().strip()
    user_id = str(options.get("pool_user_id") or "")
    driver = str(options.get("pool_driver") or "playwright")
    proxy_fingerprint = _stable_hash(options.get("proxy") or {})
    auth_fingerprint = _stable_hash(storage_state or {})
    return "|".join([
        platform,
        driver,
        user_id,
        "1" if options["headless"] else "0",
        proxy_fingerprint,
        auth_fingerprint,
    ])


# ---------------------------------------------------------------------------
# Pool lifecycle
# ---------------------------------------------------------------------------

async def _sweep_idle_browsers(now: float) -> None:
    to_close: list[PlaywrightBrowserPoolEntry] = []
    for key, entry in list(_BROWSER_POOL.items()):
        is_connected = getattr(entry.browser, "is_connected", None)
        if callable(is_connected) and not is_connected():
            if entry.active_tabs == 0:
                _BROWSER_POOL.pop(key, None)
                to_close.append(entry)
            continue
        idle_for_ms = int((now - entry.last_used_at) * 1000)
        if idle_for_ms >= entry.idle_timeout_ms and entry.active_tabs == 0:
            _BROWSER_POOL.pop(key, None)
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


async def acquire_pooled_entry(
    playwright: Any,
    options: dict[str, Any],
    request: FetchRequest,
    storage_state: Any,
) -> tuple[str, PlaywrightBrowserPoolEntry]:
    pool_key = build_pool_key(request, options, storage_state)
    now = asyncio.get_running_loop().time()
    async with _POOL_LOCK:
        await _sweep_idle_browsers(now)
        entry = _BROWSER_POOL.get(pool_key)
        if entry is not None:
            is_connected = getattr(entry.browser, "is_connected", None)
            if callable(is_connected) and not is_connected():
                _BROWSER_POOL.pop(pool_key, None)
            else:
                entry.last_used_at = now
                return pool_key, entry

        launch_options: dict[str, Any] = {"headless": options["headless"]}
        if options["proxy"] is not None:
            launch_options["proxy"] = options["proxy"]
        browser = await playwright.chromium.launch(**launch_options)
        entry = PlaywrightBrowserPoolEntry(
            browser=browser,
            last_used_at=now,
            idle_timeout_ms=options["pool_idle_timeout_ms"],
        )
        _BROWSER_POOL[pool_key] = entry
        return pool_key, entry


async def acquire_pooled_page(
    entry: PlaywrightBrowserPoolEntry, storage_state: Any
) -> Any:
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


async def release_pooled_page(
    entry: PlaywrightBrowserPoolEntry, page: Any
) -> None:
    try:
        if page is not None and not page.is_closed():
            await page.close()
    except Exception:
        pass
    async with entry.lock:
        if entry.active_tabs > 0:
            entry.active_tabs -= 1
        entry.last_used_at = asyncio.get_running_loop().time()


async def _sweep_loop() -> None:
    while True:
        await asyncio.sleep(PLAYWRIGHT_POOL_SWEEP_INTERVAL_MS / 1000)
        now = asyncio.get_running_loop().time()
        async with _POOL_LOCK:
            await _sweep_idle_browsers(now)


async def close_all_browsers() -> None:
    async with _POOL_LOCK:
        entries = list(_BROWSER_POOL.values())
        _BROWSER_POOL.clear()
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


async def get_playwright_runtime() -> Any:
    global _RUNTIME
    if _RUNTIME is not None:
        return _RUNTIME

    from playwright.async_api import async_playwright

    async with _RUNTIME_LOCK:
        if _RUNTIME is None:
            ensure_playwright_driver_binary()
            try:
                _RUNTIME = await async_playwright().start()
            except FileNotFoundError as error:
                raise RuntimeError(
                    "Playwright runtime failed to start because its driver binary is missing. "
                    "Run: `cd apps/gather && uv pip install --python .venv/bin/python --index-url https://pypi.org/simple --force-reinstall playwright && uv run python -m playwright install chromium`"
                ) from error
    return _RUNTIME


# ---------------------------------------------------------------------------
# FastAPI lifespan
# ---------------------------------------------------------------------------

@asynccontextmanager
async def app_lifespan(_app: FastAPI):
    global _SWEEP_TASK, _RUNTIME

    if API_IO_LOG_ENABLED:
        logger.info("api io log dir=%s", API_IO_LOG_DIR)
    if os.getenv("GATHER_PREFLIGHT_PLAYWRIGHT", "true").lower() != "false":
        ensure_playwright_driver_binary()
        logger.info("playwright preflight passed")

    if _SWEEP_TASK is None or _SWEEP_TASK.done():
        _SWEEP_TASK = asyncio.create_task(_sweep_loop())
    try:
        yield
    finally:
        if _SWEEP_TASK is not None:
            _SWEEP_TASK.cancel()
            with suppress(asyncio.CancelledError):
                await _SWEEP_TASK
            _SWEEP_TASK = None
        await close_all_browsers()
        async with _RUNTIME_LOCK:
            if _RUNTIME is not None:
                await _RUNTIME.stop()
                _RUNTIME = None
