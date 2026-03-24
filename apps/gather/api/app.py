"""Oak Gather API entrypoint."""

from fastapi import FastAPI

from api.services import runtime_service as runtime

# Re-export runtime symbols so existing imports/tests keep working.
for _name in dir(runtime):
    if _name.startswith("__"):
        continue
    globals()[_name] = getattr(runtime, _name)


_RUNTIME_PATCHABLE_NAMES = [
    "driver_registry",
    "playwright_verify_auth",
    "_run_playwright_eval_script",
    "_extract_playwright_eval_options",
    "_run_playwright_script",
    "_apply_xiaohongshu_user_me_fallback",
    "_normalize_playwright_eval_result",
    "_run_playwright_intercept_x_search",
    "_run_playwright_intercept_reddit_intent",
    "_run_playwright_intercept_xhs_intent",
    "_run_playwright_intercept_bbc_intent",
    "_run_playwright_intercept_hackernews_intent",
    "_run_playwright_intercept_linkedin_intent",
    "_run_playwright_intercept_linux_do_intent",
    "_run_playwright_intercept_youtube_intent",
    "_run_playwright_intercept_weibo_intent",
    "_run_playwright_intercept_zhihu_intent",
    "_run_playwright_intercept_bilibili_intent",
    "_run_playwright_intercept_generic_intent",
]


def sync_runtime_state() -> None:
    """Propagate patched symbols on api.app back to runtime service module."""
    for name in _RUNTIME_PATCHABLE_NAMES:
        if name in globals():
            setattr(runtime, name, globals()[name])


app = FastAPI(title="Oak Gather Service", lifespan=runtime._app_lifespan)

from api.routes.auth import router as auth_router  # noqa: E402
from api.routes.catalog import router as catalog_router  # noqa: E402
from api.routes.fetch import router as fetch_router  # noqa: E402
from api.routes.system import router as system_router  # noqa: E402

app.include_router(system_router)
app.include_router(auth_router)
app.include_router(fetch_router)
app.include_router(catalog_router)


if __name__ == "__main__":
    import uvicorn

    host = runtime.os.getenv("GATHER_HOST", "0.0.0.0")
    port = int(runtime.os.getenv("GATHER_PORT", "8000"))
    reload = runtime.os.getenv("GATHER_RELOAD", "false").lower() == "true"
    reload_excludes: list[str] = []
    if runtime._API_IO_LOG_ENABLED:
        reload_excludes.append(str(runtime._API_IO_LOG_DIR))

    print(f"[gather] Starting service on {host}:{port} (reload={reload})")
    if reload_excludes:
        print(f"[gather] reload excludes: {', '.join(reload_excludes)}")
    uvicorn.run(
        "api.app:app",
        host=host,
        port=port,
        reload=reload,
        reload_excludes=reload_excludes,
    )
