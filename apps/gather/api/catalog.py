from fastapi import APIRouter

from core.catalog import list_scripts_catalog as _list_scripts_catalog

router = APIRouter()


@router.get("/v1/scripts/catalog")
async def list_scripts_catalog():
    return await _list_scripts_catalog()
