"""Oak Gather API entrypoint."""

import os

from fastapi import FastAPI

from api.auth import router as auth_router
from api.catalog import router as catalog_router
from api.fetch import router as fetch_router
from api.system import router as system_router
from core.browser_pool import app_lifespan
from core.config import API_IO_LOG_DIR, API_IO_LOG_ENABLED

app = FastAPI(title="Oak Gather Service", lifespan=app_lifespan)

app.include_router(system_router)
app.include_router(auth_router)
app.include_router(fetch_router)
app.include_router(catalog_router)


if __name__ == "__main__":
    import uvicorn

    host = os.getenv("GATHER_HOST", "0.0.0.0")
    port = int(os.getenv("GATHER_PORT", "8000"))
    reload = os.getenv("GATHER_RELOAD", "false").lower() == "true"
    reload_excludes: list[str] = []
    if API_IO_LOG_ENABLED:
        reload_excludes.append(str(API_IO_LOG_DIR))

    uvicorn.run(
        "app:app",
        host=host,
        port=port,
        reload=reload,
        reload_excludes=reload_excludes or None,
        log_level="info",
    )
