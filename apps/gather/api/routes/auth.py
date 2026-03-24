from fastapi import APIRouter, File, Form, UploadFile

from api.services import auth_service
from schemas import (
    DeleteAuthStateRequest,
    SaveAuthStateRequest,
    SaveAuthStateResponse,
    UploadProfileResponse,
    VerifyAuthRequest,
    VerifyAuthResponse,
)

router = APIRouter()


@router.post("/v1/verify-auth", response_model=VerifyAuthResponse)
async def verify_auth(request: VerifyAuthRequest):
    from api import app as app_module

    app_module.sync_runtime_state()
    return await auth_service.verify_auth(request)


@router.post("/v1/auth/state-file", response_model=SaveAuthStateResponse)
async def save_auth_state_file(request: SaveAuthStateRequest):
    from api import app as app_module

    app_module.sync_runtime_state()
    return await auth_service.save_auth_state_file(request)


@router.delete("/v1/auth/state-file")
async def delete_auth_state_file(request: DeleteAuthStateRequest):
    from api import app as app_module

    app_module.sync_runtime_state()
    return await auth_service.delete_auth_state_file(request)


@router.post("/v1/auth/profile", response_model=UploadProfileResponse)
async def upload_profile(
    file: UploadFile = File(...),
    profile_name: str = Form(...),
    platform: str = Form(default="whatsapp"),
):
    from api import app as app_module

    app_module.sync_runtime_state()
    return await auth_service.upload_profile(file=file, profile_name=profile_name, platform=platform)


@router.delete("/v1/auth/profile/{profile_name}")
async def delete_profile(profile_name: str):
    from api import app as app_module

    app_module.sync_runtime_state()
    return await auth_service.delete_profile(profile_name)
