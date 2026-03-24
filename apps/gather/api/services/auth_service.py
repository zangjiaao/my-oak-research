from fastapi import UploadFile

from api.services import runtime_service as runtime
from schemas import DeleteAuthStateRequest, SaveAuthStateRequest, VerifyAuthRequest


async def verify_auth(request: VerifyAuthRequest):
    return await runtime.verify_auth(request)


async def save_auth_state_file(request: SaveAuthStateRequest):
    return await runtime.save_auth_state_file(request)


async def delete_auth_state_file(request: DeleteAuthStateRequest):
    return await runtime.delete_auth_state_file(request)


async def upload_profile(file: UploadFile, profile_name: str, platform: str):
    return await runtime.upload_profile(file=file, profile_name=profile_name, platform=platform)


async def delete_profile(profile_name: str):
    return await runtime.delete_profile(profile_name)
