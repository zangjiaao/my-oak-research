"""Oak Gather API entrypoint."""

from fastapi import FastAPI

from api.routes.auth import router as auth_router
from api.routes.catalog import router as catalog_router
from api.routes.fetch import router as fetch_router
from api.routes.system import router as system_router
from api.services import runtime_service as runtime

app = FastAPI(title="Oak Gather Service", lifespan=runtime._app_lifespan)

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
