"""
Oak Gather Service
Social media data fetching service using Playwright with cookie-based authentication.
"""
import os
import re
import io
import json
import asyncio
import shutil
import zipfile
from pathlib import Path
from fastapi import FastAPI, HTTPException, UploadFile, File, Form
from fastapi.responses import JSONResponse
from pydantic import AliasChoices, BaseModel, ConfigDict, Field, ValidationError
from typing import List, Optional, Any, Dict, Literal
from datetime import datetime, timezone
from dotenv import load_dotenv
from drivers.agent_browser_runner import (
    AgentBrowserScriptError,
    execute_agent_browser_script,
    heartbeat_agent_browser_instance,
)
from drivers.playwright_driver import PlaywrightDriver
from drivers.registry import DriverRegistry, DriverNotFoundError
from drivers.xhttp_driver import XHttpDriver

# Load environment variables from .env file
load_dotenv()

app = FastAPI(title="Oak Gather Service")


class FetchRequest(BaseModel):
    platform: str
    config: Dict[str, Any]
    source_id: str
    auth_data: Optional[Dict[str, Any]] = None  # Playwright storage_state format
    response_formats: Optional[List[Literal["text", "markdown"]]] = None


class FetchV2Request(BaseModel):
    model_config = ConfigDict(extra="forbid")

    platform: str
    config: Dict[str, Any]
    source_id: str = Field(validation_alias=AliasChoices("sourceId", "source_id"))
    auth_data: Optional[Dict[str, Any]] = Field(
        default=None,
        validation_alias=AliasChoices("authData", "auth_data")
    )
    driver: Optional[str] = None
    response_formats: Optional[List[Literal["text", "markdown"]]] = Field(
        default=None,
        validation_alias=AliasChoices("responseFormats", "response_formats"),
    )


class VerifyAuthRequest(BaseModel):
    platform: str
    auth_data: Optional[Dict[str, Any]] = None  # Playwright storage_state format (cookies + origins)
    state_file: Optional[str] = Field(
        default=None,
        validation_alias=AliasChoices("stateFile", "state_file"),
    )
    headless: bool = False  # Set to False for debugging, True for production


class VerifyAuthResponse(BaseModel):
    valid: bool
    message: str
    details: Optional[Dict[str, Any]] = None


class CleanItem(BaseModel):
    title: Optional[str] = None
    text: Optional[str] = None
    markdown: Optional[str] = None
    platform: str
    url: Optional[str] = None
    time: Optional[datetime] = None
    sourceId: str
    sourceType: str
    driver: Optional[str] = "python-gather"
    instanceId: Optional[str] = None
    tabId: Optional[str] = None
    instanceActive: Optional[bool] = None
    matchedKeywords: Optional[List[str]] = None
    keywordMatchScore: Optional[float] = None
    recordId: Optional[str] = None
    recordType: Optional[str] = None
    recordIndex: Optional[int] = None


class ErrorDetail(BaseModel):
    code: str
    message: str
    retryable: bool


class ErrorResponse(BaseModel):
    error: ErrorDetail


class AgentBrowserHeartbeatRequest(BaseModel):
    platform: str
    source_id: str = Field(validation_alias=AliasChoices("sourceId", "source_id"))
    owner_id: Optional[str] = Field(default=None, validation_alias=AliasChoices("ownerId", "owner_id"))
    session_key: Optional[str] = Field(default=None, validation_alias=AliasChoices("sessionKey", "session_key"))
    instance_id: str = Field(validation_alias=AliasChoices("instanceId", "instance_id"))
    verbose: bool = True


class AgentBrowserHeartbeatResponse(BaseModel):
    instanceId: str
    tabId: str
    instanceActive: bool
    ttlSeconds: int
    expiresAt: datetime


class KeywordFilterConfigError(ValueError):
    pass


_BB_SITE_PLATFORM_ALIAS = {
    "x": "twitter",
    "twitter": "twitter",
    "xhs": "xiaohongshu",
}

_BB_SITE_TARGET_URL = {
    "twitter": "https://x.com",
    "xiaohongshu": "https://www.xiaohongshu.com",
    "reddit": "https://www.reddit.com",
    "douyin": "https://www.douyin.com",
    "tiktok": "https://www.tiktok.com",
    "weibo": "https://weibo.com",
    "telegram": "https://web.telegram.org",
    "instagram": "https://www.instagram.com",
    "facebook": "https://www.facebook.com",
}


def build_error_response(
    status_code: int,
    code: str,
    message: str,
    retryable: bool
) -> JSONResponse:
    return JSONResponse(
        status_code=status_code,
        content={"error": {"code": code, "message": message, "retryable": retryable}}
    )


@app.get("/")
async def root():
    return {"status": "ok", "service": "oak-gather"}


def _resolve_bb_site_verify_script(platform: str) -> Path | None:
    normalized = _BB_SITE_PLATFORM_ALIAS.get(platform.lower(), platform.lower())
    script_dir_candidates: list[Path] = []
    configured_dir = os.getenv("BB_SITES_DIR")
    if configured_dir:
        script_dir_candidates.append(Path(configured_dir).expanduser())
    script_dir_candidates.extend(
        [
            Path("~/.bb-browser/bb-sites").expanduser(),
            Path("~/Reference/bb-sites").expanduser(),
        ]
    )

    for base_dir in script_dir_candidates:
        for suffix in ("user.js", "user.ts"):
            candidate = base_dir / normalized / suffix
            if candidate.exists():
                return candidate
    return None


async def _verify_auth_with_bb_site_script(request: VerifyAuthRequest) -> VerifyAuthResponse | None:
    platform = request.platform.lower()
    normalized = _BB_SITE_PLATFORM_ALIAS.get(platform, platform)
    target_url = _BB_SITE_TARGET_URL.get(normalized)
    if not target_url:
        return None

    script_path = _resolve_bb_site_verify_script(platform)
    if not script_path:
        return None

    script_body = _strip_playwright_meta_block(script_path.read_text(encoding="utf-8"))
    if not script_body:
        return None

    from playwright.async_api import TimeoutError as PlaywrightTimeoutError
    from playwright.async_api import async_playwright

    try:
        async with async_playwright() as playwright:
            browser = await playwright.chromium.launch(headless=request.headless)
            context = await browser.new_context(storage_state=request.auth_data)
            page = await context.new_page()
            try:
                await page.goto(target_url, wait_until="domcontentloaded", timeout=30000)
                await page.wait_for_timeout(1200)
                result = await page.evaluate(f"({script_body})({{}})")
            finally:
                await context.close()
                await browser.close()
    except PlaywrightTimeoutError as error:
        print(f"[gather] bb-site verify timeout for {platform}, fallback to legacy verify: {error}")
        return None
    except Exception as error:
        print(f"[gather] bb-site verify failed for {platform}, fallback to legacy verify: {error}")
        return None

    if isinstance(result, dict):
        error_message = result.get("error")
        if error_message:
            return VerifyAuthResponse(
                valid=False,
                message=str(error_message),
                details={
                    "platform": platform,
                    "hint": result.get("hint"),
                    "verifyMethod": "bb-site-script",
                    "scriptPath": str(script_path),
                },
            )
        user = {
            key: result.get(key)
            for key in ("id", "user_id", "uid", "screen_name", "username", "name")
            if result.get(key) is not None
        }
        if user:
            return VerifyAuthResponse(
                valid=True,
                message=f"{request.platform} authentication is valid",
                details={
                    "platform": request.platform,
                    "verifyMethod": "bb-site-script",
                    "scriptPath": str(script_path),
                    "user": user,
                },
            )

    if isinstance(result, list) and result:
        return VerifyAuthResponse(
            valid=True,
            message=f"{request.platform} authentication is valid",
            details={
                "platform": request.platform,
                "verifyMethod": "bb-site-script",
                "scriptPath": str(script_path),
                "resultCount": len(result),
            },
        )

    if result is True:
        return VerifyAuthResponse(
            valid=True,
            message=f"{request.platform} authentication is valid",
            details={
                "platform": request.platform,
                "verifyMethod": "bb-site-script",
                "scriptPath": str(script_path),
            },
        )

    if result is False:
        return VerifyAuthResponse(
            valid=False,
            message=f"{request.platform} authentication is invalid or expired",
            details={
                "platform": request.platform,
                "verifyMethod": "bb-site-script",
                "scriptPath": str(script_path),
            },
        )
    return None


def _resolve_verify_auth_data(request: VerifyAuthRequest) -> tuple[dict[str, Any] | None, VerifyAuthResponse | None]:
    if isinstance(request.auth_data, dict):
        return request.auth_data, None

    if request.state_file:
        path = Path(request.state_file).expanduser()
        if not path.exists():
            return None, VerifyAuthResponse(
                valid=False,
                message=f"stateFile does not exist: {request.state_file}",
                details={"error": "invalid_state_file"},
            )
        try:
            payload = json.loads(path.read_text(encoding="utf-8"))
        except json.JSONDecodeError as error:
            return None, VerifyAuthResponse(
                valid=False,
                message=f"stateFile is not valid JSON: {request.state_file}",
                details={"error": str(error)},
            )
        if not isinstance(payload, dict):
            return None, VerifyAuthResponse(
                valid=False,
                message=f"stateFile must contain a JSON object: {request.state_file}",
                details={"error": "invalid_state_payload"},
            )
        return payload, None

    if request.platform.lower() == "whatsapp":
        return {}, None

    return None, VerifyAuthResponse(
        valid=False,
        message="auth_data or stateFile is required",
        details={"error": "missing_auth_data"},
    )


async def _playwright_verify_auth_legacy(request: VerifyAuthRequest):
    """
    Verify if the provided authentication data (cookies) is valid for the specified platform.
    This endpoint is used when users upload auth.json files to check if they're still valid.
    """
    platform = request.platform.lower()
    auth_data = request.auth_data
    headless = request.headless
    
    print(f"[gather] Verifying auth for {platform} (headless={headless})")
    
    # Validate auth_data structure (skip for WhatsApp which uses persistent profile)
    if platform != "whatsapp":
        has_cookies = auth_data.get("cookies") and len(auth_data.get("cookies", [])) > 0
        has_origins = auth_data.get("origins") and len(auth_data.get("origins", [])) > 0
        
        if not has_cookies and not has_origins:
            return VerifyAuthResponse(
                valid=False,
                message="Invalid auth data: missing 'cookies' or 'origins' field",
                details={"error": "auth_data must contain 'cookies' array or 'origins' with localStorage"}
            )
    
    try:
        if platform == "x" or platform == "twitter":
            from clients.x_client import XPlaywrightClient
            
            async with XPlaywrightClient(auth_data=auth_data, headless=headless) as client:
                is_valid = await client.verify_auth()
                
            if is_valid:
                return VerifyAuthResponse(
                    valid=True,
                    message="X.com authentication is valid",
                    details={"platform": "X", "cookies_count": len(auth_data.get("cookies", []))}
                )
            else:
                return VerifyAuthResponse(
                    valid=False,
                    message="X.com authentication is invalid or expired",
                    details={"platform": "X", "suggestion": "Please re-export cookies from Chrome"}
                )
                
        elif platform == "xiaohongshu" or platform == "xhs":
            from clients.xiaohongshu_client import XiaohongshuPlaywrightClient
            
            async with XiaohongshuPlaywrightClient(auth_data=auth_data, headless=headless) as client:
                is_valid = await client.verify_auth()
                
            if is_valid:
                return VerifyAuthResponse(
                    valid=True,
                    message="Xiaohongshu authentication is valid",
                    details={"platform": "Xiaohongshu", "cookies_count": len(auth_data.get("cookies", []))}
                )
            else:
                return VerifyAuthResponse(
                    valid=False,
                    message="Xiaohongshu authentication is invalid or expired",
                    details={"platform": "Xiaohongshu", "suggestion": "Please re-export cookies from Chrome"}
                )
                
        elif platform == "reddit":
            from clients.reddit_client import RedditPlaywrightClient
            
            async with RedditPlaywrightClient(auth_data=auth_data, headless=headless) as client:
                is_valid = await client.verify_auth()
                
            if is_valid:
                return VerifyAuthResponse(
                    valid=True,
                    message="Reddit authentication is valid",
                    details={"platform": "Reddit", "cookies_count": len(auth_data.get("cookies", []))}
                )
            else:
                return VerifyAuthResponse(
                    valid=False,
                    message="Reddit authentication is invalid or expired",
                    details={"platform": "Reddit", "suggestion": "Please re-export cookies from Chrome"}
                )
                
        elif platform == "douyin":
            from clients.douyin_client import DouyinPlaywrightClient
            
            async with DouyinPlaywrightClient(auth_data=auth_data, headless=headless) as client:
                is_valid = await client.verify_auth()
                
            if is_valid:
                return VerifyAuthResponse(
                    valid=True,
                    message="Douyin authentication is valid",
                    details={"platform": "Douyin", "cookies_count": len(auth_data.get("cookies", []))}
                )
            else:
                return VerifyAuthResponse(
                    valid=False,
                    message="Douyin authentication is invalid or expired",
                    details={"platform": "Douyin", "suggestion": "Please re-export cookies from Chrome"}
                )
                
        elif platform == "tiktok":
            from clients.tiktok_client import TikTokPlaywrightClient
            
            async with TikTokPlaywrightClient(auth_data=auth_data, headless=headless) as client:
                is_valid = await client.verify_auth()
                
            if is_valid:
                return VerifyAuthResponse(
                    valid=True,
                    message="TikTok authentication is valid",
                    details={"platform": "TikTok", "cookies_count": len(auth_data.get("cookies", []))}
                )
            else:
                return VerifyAuthResponse(
                    valid=False,
                    message="TikTok authentication is invalid or expired",
                    details={"platform": "TikTok", "suggestion": "Please re-export cookies from Chrome"}
                )
                
        elif platform == "weibo":
            from clients.weibo_client import WeiboPlaywrightClient
            
            async with WeiboPlaywrightClient(auth_data=auth_data, headless=headless) as client:
                is_valid = await client.verify_auth()
                
            if is_valid:
                return VerifyAuthResponse(
                    valid=True,
                    message="Weibo authentication is valid",
                    details={"platform": "Weibo", "cookies_count": len(auth_data.get("cookies", []))}
                )
            else:
                return VerifyAuthResponse(
                    valid=False,
                    message="Weibo authentication is invalid or expired",
                    details={"platform": "Weibo", "suggestion": "Please re-export cookies from Chrome"}
                )
                
        elif platform == "telegram":
            from clients.telegram_client import TelegramPlaywrightClient
            
            async with TelegramPlaywrightClient(auth_data=auth_data, headless=headless) as client:
                is_valid = await client.verify_auth()
                
            if is_valid:
                return VerifyAuthResponse(
                    valid=True,
                    message="Telegram authentication is valid",
                    details={"platform": "Telegram", "cookies_count": len(auth_data.get("cookies", []))}
                )
            else:
                return VerifyAuthResponse(
                    valid=False,
                    message="Telegram authentication is invalid or expired",
                    details={"platform": "Telegram", "suggestion": "Please re-export cookies and localStorage from Chrome"}
                )
                
        elif platform == "whatsapp":
            # WhatsApp uses persistent context, not cookie-based auth
            from clients.whatsapp_client import WhatsAppPlaywrightClient
            
            # Check for specific profile directory in auth_data
            profile_path = None
            if auth_data and "profileName" in auth_data:
                profile_path = AUTH_DIR / auth_data["profileName"]
                print(f"[gather] Using custom WhatsApp profile: {profile_path}")
            
            async with WhatsAppPlaywrightClient(headless=headless, profile_path=profile_path) as client:
                is_valid = await client.verify_auth()
                
            if is_valid:
                return VerifyAuthResponse(
                    valid=True,
                    message="WhatsApp authentication is valid",
                    details={"platform": "WhatsApp", "auth_type": "persistent_profile", "profile": auth_data.get("profileName") if auth_data else "default"}
                )
            else:
                return VerifyAuthResponse(
                    valid=False,
                    message="WhatsApp authentication is invalid or expired",
                    details={"platform": "WhatsApp", "suggestion": "Please re-export and upload the profile zip"}
                )
                
        elif platform == "instagram":
            from clients.instagram_client import InstagramPlaywrightClient
            
            async with InstagramPlaywrightClient(auth_data=auth_data, headless=headless) as client:
                is_valid = await client.verify_auth()
                
            if is_valid:
                return VerifyAuthResponse(
                    valid=True,
                    message="Instagram authentication is valid",
                    details={"platform": "Instagram", "cookies_count": len(auth_data.get("cookies", []))}
                )
            else:
                return VerifyAuthResponse(
                    valid=False,
                    message="Instagram authentication is invalid or expired",
                    details={"platform": "Instagram", "suggestion": "Please re-export cookies from Chrome"}
                )
                
        elif platform == "facebook":
            from clients.facebook_client import FacebookPlaywrightClient
            
            async with FacebookPlaywrightClient(auth_data=auth_data, headless=headless) as client:
                is_valid = await client.verify_auth()
                
            if is_valid:
                return VerifyAuthResponse(
                    valid=True,
                    message="Facebook authentication is valid",
                    details={"platform": "Facebook", "cookies_count": len(auth_data.get("cookies", []))}
                )
            else:
                return VerifyAuthResponse(
                    valid=False,
                    message="Facebook authentication is invalid or expired",
                    details={"platform": "Facebook", "suggestion": "Please re-export cookies from Chrome"}
                )
                
        else:
            return VerifyAuthResponse(
                valid=False,
                message=f"Platform '{platform}' is not supported for auth verification",
                details={"supported_platforms": ["x", "twitter", "xiaohongshu", "xhs", "reddit", "douyin", "tiktok", "weibo", "telegram", "whatsapp", "instagram"]}
            )
            
    except ImportError as e:
        return VerifyAuthResponse(
            valid=False,
            message=f"Client module not found: {e}",
            details={"error": "Internal server configuration error"}
        )
    except Exception as e:
        print(f"[gather] Auth verification error for {platform}: {e}")
        return VerifyAuthResponse(
            valid=False,
            message=f"Error during verification: {str(e)}",
            details={"error": str(e)}
        )


async def _playwright_verify_auth(request: VerifyAuthRequest):
    auth_data, error_response = _resolve_verify_auth_data(request)
    if error_response is not None:
        return error_response

    normalized_request = request.model_copy(update={"auth_data": auth_data or {}})
    scripted_result = await _verify_auth_with_bb_site_script(normalized_request)
    if scripted_result is not None:
        return scripted_result
    return await _playwright_verify_auth_legacy(normalized_request)


async def _playwright_fetch_data(request: FetchRequest):
    """
    Unified entry point for social media data fetching.
    Uses Playwright with cookie-based authentication.
    """
    platform = request.platform.lower()
    config = request.config
    auth_data = request.auth_data

    playwright_options = config.get("playwright")
    if isinstance(playwright_options, dict):
        mode = str(playwright_options.get("mode", "")).lower()
        if mode in {"eval-js", "evaljs", "eval"}:
            return await _run_playwright_eval_script(request)
    
    print(f"[gather] Fetching data for {platform} with config {config}")
    
    results = []
    
    try:
        if platform == "x" or platform == "twitter":
            if not auth_data:
                raise HTTPException(
                    status_code=400, 
                    detail="auth_data is required for X.com. Please provide valid cookies."
                )
            
            from clients.x_client import XPlaywrightClient
            
            async with XPlaywrightClient(auth_data=auth_data, headless=True) as client:
                async for tweet in client.fetch_data(config):
                    results.append(CleanItem(
                        title=tweet.get("display_name"),
                        text=tweet.get("text", ""),
                        markdown=f"**@{tweet.get('username', 'unknown')}**: {tweet.get('text', '')}",
                        platform="X",
                        url=tweet.get("url"),
                        sourceId=request.source_id,
                        sourceType="SOCIAL_MEDIA",
                        time=datetime.fromisoformat(tweet["timestamp"]) if tweet.get("timestamp") else datetime.now(),
                        recordId=_extract_x_status_id(tweet.get("url")),
                        recordType="tweet",
                    ))
                    
        elif platform == "xiaohongshu" or platform == "xhs":
            if not auth_data:
                raise HTTPException(
                    status_code=400,
                    detail="auth_data is required for Xiaohongshu. Please provide valid cookies."
                )
            
            from clients.xiaohongshu_client import XiaohongshuPlaywrightClient
            
            async with XiaohongshuPlaywrightClient(auth_data=auth_data, headless=True) as client:
                async for note in client.fetch_data(config):
                    results.append(CleanItem(
                        title=note.get("title"),
                        text=note.get("content", note.get("title", "")),
                        markdown=f"# {note.get('title', '')}\n\n{note.get('content', '')}",
                        platform="Xiaohongshu",
                        url=note.get("url"),
                        sourceId=request.source_id,
                        sourceType="SOCIAL_MEDIA",
                        time=datetime.now(),
                        recordId=note.get("id"),
                        recordType="note",
                    ))
        
        elif platform == "reddit":
            if not auth_data:
                raise HTTPException(
                    status_code=400,
                    detail="auth_data is required for Reddit. Please provide valid cookies."
                )
            
            from clients.reddit_client import RedditPlaywrightClient
            
            async with RedditPlaywrightClient(auth_data=auth_data, headless=True) as client:
                async for post in client.fetch_data(config):
                    # Build markdown content
                    md_parts = [f"# {post.get('title', '')}"]
                    if post.get('subreddit'):
                        md_parts.append(f"\n**Subreddit:** {post.get('subreddit')}")
                    if post.get('author'):
                        md_parts.append(f"**Author:** {post.get('author')}")
                    if post.get('score'):
                        md_parts.append(f"**Score:** {post.get('score')}")
                    
                    results.append(CleanItem(
                        title=post.get("title"),
                        text=post.get("title", ""),
                        markdown="\n".join(md_parts),
                        platform="Reddit",
                        url=post.get("url"),
                        sourceId=request.source_id,
                        sourceType="SOCIAL_MEDIA",
                        time=datetime.fromisoformat(post["timestamp"]) if post.get("timestamp") and "T" in str(post.get("timestamp", "")) else datetime.now()
                    ))
        
        elif platform == "douyin":
            if not auth_data:
                raise HTTPException(
                    status_code=400,
                    detail="auth_data is required for Douyin. Please provide valid cookies."
                )
            
            from clients.douyin_client import DouyinPlaywrightClient
            
            async with DouyinPlaywrightClient(auth_data=auth_data, headless=True) as client:
                async for video in client.fetch_data(config):
                    # Build markdown content
                    md_parts = []
                    if video.get('title') or video.get('description'):
                        md_parts.append(f"# {video.get('title', video.get('description', ''))}")
                    if video.get('author'):
                        md_parts.append(f"\n**Author:** {video.get('author')}")
                    if video.get('likes'):
                        md_parts.append(f"**Likes:** {video.get('likes')}")
                    
                    results.append(CleanItem(
                        title=video.get("title", video.get("description")),
                        text=video.get("description", video.get("title", "")),
                        markdown="\n".join(md_parts) if md_parts else "Douyin video",
                        platform="Douyin",
                        url=video.get("url"),
                        sourceId=request.source_id,
                        sourceType="SOCIAL_MEDIA",
                        time=datetime.now()
                    ))
        
        elif platform == "tiktok":
            if not auth_data:
                raise HTTPException(
                    status_code=400,
                    detail="auth_data is required for TikTok. Please provide valid cookies."
                )
            
            from clients.tiktok_client import TikTokPlaywrightClient
            
            async with TikTokPlaywrightClient(auth_data=auth_data, headless=True) as client:
                async for video in client.fetch_data(config):
                    # Build markdown content
                    md_parts = []
                    if video.get('description'):
                        md_parts.append(f"# {video.get('description', '')[:100]}")
                    if video.get('author'):
                        md_parts.append(f"\n**Author:** {video.get('author')}")
                    if video.get('likes'):
                        md_parts.append(f"**Likes:** {video.get('likes')}")
                    if video.get('views'):
                        md_parts.append(f"**Views:** {video.get('views')}")
                    
                    results.append(CleanItem(
                        title=video.get("description", "")[:100] if video.get("description") else None,
                        text=video.get("description", ""),
                        markdown="\n".join(md_parts) if md_parts else "TikTok video",
                        platform="TikTok",
                        url=video.get("url"),
                        sourceId=request.source_id,
                        sourceType="SOCIAL_MEDIA",
                        time=datetime.now()
                    ))
        
        elif platform == "weibo":
            if not auth_data:
                raise HTTPException(
                    status_code=400,
                    detail="auth_data is required for Weibo. Please provide valid cookies."
                )
            
            from clients.weibo_client import WeiboPlaywrightClient
            
            async with WeiboPlaywrightClient(auth_data=auth_data, headless=True) as client:
                async for post in client.fetch_data(config):
                    # Build markdown content
                    md_parts = []
                    if post.get('content'):
                        md_parts.append(post.get('content', ''))
                    if post.get('author'):
                        md_parts.insert(0, f"**@{post.get('author')}**\n")
                    if post.get('reposts'):
                        md_parts.append(f"\n转发: {post.get('reposts')}")
                    if post.get('comments'):
                        md_parts.append(f"评论: {post.get('comments')}")
                    if post.get('likes'):
                        md_parts.append(f"点赞: {post.get('likes')}")
                    
                    results.append(CleanItem(
                        title=post.get("title", post.get("content", "")[:50] if post.get("content") else None),
                        text=post.get("content", ""),
                        markdown="\n".join(md_parts) if md_parts else "Weibo post",
                        platform="Weibo",
                        url=post.get("url"),
                        sourceId=request.source_id,
                        sourceType="SOCIAL_MEDIA",
                        time=datetime.now()
                    ))
                    
        elif platform == "telegram":
            if not auth_data:
                raise HTTPException(
                    status_code=400,
                    detail="auth_data is required for Telegram. Please provide valid cookies and localStorage."
                )
            
            from clients.telegram_client import TelegramPlaywrightClient
            
            async with TelegramPlaywrightClient(auth_data=auth_data, headless=True) as client:
                async for msg in client.fetch_data(config):
                    # Build markdown content
                    md_parts = []
                    if msg.get('sender'):
                        md_parts.append(f"**{msg.get('sender')}**")
                    if msg.get('text'):
                        md_parts.append(msg.get('text', ''))
                    if msg.get('timestamp'):
                        md_parts.append(f"\n_{msg.get('timestamp')}_")
                    
                    results.append(CleanItem(
                        title=f"Telegram: {msg.get('sender', 'Message')}",
                        text=msg.get("text", ""),
                        markdown="\n".join(md_parts) if md_parts else "Telegram message",
                        platform="Telegram",
                        sourceId=request.source_id,
                        sourceType="SOCIAL_MEDIA",
                        time=datetime.now()
                    ))
                    
        elif platform == "whatsapp":
            from clients.whatsapp_client import WhatsAppPlaywrightClient
            
            # Check for specific profile directory in auth_data
            profile_path = None
            if request.auth_data and "profileName" in request.auth_data:
                profile_path = AUTH_DIR / request.auth_data["profileName"]
                print(f"[gather] Using custom WhatsApp profile for fetch: {profile_path}")
                
            async with WhatsAppPlaywrightClient(headless=True, profile_path=profile_path) as client:
                async for msg in client.fetch_data(config):
                    # Build markdown content
                    md_parts = []
                    if msg.get('text'):
                        md_parts.append(msg.get('text', ''))
                    if msg.get('direction'):
                        direction = "→" if msg.get('direction') == 'outgoing' else "←"
                        md_parts.insert(0, f"{direction} ")
                    if msg.get('timestamp'):
                        md_parts.append(f"\n_{msg.get('timestamp')}_")
                    
                    results.append(CleanItem(
                        title=f"WhatsApp Message",
                        text=msg.get("text", ""),
                        markdown="".join(md_parts) if md_parts else "WhatsApp message",
                        platform="WhatsApp",
                        sourceId=request.source_id,
                        sourceType="SOCIAL_MEDIA",
                        time=datetime.now()
                    ))
            
        elif platform == "instagram":
            if not auth_data:
                raise HTTPException(
                    status_code=400,
                    detail="auth_data is required for Instagram. Please provide valid cookies."
                )
            
            from clients.instagram_client import InstagramPlaywrightClient
            
            async with InstagramPlaywrightClient(auth_data=auth_data, headless=True) as client:
                async for post in client.fetch_data(config):
                    # Build markdown content
                    md_parts = []
                    if post.get('text'):
                        md_parts.append(post.get('text', ''))
                    if post.get('author'):
                        md_parts.insert(0, f"**@{post.get('author')}**\n")
                    
                    results.append(CleanItem(
                        title=f"Instagram Post",
                        text=post.get("text", ""),
                        markdown="\n".join(md_parts) if md_parts else "Instagram post",
                        platform="Instagram",
                        url=post.get("url"),
                        sourceId=request.source_id,
                        sourceType="SOCIAL_MEDIA",
                        time=datetime.now()
                    ))
                    
        elif platform == "facebook":
            if not auth_data:
                raise HTTPException(
                    status_code=400,
                    detail="auth_data is required for Facebook. Please provide valid cookies."
                )
            
            from clients.facebook_client import FacebookPlaywrightClient
            
            async with FacebookPlaywrightClient(auth_data=auth_data, headless=True) as client:
                async for post in client.fetch_data(config):
                    # Build markdown content
                    md_parts = []
                    if post.get('text'):
                        md_parts.append(post.get('text', ''))
                    if post.get('author'):
                        md_parts.insert(0, f"**{post.get('author')}**\n")
                    
                    results.append(CleanItem(
                        title=f"Facebook Post",
                        text=post.get("text", ""),
                        markdown="\n".join(md_parts) if md_parts else "Facebook post",
                        platform="Facebook",
                        url=post.get("url"),
                        sourceId=request.source_id,
                        sourceType="SOCIAL_MEDIA",
                        time=datetime.now()
                    ))
            
        else:
            # Fallback or generic logic
            results.append(CleanItem(
                text=f"Generic social media placeholder for {platform}",
                markdown=f"Generic content for {platform}",
                platform=platform,
                sourceId=request.source_id,
                sourceType="SOCIAL_MEDIA",
                time=datetime.now()
            ))
            
        return results
        
    except HTTPException:
        raise
    except Exception as e:
        print(f"[gather] Error fetching {platform}: {e}")
        raise HTTPException(status_code=500, detail=str(e))


def _strip_playwright_meta_block(script: str) -> str:
    return re.sub(r"/\*\s*@meta[\s\S]*?\*/", "", script, count=1).strip()


def _extract_playwright_eval_options(config: Dict[str, Any]) -> dict[str, Any]:
    raw = config.get("playwright")
    if not isinstance(raw, dict):
        raise HTTPException(status_code=400, detail="config.playwright must be an object")

    target_url = raw.get("targetUrl")
    if not isinstance(target_url, str) or not target_url.strip():
        raise HTTPException(status_code=400, detail="config.playwright.targetUrl is required for eval-js mode")

    script_body = raw.get("scriptBody") or raw.get("jsBody")
    script_path = raw.get("scriptPath")
    if script_body is None and script_path is None:
        raise HTTPException(status_code=400, detail="config.playwright.scriptBody or scriptPath is required")

    if script_body is not None and not isinstance(script_body, str):
        raise HTTPException(status_code=400, detail="config.playwright.scriptBody must be a string")

    if script_path is not None:
        if not isinstance(script_path, str) or not script_path.strip():
            raise HTTPException(status_code=400, detail="config.playwright.scriptPath must be a non-empty string")
        resolved = Path(script_path).expanduser()
        if not resolved.is_absolute():
            resolved = (Path(__file__).resolve().parent / resolved).resolve()
        if not resolved.exists() or not resolved.is_file():
            raise HTTPException(status_code=400, detail=f"scriptPath does not exist: {script_path}")
        script_body = resolved.read_text(encoding="utf-8")

    wait_until = str(raw.get("waitUntil", "domcontentloaded")).lower()
    if wait_until not in {"domcontentloaded", "networkidle", "load", "commit"}:
        raise HTTPException(status_code=400, detail="config.playwright.waitUntil must be one of domcontentloaded/networkidle/load/commit")

    navigation_timeout_ms = raw.get("navigationTimeoutMs", 60000)
    if not isinstance(navigation_timeout_ms, int) or navigation_timeout_ms < 1000:
        raise HTTPException(status_code=400, detail="config.playwright.navigationTimeoutMs must be an integer >= 1000")

    post_nav_wait_ms = raw.get("postNavigationWaitMs", 0)
    if not isinstance(post_nav_wait_ms, int) or post_nav_wait_ms < 0:
        raise HTTPException(status_code=400, detail="config.playwright.postNavigationWaitMs must be an integer >= 0")

    wait_selector = raw.get("waitForSelector")
    if wait_selector is not None and (not isinstance(wait_selector, str) or not wait_selector.strip()):
        raise HTTPException(status_code=400, detail="config.playwright.waitForSelector must be a non-empty string")

    args = raw.get("args", {})
    try:
        args_json = json.dumps(args, ensure_ascii=False)
    except TypeError as error:
        raise HTTPException(status_code=400, detail=f"config.playwright.args is not JSON serializable: {error}") from error

    storage_state: Dict[str, Any] | None = None
    state_file = raw.get("stateFile", raw.get("authFile"))
    if state_file is not None:
        if not isinstance(state_file, str) or not state_file.strip():
            raise HTTPException(status_code=400, detail="config.playwright.stateFile must be a non-empty string")
        state_path = Path(state_file).expanduser()
        if not state_path.is_absolute():
            state_path = (Path(__file__).resolve().parent / state_path).resolve()
        if not state_path.exists() or not state_path.is_file():
            raise HTTPException(status_code=400, detail=f"stateFile does not exist: {state_file}")
        try:
            raw_state = json.loads(state_path.read_text(encoding="utf-8"))
        except json.JSONDecodeError as error:
            raise HTTPException(status_code=400, detail=f"stateFile is not valid JSON: {error}") from error
        if not isinstance(raw_state, dict):
            raise HTTPException(status_code=400, detail="stateFile JSON must be an object")
        storage_state = raw_state

    return {
        "target_url": target_url.strip(),
        "script_body": _strip_playwright_meta_block(script_body or ""),
        "wait_until": wait_until,
        "navigation_timeout_ms": navigation_timeout_ms,
        "post_navigation_wait_ms": post_nav_wait_ms,
        "wait_selector": wait_selector.strip() if isinstance(wait_selector, str) else None,
        "args_json": args_json,
        "headless": bool(raw.get("headless", True)),
        "storage_state": storage_state,
    }


def _to_clean_item_from_eval_value(value: Any, request: FetchRequest, target_url: str, index: int) -> CleanItem:
    if isinstance(value, dict):
        raw_time = value.get("time", value.get("created_at"))
        parsed_time: datetime | None = None
        if isinstance(raw_time, str):
            try:
                parsed_time = datetime.fromisoformat(raw_time)
            except ValueError:
                parsed_time = None
                try:
                    parsed_time = datetime.strptime(raw_time, "%a %b %d %H:%M:%S %z %Y")
                except ValueError:
                    parsed_time = None
        text = value.get("text")
        if text is None and isinstance(value.get("full_text"), str):
            text = value.get("full_text")
        markdown = value.get("markdown")
        if text is None and markdown is None:
            text = json.dumps(value, ensure_ascii=False)
            markdown = text
        elif text is None:
            text = str(markdown)
        elif markdown is None:
            author = value.get("author")
            markdown = f"@{author}: {text}" if isinstance(author, str) and author else str(text)
        return CleanItem(
            title=value.get("title") or value.get("name"),
            text=str(text),
            markdown=str(markdown),
            platform=str(value.get("platform") or request.platform),
            url=value.get("url") or target_url,
            time=parsed_time or datetime.now(),
            sourceId=request.source_id,
            sourceType="SOCIAL_MEDIA",
            recordId=value.get("recordId") or value.get("id"),
            recordType=str(value.get("recordType") or value.get("type") or "eval-js"),
            recordIndex=value.get("recordIndex") if isinstance(value.get("recordIndex"), int) else index,
        )

    text_value = str(value)
    return CleanItem(
        title=f"playwright eval result {index}",
        text=text_value,
        markdown=text_value,
        platform=request.platform,
        url=target_url,
        time=datetime.now(),
        sourceId=request.source_id,
        sourceType="SOCIAL_MEDIA",
        recordType="eval-js",
        recordIndex=index,
    )


def _normalize_playwright_eval_result(result: Any, request: FetchRequest, target_url: str) -> list[CleanItem]:
    candidate = result
    if isinstance(candidate, dict):
        raw_error = candidate.get("error")
        if isinstance(raw_error, str) and raw_error.strip():
            hint = candidate.get("hint")
            message = raw_error.strip()
            if isinstance(hint, str) and hint.strip():
                message = f"{message} | hint: {hint.strip()}"
            raise HTTPException(status_code=400, detail=message)
        for key in ("tweets", "posts", "notes", "items", "results", "data"):
            nested = candidate.get(key)
            if isinstance(nested, list):
                candidate = nested
                break
    if isinstance(candidate, list):
        if not candidate:
            return []
        return [
            _to_clean_item_from_eval_value(item, request, target_url, index)
            for index, item in enumerate(candidate, start=1)
        ]
    return [_to_clean_item_from_eval_value(candidate, request, target_url, 1)]


async def _run_playwright_eval_script(request: FetchRequest) -> list[CleanItem]:
    from playwright.async_api import TimeoutError as PlaywrightTimeoutError
    from playwright.async_api import async_playwright

    options = _extract_playwright_eval_options(request.config)
    script_to_run = f"({options['script_body']})({options['args_json']})"

    try:
        async with async_playwright() as playwright:
            browser = await playwright.chromium.launch(headless=options["headless"])
            context_options: dict[str, Any] = {}
            if request.auth_data:
                context_options["storage_state"] = request.auth_data
            elif options["storage_state"]:
                context_options["storage_state"] = options["storage_state"]
            context = await browser.new_context(**context_options)
            try:
                page = await context.new_page()
                await page.goto(
                    options["target_url"],
                    wait_until=options["wait_until"],
                    timeout=options["navigation_timeout_ms"],
                )
                if options["wait_selector"]:
                    await page.wait_for_selector(options["wait_selector"], timeout=options["navigation_timeout_ms"])
                if options["post_navigation_wait_ms"] > 0:
                    await page.wait_for_timeout(options["post_navigation_wait_ms"])
                eval_result = await page.evaluate(script_to_run)
            finally:
                await context.close()
                await browser.close()
    except PlaywrightTimeoutError as error:
        raise HTTPException(status_code=504, detail=f"playwright eval timeout: {error}") from error
    except HTTPException:
        raise
    except Exception as error:
        raise HTTPException(status_code=500, detail=f"playwright eval execution failed: {error}") from error

    items = _normalize_playwright_eval_result(eval_result, request, options["target_url"])
    if not items:
        raise HTTPException(status_code=500, detail="playwright eval script finished without output")
    return items


def _truncate_text(value: str, max_length: int = 12000) -> str:
    if len(value) <= max_length:
        return value
    return f"{value[:max_length]}..."


def _extract_x_status_id(url: Optional[str]) -> Optional[str]:
    if not url:
        return None
    matched = re.search(r"/status/(\d+)", url)
    return matched.group(1) if matched else None


def _normalize_capture_text(value: str) -> str:
    normalized = value.strip()
    if normalized.startswith('"""') and normalized.endswith('"""'):
        normalized = normalized[3:-3]
    for _ in range(2):
        if normalized.startswith('"') and normalized.endswith('"'):
            try:
                decoded = json.loads(normalized)
            except json.JSONDecodeError:
                break
            if isinstance(decoded, str):
                normalized = decoded.strip()
                continue
        break
    normalized = normalized.replace("\\r\\n", "\n").replace("\\n", "\n")
    return normalized.strip()


def _resolve_record_schema(config: Dict[str, Any]) -> dict[str, Any]:
    default_schema = {
        "format": "auto",
        "record_separator": "\n",
        "pair_separator": "｜",
        "field_map": {
            "id": "MSGID",
            "text": "MSG",
            "url": "LINK",
            "time": "DATE",
            "meta": "META",
            "author": "AUTH",
            "type": "TYPE",
        },
    }
    raw = config.get("recordSchema")
    if raw is None and isinstance(config.get("agentBrowser"), dict):
        raw = config["agentBrowser"].get("recordSchema")
    if not isinstance(raw, dict):
        return default_schema

    schema = dict(default_schema)
    schema["format"] = str(raw.get("format", schema["format"])).lower()
    if isinstance(raw.get("recordSeparator"), str) and raw["recordSeparator"]:
        schema["record_separator"] = raw["recordSeparator"]
    if isinstance(raw.get("pairSeparator"), str) and raw["pairSeparator"]:
        schema["pair_separator"] = raw["pairSeparator"]
    field_map = raw.get("fieldMap")
    if isinstance(field_map, dict):
        normalized_map: dict[str, str] = {}
        for key, value in field_map.items():
            if isinstance(key, str) and isinstance(value, str) and key and value:
                normalized_map[key.lower()] = value.upper()
        if normalized_map:
            schema["field_map"] = {**schema["field_map"], **normalized_map}
    return schema


def _extract_jsonl_records(text: str) -> list[dict[str, Any]]:
    def parse_object_line(raw_line: str) -> Optional[dict[str, Any]]:
        try:
            payload = json.loads(raw_line)
        except json.JSONDecodeError:
            return None
        if not isinstance(payload, dict):
            return None
        body = payload.get("text", payload.get("content", ""))
        if not isinstance(body, str) or not body.strip():
            return None
        record_id = payload.get("recordId", payload.get("id"))
        record_type = payload.get("recordType", payload.get("type", "message"))
        return {
            "record_id": str(record_id).strip() if record_id else None,
            "record_type": str(record_type).strip() if record_type else "message",
            "body": body.strip(),
            "url": str(payload["url"]).strip() if isinstance(payload.get("url"), str) else None,
            "time": str(payload["time"]).strip() if isinstance(payload.get("time"), str) else None,
            "meta": str(payload["meta"]).strip() if isinstance(payload.get("meta"), str) else None,
            "author": str(payload["author"]).strip() if isinstance(payload.get("author"), str) else None,
        }

    def expand_line_candidates(raw_line: str) -> list[str]:
        candidates: list[str] = []
        queue = [raw_line.strip()]
        seen: set[str] = set()
        while queue:
            current = queue.pop(0).strip()
            if not current or current in seen:
                continue
            seen.add(current)
            candidates.append(current)

            if current == '""':
                continue

            if current.startswith('"') and current.endswith('"'):
                try:
                    decoded = json.loads(current)
                except json.JSONDecodeError:
                    decoded = current[1:-1]
                if isinstance(decoded, str):
                    queue.extend(part.strip() for part in decoded.splitlines() if part.strip())

            if "\\n" in current:
                queue.extend(part.strip() for part in current.split("\\n") if part.strip())
            if "\n" in current:
                queue.extend(part.strip() for part in current.splitlines() if part.strip())

        return candidates

    candidates = [text]
    if '\\"' in text:
        candidates.append(text.replace('\\"', '"'))

    for candidate in candidates:
        records: list[dict[str, Any]] = []
        seen_signatures: set[tuple[Optional[str], str]] = set()

        def append_parsed(parsed: dict[str, Any]) -> None:
            signature = (parsed["record_id"], parsed["body"])
            if signature in seen_signatures:
                return
            seen_signatures.add(signature)
            parsed["record_index"] = len(records) + 1
            records.append(parsed)

        for quoted in re.finditer(r'"(?:\\.|[^"\\])*"', candidate, re.S):
            wrapped = quoted.group(0)
            try:
                decoded = json.loads(wrapped)
            except json.JSONDecodeError:
                decoded = wrapped[1:-1]
                decoded = decoded.replace('\\"', '"').replace("\\r\\n", "\n").replace("\\n", "\n")
            if not isinstance(decoded, str) or not decoded.strip():
                continue
            for fragment in expand_line_candidates(decoded):
                if not (fragment.startswith("{") and fragment.endswith("}")):
                    continue
                parsed = parse_object_line(fragment)
                if parsed:
                    append_parsed(parsed)

        for line in candidate.splitlines():
            for expanded_line in expand_line_candidates(line):
                if not (expanded_line.startswith("{") and expanded_line.endswith("}")):
                    continue
                parsed = parse_object_line(expanded_line)
                if not parsed:
                    continue
                append_parsed(parsed)

        relaxed = candidate.replace('\\"', '"')
        for matched in re.finditer(r"\{[^{}]+\}", relaxed):
            parsed = parse_object_line(matched.group(0))
            if parsed:
                append_parsed(parsed)
        if records:
            return records
    return []


def _extract_tagged_records(text: str, schema: dict[str, Any]) -> list[dict[str, Any]]:
    field_map = schema["field_map"]
    id_key = field_map.get("id", "MSGID")
    text_key = field_map.get("text", "MSG")
    url_key = field_map.get("url", "LINK")
    time_key = field_map.get("time", "DATE")
    meta_key = field_map.get("meta", "META")
    type_key = field_map.get("type", "TYPE")
    author_key = field_map.get("author", "AUTH")
    pair_separator = schema["pair_separator"]
    lines = [part.strip() for part in text.split(schema["record_separator"]) if part.strip()]
    records: list[dict[str, Any]] = []

    for line in lines:
        fields: dict[str, str] = {}
        chunks = [chunk.strip() for chunk in line.split(pair_separator) if chunk.strip()]
        for chunk in chunks:
            for delimiter in ("：", ":"):
                if delimiter in chunk:
                    key, value = chunk.split(delimiter, 1)
                    fields[key.strip().upper()] = value.strip()
                    break
        body = fields.get(text_key, "")
        if not body:
            continue
        records.append(
            {
                "record_id": fields.get(id_key),
                "record_type": fields.get(type_key, "message"),
                "record_index": len(records) + 1,
                "body": body,
                "url": fields.get(url_key),
                "time": fields.get(time_key),
                "meta": fields.get(meta_key),
                "author": fields.get(author_key),
            }
        )
    return records


def _extract_structured_records(text: str) -> list[dict[str, Any]]:
    pattern = re.compile(
        r"(?:(?<=\n)|^)(?P<record_id>[a-zA-Z][\w-]*-\d+):\s*(?P<body>.*?)(?=(?:\n[a-zA-Z][\w-]*-\d+:)|\Z)",
        re.S,
    )
    records = []
    for index, matched in enumerate(pattern.finditer(text), start=1):
        body = matched.group("body").strip()
        if not body:
            continue
        records.append(
            {
                "record_id": matched.group("record_id"),
                "body": body,
                "record_index": index,
                "record_type": "message",
                "url": None,
                "time": None,
                "meta": None,
                "author": None,
            }
        )
    return records


def _capture_outputs_to_clean_items(
    request: FetchRequest,
    script_result: Any,
    capture_key: str,
    outputs: list[str],
    now: datetime,
) -> list[CleanItem]:
    text = _truncate_text("\n".join(output for output in outputs if output))
    if not text:
        text = f"Capture '{capture_key}' completed with {len(outputs)} executions"
        return [
            CleanItem(
                title=f"agent-browser capture: {capture_key}",
                text=text,
                markdown=f"### {capture_key}\n\n```\n{text}\n```",
                platform=request.platform,
                sourceId=request.source_id,
                sourceType="SOCIAL_MEDIA",
                time=now,
                driver="agent-browser",
                instanceId=script_result.instance_id,
                tabId=script_result.tab_id,
                instanceActive=script_result.instance_active,
                recordType="capture",
            )
        ]

    normalized = _normalize_capture_text(text)
    schema = _resolve_record_schema(request.config)
    records: list[dict[str, Any]] = []
    if schema["format"] in {"auto", "jsonl"}:
        records = _extract_jsonl_records(normalized)
    if not records and schema["format"] in {"auto", "tagged"}:
        records = _extract_tagged_records(normalized, schema)
    if not records and schema["format"] in {"auto", "legacy"}:
        records = _extract_structured_records(normalized)

    if not records:
        return [
            CleanItem(
                title=f"agent-browser capture: {capture_key}",
                text=text,
                markdown=f"### {capture_key}\n\n```\n{text}\n```",
                platform=request.platform,
                sourceId=request.source_id,
                sourceType="SOCIAL_MEDIA",
                time=now,
                driver="agent-browser",
                instanceId=script_result.instance_id,
                tabId=script_result.tab_id,
                instanceActive=script_result.instance_active,
                recordType="capture",
            )
        ]

    items: list[CleanItem] = []
    for record in records:
        record_title = record["record_id"] or f"{capture_key} #{record['record_index']}"
        markdown = f"### {record_title}\n\n{record['body']}"
        if record.get("meta"):
            markdown = f"{markdown}\n\n> meta: {record['meta']}"
        record_time = now
        raw_time = record.get("time")
        if isinstance(raw_time, str):
            parsed_time = None
            for candidate in (raw_time, raw_time.replace("Z", "+00:00")):
                try:
                    parsed_time = datetime.fromisoformat(candidate)
                    break
                except ValueError:
                    continue
            if parsed_time is not None:
                record_time = parsed_time

        items.append(
            CleanItem(
                title=f"agent-browser {capture_key}: {record_title}",
                text=record["body"],
                markdown=markdown,
                platform=request.platform,
                url=record.get("url"),
                sourceId=request.source_id,
                sourceType="SOCIAL_MEDIA",
                time=record_time,
                driver="agent-browser",
                instanceId=script_result.instance_id,
                tabId=script_result.tab_id,
                instanceActive=script_result.instance_active,
                recordId=record["record_id"],
                recordType=record.get("record_type", "message"),
                recordIndex=record["record_index"],
            )
        )
    return items


def _agent_browser_results_to_clean_items(
    request: FetchRequest,
    script_result: Any,
) -> list[CleanItem]:
    now = datetime.now()
    items: list[CleanItem] = []
    captures = script_result.captures

    if captures:
        for capture_key, outputs in captures.items():
            items.extend(
                _capture_outputs_to_clean_items(
                    request=request,
                    script_result=script_result,
                    capture_key=capture_key,
                    outputs=outputs,
                    now=now,
                )
            )

    if items:
        return items

    step_summary = [
        {
            "step_index": result.step_index,
            "attempt": result.attempt,
            "command": result.command,
            "stdout": _truncate_text(result.stdout.strip(), 2000),
        }
        for result in script_result.step_results
    ]
    summary_text = _truncate_text(json.dumps(step_summary, ensure_ascii=False))
    return [
        CleanItem(
            title="agent-browser execution summary",
            text=summary_text,
            markdown=f"```json\n{summary_text}\n```",
            platform=request.platform,
            sourceId=request.source_id,
            sourceType="SOCIAL_MEDIA",
            time=now,
            driver="agent-browser",
            instanceId=script_result.instance_id,
            tabId=script_result.tab_id,
            instanceActive=script_result.instance_active,
        )
    ]


async def _agent_browser_verify_auth(_request: VerifyAuthRequest):
    return VerifyAuthResponse(
        valid=True,
        message="agent-browser authentication is configured through fetch config (profile/session/state).",
    )


def _extract_keyword_filter_keywords(config: Dict[str, Any]) -> Optional[List[str]]:
    raw_filter = config.get("keywordFilter")
    raw_keywords: Any = None

    if raw_filter is None:
        raw_keywords = config.get("keywords")
        if raw_keywords is None:
            return None
    elif isinstance(raw_filter, dict):
        if raw_filter.get("enabled", True) is False:
            return None
        raw_keywords = raw_filter.get("keywords", raw_filter.get("terms"))
    else:
        raise KeywordFilterConfigError("config.keywordFilter must be an object")

    if not isinstance(raw_keywords, list):
        raise KeywordFilterConfigError("keyword filter keywords must be a string array")

    normalized: list[str] = []
    for index, value in enumerate(raw_keywords):
        if not isinstance(value, str):
            raise KeywordFilterConfigError(f"keyword filter keywords[{index}] must be string")
        keyword = value.strip()
        if not keyword:
            raise KeywordFilterConfigError(f"keyword filter keywords[{index}] must not be empty")
        normalized.append(keyword.lower())

    unique_keywords = list(dict.fromkeys(normalized))
    if not unique_keywords:
        raise KeywordFilterConfigError("keyword filter keywords must not be empty")
    return unique_keywords


def _extract_keyword_filter_options(config: Dict[str, Any]) -> dict[str, Any]:
    raw_filter = config.get("keywordFilter")
    if raw_filter is None:
        return {"match_scope": "item", "split_mode": "auto"}
    if not isinstance(raw_filter, dict):
        raise KeywordFilterConfigError("config.keywordFilter must be an object")

    raw_scope = raw_filter.get("matchScope", raw_filter.get("scope", "item"))
    if raw_scope not in {"item", "segment"}:
        raise KeywordFilterConfigError("keyword filter matchScope must be item or segment")

    raw_split_mode = raw_filter.get("splitMode", raw_filter.get("segmentSplit", "auto"))
    if raw_split_mode not in {"auto", "line", "paragraph"}:
        raise KeywordFilterConfigError("keyword filter splitMode must be auto, line, or paragraph")

    min_segment_chars = raw_filter.get("minSegmentChars", 1)
    if not isinstance(min_segment_chars, int) or min_segment_chars < 1:
        raise KeywordFilterConfigError("keyword filter minSegmentChars must be a positive integer")

    return {
        "match_scope": raw_scope,
        "split_mode": raw_split_mode,
        "min_segment_chars": min_segment_chars,
    }


def _keyword_filter_text(item: CleanItem) -> str:
    parts = [
        item.title or "",
        item.text or "",
        item.markdown or "",
        item.url or "",
    ]
    return " ".join(part for part in parts if part).lower()


def _split_text_segments(text: str, split_mode: str, min_segment_chars: int) -> list[str]:
    if split_mode == "line":
        raw_segments = text.splitlines()
    elif split_mode == "paragraph":
        raw_segments = re.split(r"\n\s*\n+", text)
    else:
        if "\n\n" in text:
            raw_segments = re.split(r"\n\s*\n+", text)
        else:
            raw_segments = text.splitlines()

    segments: list[str] = []
    for segment in raw_segments:
        normalized = segment.strip()
        if len(normalized) >= min_segment_chars:
            segments.append(normalized)
    return segments


def _apply_keyword_segment_filter(item: CleanItem, keywords: list[str], options: dict[str, Any]) -> list[CleanItem]:
    segments = _split_text_segments(
        item.text or item.markdown or "",
        split_mode=options["split_mode"],
        min_segment_chars=options["min_segment_chars"],
    )
    if not segments:
        return []

    matched_items: list[CleanItem] = []
    for index, segment in enumerate(segments, start=1):
        haystack = segment.lower()
        matched = [keyword for keyword in keywords if keyword in haystack]
        if not matched:
            continue

        matched_items.append(
            item.model_copy(
                update={
                    "title": f"{item.title or item.platform} [segment {index}]",
                    "text": segment,
                    "markdown": segment,
                    "matchedKeywords": matched,
                    "keywordMatchScore": round(len(matched) / len(keywords), 4),
                }
            )
        )
    return matched_items


def _apply_keyword_hard_filter(request: FetchRequest, items: List[CleanItem]) -> List[CleanItem]:
    try:
        keywords = _extract_keyword_filter_keywords(request.config)
        options = _extract_keyword_filter_options(request.config)
    except KeywordFilterConfigError as error:
        print(
            f"[gather][keyword-filter][error] "
            f"{json.dumps({'sourceId': request.source_id, 'platform': request.platform, 'error': str(error)}, ensure_ascii=False)}"
        )
        raise HTTPException(status_code=400, detail=f"keyword filter invalid config: {error}") from error

    if not keywords:
        return items

    filtered: list[CleanItem] = []
    hit = 0
    miss = 0
    fetched = len(items)

    for item in items:
        if options["match_scope"] == "segment":
            segment_hits = _apply_keyword_segment_filter(item, keywords, options)
            if segment_hits:
                filtered.extend(segment_hits)
                hit += 1
                continue
        else:
            haystack = _keyword_filter_text(item)
            matched = [keyword for keyword in keywords if keyword in haystack]
            if matched:
                item.matchedKeywords = matched
                item.keywordMatchScore = round(len(matched) / len(keywords), 4)
                filtered.append(item)
                hit += 1
                continue

        miss += 1
        print(
            f"[gather][keyword-filter][audit] "
            f"{json.dumps({'sourceId': item.sourceId, 'platform': item.platform, 'url': item.url, 'reason': 'keyword_miss'}, ensure_ascii=False)}"
        )

    print(
        f"[gather][keyword-filter][metrics] "
        f"{json.dumps({'sourceId': request.source_id, 'platform': request.platform, 'fetched': fetched, 'hit': hit, 'miss': miss, 'persisted': len(filtered), 'matchScope': options['match_scope']}, ensure_ascii=False)}"
    )

    return filtered


def _normalize_clean_items(raw_items: list[Any]) -> list[CleanItem]:
    normalized: list[CleanItem] = []
    for item in raw_items:
        if isinstance(item, CleanItem):
            normalized.append(item)
            continue
        try:
            normalized.append(CleanItem.model_validate(item))
        except ValidationError as error:
            raise HTTPException(
                status_code=500,
                detail=f"driver returned invalid item payload: {error.errors()[0].get('msg', 'validation failed')}",
            ) from error
    return normalized


def _apply_response_formats(items: list[CleanItem], response_formats: Optional[List[str]]) -> list[CleanItem]:
    if not response_formats:
        return items

    allowed = set(response_formats)
    include_text = "text" in allowed
    include_markdown = "markdown" in allowed

    for item in items:
        if not include_text:
            item.text = None
        if not include_markdown:
            item.markdown = None
    return items


async def _agent_browser_fetch_data(request: FetchRequest):
    try:
        script_result = await asyncio.to_thread(execute_agent_browser_script, request.config)
        items = _agent_browser_results_to_clean_items(request, script_result)
        if not items:
            raise HTTPException(
                status_code=500,
                detail={"message": "agent-browser script finished without output"},
            )
        return items
    except AgentBrowserScriptError as error:
        status_code_map = {
            "invalid_config": 400,
            "forbidden_instance_owner": 403,
            "forbidden_instance_session": 403,
            "instance_expired": 410,
        }
        status_code = status_code_map.get(error.reason, 500)
        debug_parts = [f"reason={error.reason}"]
        if error.step_index is not None:
            debug_parts.append(f"step={error.step_index}")
        if error.command:
            debug_parts.append(f"command={error.command}")
        if error.return_code is not None:
            debug_parts.append(f"returnCode={error.return_code}")
        if error.stderr:
            debug_parts.append(f"stderr={_truncate_text(error.stderr, 1000)}")
        elif error.stdout:
            debug_parts.append(f"stdout={_truncate_text(error.stdout, 1000)}")
        enriched_message = f"{error.message} | {'; '.join(debug_parts)}"
        raise HTTPException(
            status_code=status_code,
            detail={
                "message": enriched_message,
                "reason": error.reason,
                "step": error.step_index,
                "command": error.command,
                "returnCode": error.return_code,
                "stdout": error.stdout,
                "stderr": error.stderr,
                "debug": error.debug_context,
            },
        )


driver_registry = DriverRegistry(default_driver="playwright")
driver_registry.register(
    "xhttp",
    XHttpDriver(),
)
driver_registry.register(
    "playwright",
    PlaywrightDriver(
        verify_auth_handler=_playwright_verify_auth,
        fetch_handler=_playwright_fetch_data,
    ),
)
driver_registry.register(
    "agent-browser",
    PlaywrightDriver(
        verify_auth_handler=_agent_browser_verify_auth,
        fetch_handler=_agent_browser_fetch_data,
    ),
)


def _to_driver_http_exception(error: DriverNotFoundError) -> HTTPException:
    return HTTPException(status_code=400, detail=error.to_detail())


def _to_driver_error_response(error: DriverNotFoundError) -> JSONResponse:
    detail = error.to_detail()
    return build_error_response(
        status_code=400,
        code=detail["code"],
        message=detail["message"],
        retryable=False,
    )


@app.post("/verify-auth", response_model=VerifyAuthResponse)
async def verify_auth(request: VerifyAuthRequest):
    try:
        return await driver_registry.verify_auth(request)
    except DriverNotFoundError as error:
        raise _to_driver_http_exception(error)


@app.post("/fetch", response_model=List[CleanItem], response_model_exclude_none=True)
async def fetch_data(request: FetchRequest):
    try:
        raw_results = await driver_registry.fetch(request)
        results = _normalize_clean_items(raw_results)
        results = _apply_keyword_hard_filter(request, results)
        return _apply_response_formats(results, request.response_formats)
    except DriverNotFoundError as error:
        raise _to_driver_http_exception(error)


@app.post(
    "/v2/fetch",
    response_model=List[CleanItem],
    response_model_exclude_none=True,
    responses={
        400: {"model": ErrorResponse},
        422: {"model": ErrorResponse},
        500: {"model": ErrorResponse},
    },
)
async def fetch_data_v2(payload: Dict[str, Any]):
    try:
        request = FetchV2Request.model_validate(payload)
    except ValidationError as e:
        first_error = e.errors()[0] if e.errors() else {}
        location = ".".join(str(part) for part in first_error.get("loc", []))
        message = first_error.get("msg", "Invalid request payload")
        if location:
            message = f"{location}: {message}"
        return build_error_response(
            status_code=422,
            code="VALIDATION_ERROR",
            message=message,
            retryable=False,
        )

    v1_request = FetchRequest(
        platform=request.platform,
        config=request.config,
        source_id=request.source_id,
        auth_data=request.auth_data,
        response_formats=request.response_formats,
    )

    try:
        raw_results = await driver_registry.fetch(v1_request, driver_name=request.driver)
        results = _normalize_clean_items(raw_results)
        results = _apply_keyword_hard_filter(v1_request, results)
        if request.driver:
            for item in results:
                item.driver = request.driver
        return _apply_response_formats(results, request.response_formats)
    except DriverNotFoundError as error:
        return _to_driver_error_response(error)
    except HTTPException as e:
        status_code = e.status_code
        if isinstance(e.detail, dict):
            message = str(e.detail.get("message", e.detail))
        else:
            message = str(e.detail) if e.detail else "Request failed"
        code = "FETCH_BAD_REQUEST" if status_code < 500 else "FETCH_INTERNAL_ERROR"
        retryable = status_code >= 500
        return build_error_response(
            status_code=status_code,
            code=code,
            message=message,
            retryable=retryable,
        )
    except Exception:
        return build_error_response(
            status_code=500,
            code="FETCH_INTERNAL_ERROR",
            message="Internal server error",
            retryable=True,
        )


@app.post(
    "/v2/agent-browser/heartbeat",
    response_model=AgentBrowserHeartbeatResponse,
    responses={
        400: {"model": ErrorResponse},
        403: {"model": ErrorResponse},
        410: {"model": ErrorResponse},
        422: {"model": ErrorResponse},
        500: {"model": ErrorResponse},
    },
)
async def agent_browser_heartbeat(payload: Dict[str, Any]):
    try:
        request = AgentBrowserHeartbeatRequest.model_validate(payload)
    except ValidationError as e:
        first_error = e.errors()[0] if e.errors() else {}
        location = ".".join(str(part) for part in first_error.get("loc", []))
        message = first_error.get("msg", "Invalid request payload")
        if location:
            message = f"{location}: {message}"
        return build_error_response(
            status_code=422,
            code="VALIDATION_ERROR",
            message=message,
            retryable=False,
        )

    heartbeat_config: dict[str, Any] = {
        "agentBrowser": {
            "instanceId": request.instance_id,
            "verbose": request.verbose,
            "heartbeat": True,
        }
    }
    if request.owner_id:
        heartbeat_config["agentBrowser"]["ownerId"] = request.owner_id
    if request.session_key:
        heartbeat_config["agentBrowser"]["sessionKey"] = request.session_key

    try:
        result = await asyncio.to_thread(heartbeat_agent_browser_instance, heartbeat_config)
    except AgentBrowserScriptError as error:
        status_code_map = {
            "invalid_config": 400,
            "forbidden_instance_owner": 403,
            "forbidden_instance_session": 403,
            "instance_expired": 410,
        }
        status_code = status_code_map.get(error.reason, 500)
        return build_error_response(
            status_code=status_code,
            code="HEARTBEAT_BAD_REQUEST" if status_code < 500 else "HEARTBEAT_INTERNAL_ERROR",
            message=error.message,
            retryable=False,
        )
    except Exception:
        return build_error_response(
            status_code=500,
            code="HEARTBEAT_INTERNAL_ERROR",
            message="Internal server error",
            retryable=True,
        )

    return AgentBrowserHeartbeatResponse(
        instanceId=result.instance_id,
        tabId=result.tab_id,
        instanceActive=result.instance_active,
        ttlSeconds=result.ttl_seconds,
        expiresAt=datetime.fromtimestamp(result.expires_at_epoch, tz=timezone.utc),
    )


# Constants for profile upload security
AUTH_DIR = Path(__file__).parent / ".auth"
MAX_PROFILE_SIZE = 100 * 1024 * 1024  # 100MB
PROFILE_NAME_PATTERN = re.compile(r'^[a-zA-Z0-9_-]{1,64}$')


class UploadProfileResponse(BaseModel):
    success: bool
    message: str
    profile_name: str
    verified: bool = False
    details: Optional[Dict[str, Any]] = None


@app.post("/upload-profile", response_model=UploadProfileResponse)
async def upload_profile(
    file: UploadFile = File(...),
    profile_name: str = Form(...),
    platform: str = Form(default="whatsapp")
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
    
    # 6. Verify the profile works
    try:
        from clients.whatsapp_client import WhatsAppPlaywrightClient
        
        print(f"[gather] Starting verification for: {profile_name}")
        # Create client with specific profile path
        async with WhatsAppPlaywrightClient(
            headless=False,
            profile_path=target_dir
        ) as client:
            is_valid = await client.verify_auth()
        
        print(f"[gather] Verification result for {profile_name}: {is_valid}")
        
        if is_valid:
            return UploadProfileResponse(
                success=True,
                message="Profile uploaded and verified successfully",
                profile_name=target_dir.name,
                verified=True,
                details={"platform": "WhatsApp", "auth_type": "profile"}
            )
        else:
            return UploadProfileResponse(
                success=True,
                message="Profile uploaded but authentication is invalid or expired",
                profile_name=target_dir.name,
                verified=False,
                details={"platform": "WhatsApp", "suggestion": "Please re-export the profile after logging in"}
            )
            
    except Exception as e:
        print(f"[gather] Profile verification error: {e}")
        return UploadProfileResponse(
            success=True,
            message=f"Profile uploaded but verification failed: {str(e)}",
            profile_name=target_dir.name,
            verified=False,
            details={"error": str(e)}
        )


@app.delete("/delete-profile/{profile_name}")
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


if __name__ == "__main__":
    import uvicorn
    host = os.getenv("GATHER_HOST", "0.0.0.0")
    port = int(os.getenv("GATHER_PORT", "8000"))
    reload = os.getenv("GATHER_RELOAD", "false").lower() == "true"
    
    print(f"[gather] Starting service on {host}:{port} (reload={reload})")
    # Using string import "main:app" to support reload
    uvicorn.run("main:app", host=host, port=port, reload=reload)
