from fastapi import APIRouter

from api.services import system_service

router = APIRouter()


@router.get("/")
async def root():
    from api import app as app_module

    app_module.sync_runtime_state()
    return await system_service.root_status()
