"""Auth-state file and browser-profile management."""

import hashlib
import io
import json
import logging
import re
import shutil
import zipfile
from typing import Any

from fastapi import HTTPException, UploadFile

from core.config import (
    AUTH_DIR,
    MAX_PROFILE_SIZE,
    PROFILE_NAME_PATTERN,
    STATE_FILE_NAME_PATTERN,
)
from libs.auth_verify import playwright_verify_auth
from schemas import (
    SaveAuthStateRequest,
    SaveAuthStateResponse,
    UploadProfileResponse,
    VerifyAuthRequest,
)

logger = logging.getLogger("gather")


# ---------------------------------------------------------------------------
# State files
# ---------------------------------------------------------------------------

def _build_state_file_name(
    platform: str, alias: str | None, auth_data: dict[str, Any]
) -> str:
    normalized_platform = re.sub(r"[^a-z0-9_-]+", "-", platform.lower()).strip("-") or "social"
    normalized_alias = re.sub(r"[^a-z0-9_-]+", "-", (alias or "default").lower()).strip("-") or "default"
    payload_hash = hashlib.sha256(
        json.dumps(auth_data, ensure_ascii=False, sort_keys=True).encode("utf-8")
    ).hexdigest()[:12]
    return f"{normalized_platform}_{normalized_alias}_{payload_hash}.json"


def _validate_auth_data_shape(auth_data: dict[str, Any]) -> None:
    cookies = auth_data.get("cookies")
    origins = auth_data.get("origins")
    has_cookies = isinstance(cookies, list) and len(cookies) > 0
    has_origins = isinstance(origins, list) and len(origins) > 0
    if not has_cookies and not has_origins:
        raise HTTPException(
            status_code=400,
            detail="auth_data must contain cookies or origins",
        )


async def save_auth_state_file(request: SaveAuthStateRequest):
    auth_data = request.auth_data
    if not isinstance(auth_data, dict):
        raise HTTPException(status_code=400, detail="auth_data must be an object")
    _validate_auth_data_shape(auth_data)

    AUTH_DIR.mkdir(exist_ok=True)
    file_name = _build_state_file_name(request.platform, request.name, auth_data)
    if not STATE_FILE_NAME_PATTERN.match(file_name):
        raise HTTPException(status_code=400, detail="invalid state file name")
    target_file = (AUTH_DIR / file_name).resolve()
    if not str(target_file).startswith(str(AUTH_DIR.resolve())):
        raise HTTPException(status_code=400, detail="invalid state file path")

    with target_file.open("w", encoding="utf-8") as fp:
        json.dump(auth_data, fp, ensure_ascii=False)

    return SaveAuthStateResponse(
        success=True,
        stateFile=f".auth/{file_name}",
        profileName=file_name,
    )


async def delete_auth_state_file(request):
    raw_state_file = request.state_file.strip()
    from pathlib import Path

    file_name = Path(raw_state_file).name
    if not STATE_FILE_NAME_PATTERN.match(file_name):
        raise HTTPException(status_code=400, detail="invalid state file name")
    target_file = (AUTH_DIR / file_name).resolve()
    if not str(target_file).startswith(str(AUTH_DIR.resolve())):
        raise HTTPException(status_code=400, detail="invalid state file path")
    if target_file.exists():
        target_file.unlink()
    return {"success": True, "stateFile": f".auth/{file_name}"}


# ---------------------------------------------------------------------------
# Browser profiles
# ---------------------------------------------------------------------------

async def upload_profile(
    file: UploadFile,
    profile_name: str,
    platform: str = "whatsapp",
):
    import uuid

    platform = platform.lower()

    if platform != "whatsapp":
        raise HTTPException(
            status_code=400,
            detail=f"Platform '{platform}' does not support profile-based authentication",
        )

    if not PROFILE_NAME_PATTERN.match(profile_name):
        raise HTTPException(
            status_code=400,
            detail="Invalid profile name. Use only alphanumeric characters, underscores, and hyphens (1-64 chars)",
        )

    content = await file.read()
    if len(content) > MAX_PROFILE_SIZE:
        raise HTTPException(
            status_code=400,
            detail=f"File too large. Maximum size is {MAX_PROFILE_SIZE // (1024 * 1024)}MB",
        )

    if not zipfile.is_zipfile(io.BytesIO(content)):
        raise HTTPException(
            status_code=400,
            detail="Invalid file format. Please upload a ZIP file",
        )

    unique_suffix = str(uuid.uuid4())[:8]
    safe_name = f"{profile_name}_{unique_suffix}"

    AUTH_DIR.mkdir(exist_ok=True)
    target_dir = AUTH_DIR / f"whatsapp_profile_{safe_name}"
    target_dir_resolved = target_dir.resolve()
    auth_dir_resolved = AUTH_DIR.resolve()

    if not str(target_dir_resolved).startswith(str(auth_dir_resolved)):
        raise HTTPException(status_code=400, detail="Invalid profile path")

    try:
        with zipfile.ZipFile(io.BytesIO(content)) as zf:
            for info in zf.infolist():
                if info.is_dir():
                    continue
                filename = info.filename
                if filename.startswith("/") or filename.startswith("\\"):
                    raise HTTPException(status_code=400, detail=f"Absolute paths not allowed: {filename}")
                if ".." in filename:
                    raise HTTPException(status_code=400, detail=f"Path traversal detected: {filename}")
                extracted_path = (target_dir / filename).resolve()
                if not str(extracted_path).startswith(str(target_dir_resolved)):
                    raise HTTPException(status_code=400, detail=f"Path traversal detected: {filename}")
                unix_mode = info.external_attr >> 16
                if unix_mode != 0 and (unix_mode & 0o170000) == 0o120000:
                    logger.debug("skipping symbolic link: %s", filename)
                    continue

            if target_dir.exists():
                shutil.rmtree(target_dir)
            target_dir.mkdir(parents=True, exist_ok=True)
            zf.extractall(target_dir)

            content_items = [p for p in target_dir.iterdir() if p.name != "__MACOSX"]
            if len(content_items) == 1 and content_items[0].is_dir():
                nested_dir = content_items[0]
                logger.debug("detected nested directory '%s', flattening", nested_dir.name)
                for item in nested_dir.iterdir():
                    shutil.move(str(item), str(target_dir))
                nested_dir.rmdir()

    except zipfile.BadZipFile:
        raise HTTPException(status_code=400, detail="Corrupted ZIP file")
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to extract profile: {str(e)}")

    logger.debug("profile extracted to: %s", target_dir.absolute())

    if (target_dir / "Default").exists():
        logger.debug("found 'Default' directory in profile")
    else:
        logger.warning("'Default' directory NOT found in profile — may be incomplete")
        files = list(target_dir.glob("*"))[:10]
        logger.debug("first few files in profile: %s", [f.name for f in files])

    try:
        logger.debug("starting verification for: %s", profile_name)
        verify_result = await playwright_verify_auth(
            VerifyAuthRequest(
                platform="whatsapp",
                auth_data={"profileName": target_dir.name},
                headless=False,
            ),
            auth_dir=AUTH_DIR,
        )
        is_valid = bool(verify_result and verify_result.valid)
        logger.debug("verification result for %s: %s", profile_name, is_valid)
        if is_valid:
            return UploadProfileResponse(
                success=True,
                message="Profile uploaded and verified successfully",
                profile_name=target_dir.name,
                verified=True,
                details={"platform": "WhatsApp", "auth_type": "profile"},
            )
        return UploadProfileResponse(
            success=True,
            message="Profile uploaded but authentication is invalid or expired",
            profile_name=target_dir.name,
            verified=False,
            details={"platform": "WhatsApp", "suggestion": "Please re-export the profile after logging in"},
        )
    except Exception as e:
        logger.error("profile verification error: %s", e)
        return UploadProfileResponse(
            success=True,
            message=f"Profile uploaded but verification failed: {str(e)}",
            profile_name=target_dir.name,
            verified=False,
            details={"error": str(e)},
        )


async def delete_profile(profile_name: str):
    if not PROFILE_NAME_PATTERN.match(profile_name.split("/")[-1]) and not profile_name.startswith("whatsapp_profile_"):
        pass

    target_dir = (AUTH_DIR / profile_name).resolve()

    if not str(target_dir).startswith(str(AUTH_DIR.resolve())):
        raise HTTPException(status_code=400, detail="Invalid profile path")

    if not target_dir.exists():
        return {"success": True, "message": "Profile already deleted or not found"}

    try:
        if target_dir.is_dir():
            shutil.rmtree(target_dir)
            logger.debug("deleted profile directory: %s", target_dir)
        else:
            target_dir.unlink()
            logger.debug("deleted profile file: %s", target_dir)

        return {"success": True, "message": f"Profile {profile_name} deleted successfully"}
    except Exception as e:
        logger.error("error deleting profile: %s", e)
        raise HTTPException(status_code=500, detail=f"Failed to delete profile: {str(e)}")
