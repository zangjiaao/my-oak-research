from fastapi import APIRouter, File, Form, UploadFile

from core.fetch import verify_auth as _verify_auth
from core.profile import (
    delete_auth_state_file as _delete_auth_state_file,
    delete_profile as _delete_profile,
    save_auth_state_file as _save_auth_state_file,
    upload_profile as _upload_profile,
)
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
    return await _verify_auth(request)


@router.post("/v1/auth/state-file", response_model=SaveAuthStateResponse)
async def save_auth_state_file(request: SaveAuthStateRequest):
    return await _save_auth_state_file(request)


@router.delete("/v1/auth/state-file")
async def delete_auth_state_file(request: DeleteAuthStateRequest):
    return await _delete_auth_state_file(request)


@router.post("/v1/auth/profile", response_model=UploadProfileResponse)
async def upload_profile(
    file: UploadFile = File(...),
    profile_name: str = Form(...),
    platform: str = Form(default="whatsapp"),
):
    return await _upload_profile(file=file, profile_name=profile_name, platform=platform)


@router.delete("/v1/auth/profile/{profile_name}")
async def delete_profile(profile_name: str):
    return await _delete_profile(profile_name)
