from fastapi import APIRouter

from api.services import system_service

router = APIRouter()


@router.get("/")
async def root():
    return await system_service.root_status()
