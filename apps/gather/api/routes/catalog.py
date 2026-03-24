from fastapi import APIRouter

from api.services import catalog_service

router = APIRouter()


@router.get("/v1/scripts/catalog")
async def list_scripts_catalog():
    from api import app as app_module

    app_module.sync_runtime_state()
    return await catalog_service.list_scripts_catalog()
