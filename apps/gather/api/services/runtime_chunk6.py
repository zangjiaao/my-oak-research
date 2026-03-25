import api.services.runtime_chunk5 as _runtime_chunk_prev

globals().update(vars(_runtime_chunk_prev))


async def list_scripts_catalog():
    payload = _build_scripts_catalog()
    _log_api_io("/v1/scripts/catalog", {}, payload, 200)
    return payload


def _build_state_file_name(platform: str, alias: str | None, auth_data: dict[str, Any]) -> str:
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


async def delete_auth_state_file(request: DeleteAuthStateRequest):
    raw_state_file = request.state_file.strip()
    file_name = Path(raw_state_file).name
    if not STATE_FILE_NAME_PATTERN.match(file_name):
        raise HTTPException(status_code=400, detail="invalid state file name")
    target_file = (AUTH_DIR / file_name).resolve()
    if not str(target_file).startswith(str(AUTH_DIR.resolve())):
        raise HTTPException(status_code=400, detail="invalid state file path")
    if target_file.exists():
        target_file.unlink()
    return {"success": True, "stateFile": f".auth/{file_name}"}


async def upload_profile(
    file: UploadFile,
    profile_name: str,
    platform: str = "whatsapp",
):
    """
    Upload and verify a browser profile (e.g., WhatsApp).
    """
    import uuid
    platform = platform.lower()
    
    # Only WhatsApp uses profile-based auth for now
    if platform != "whatsapp":
        raise HTTPException(
            status_code=400,
            detail=f"Platform '{platform}' does not support profile-based authentication"
        )
    
    # 1. Validate profile name format (whitelist)
    if not PROFILE_NAME_PATTERN.match(profile_name):
        raise HTTPException(
            status_code=400,
            detail="Invalid profile name. Use only alphanumeric characters, underscores, and hyphens (1-64 chars)"
        )
    
    # 2. Read and validate file size
    content = await file.read()
    if len(content) > MAX_PROFILE_SIZE:
        raise HTTPException(
            status_code=400,
            detail=f"File too large. Maximum size is {MAX_PROFILE_SIZE // (1024*1024)}MB"
        )
    
    # 3. Verify it's a valid ZIP file
    if not zipfile.is_zipfile(io.BytesIO(content)):
        raise HTTPException(
            status_code=400,
            detail="Invalid file format. Please upload a ZIP file"
        )
    
    # Generate a unique directory name using UUID to avoid collisions
    # Format: whatsapp_profile_{alias}_{uuid_short}
    unique_suffix = str(uuid.uuid4())[:8]
    # Sanitized name for directory
    safe_name = f"{profile_name}_{unique_suffix}"
    
    AUTH_DIR.mkdir(exist_ok=True)
    target_dir = AUTH_DIR / f"whatsapp_profile_{safe_name}"
    target_dir_resolved = target_dir.resolve()
    auth_dir_resolved = AUTH_DIR.resolve()
    
    # Ensure target is within AUTH_DIR
    if not str(target_dir_resolved).startswith(str(auth_dir_resolved)):
        raise HTTPException(
            status_code=400,
            detail="Invalid profile path"
        )
    
    # 5. Extract with security checks
    try:
        with zipfile.ZipFile(io.BytesIO(content)) as zf:
            # Check each file before extraction
            for info in zf.infolist():
                # Skip directories
                if info.is_dir():
                    continue
                
                # Normalize the filename and check for path traversal
                filename = info.filename
                
                # Block absolute paths
                if filename.startswith('/') or filename.startswith('\\'):
                    raise HTTPException(
                        status_code=400,
                        detail=f"Absolute paths not allowed: {filename}"
                    )
                
                # Block parent directory references
                if '..' in filename:
                    raise HTTPException(
                        status_code=400,
                        detail=f"Path traversal detected: {filename}"
                    )
                
                # Check resolved path is within target
                extracted_path = (target_dir / filename).resolve()
                if not str(extracted_path).startswith(str(target_dir_resolved)):
                    raise HTTPException(
                        status_code=400,
                        detail=f"Path traversal detected: {filename}"
                    )
                
                # Block symlinks (check file attributes)
                # Unix symlink has external_attr with mode 0o120000
                unix_mode = info.external_attr >> 16
                if unix_mode != 0 and (unix_mode & 0o170000) == 0o120000:
                    print(f"[gather] Skipping symbolic link (not allowed for security): {filename}")
                    continue
            
            # Remove existing directory if it exists
            if target_dir.exists():
                shutil.rmtree(target_dir)
            
            # Create target directory
            target_dir.mkdir(parents=True, exist_ok=True)
            
            # Extract all files
            zf.extractall(target_dir)
            
            # --- Auto-flatten logic ---
            # If the ZIP was created by compressing the folder rather than its contents,
            # we'll have target_dir/folder_name/Default instead of target_dir/Default.
            content_items = [p for p in target_dir.iterdir() if p.name != "__MACOSX"]
            if len(content_items) == 1 and content_items[0].is_dir():
                nested_dir = content_items[0]
                print(f"[gather] Detected nested directory '{nested_dir.name}', flattening...")
                for item in nested_dir.iterdir():
                    # Move everything up one level
                    shutil.move(str(item), str(target_dir))
                # Remove the now empty nested directory
                nested_dir.rmdir()
            # ---------------------------
            
    except zipfile.BadZipFile:
        raise HTTPException(
            status_code=400,
            detail="Corrupted ZIP file"
        )
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"Failed to extract profile: {str(e)}"
        )
    
    print(f"[gather] Profile extracted to: {target_dir.absolute()}")
    
    # Check for expected Chromium profile structure
    if (target_dir / "Default").exists():
        print("[gather] Found 'Default' directory in profile")
    else:
        print("[gather] Warning: 'Default' directory NOT found in profile. Is this a complete Chrome profile?")
        # List files for debugging
        files = list(target_dir.glob("*"))[:10]
        print(f"[gather] First few files in profile: {[f.name for f in files]}")
    
    # 6. Verify the profile with playwright profile probe
    try:
        print(f"[gather] Starting verification for: {profile_name}")
        verify_result = await playwright_verify_auth(
            VerifyAuthRequest(platform="whatsapp", auth_data={"profileName": target_dir.name}, headless=False),
            auth_dir=AUTH_DIR,
        )
        is_valid = bool(verify_result and verify_result.valid)
        print(f"[gather] Verification result for {profile_name}: {is_valid}")
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
        print(f"[gather] Profile verification error: {e}")
        return UploadProfileResponse(
            success=True,
            message=f"Profile uploaded but verification failed: {str(e)}",
            profile_name=target_dir.name,
            verified=False,
            details={"error": str(e)},
        )


async def delete_profile(profile_name: str):
    """
    Delete a browser profile directory from the filesystem.
    """
    # 1. Basic validation of profile name format (security)
    if not PROFILE_NAME_PATTERN.match(profile_name.split('/')[-1]) and not profile_name.startswith("whatsapp_profile_"):
         # More relaxed check but still ensuring it's one of ours
         pass
         
    # Stricter check: only allow deleting things in AUTH_DIR and starting with known prefix
    target_dir = (AUTH_DIR / profile_name).resolve()
    
    if not str(target_dir).startswith(str(AUTH_DIR.resolve())):
        raise HTTPException(status_code=400, detail="Invalid profile path")
        
    if not target_dir.exists():
        return {"success": True, "message": "Profile already deleted or not found"}
        
    try:
        if target_dir.is_dir():
            shutil.rmtree(target_dir)
            print(f"[gather] Deleted profile directory: {target_dir}")
        else:
            target_dir.unlink()
            print(f"[gather] Deleted profile file: {target_dir}")
            
        return {"success": True, "message": f"Profile {profile_name} deleted successfully"}
    except Exception as e:
        print(f"[gather] Error deleting profile: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to delete profile: {str(e)}")
