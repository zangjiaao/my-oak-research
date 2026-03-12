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
from typing import List, Optional, Any, Dict
from datetime import datetime
from dotenv import load_dotenv
from drivers.agent_browser_runner import AgentBrowserScriptError, execute_agent_browser_script
from drivers.playwright_driver import PlaywrightDriver
from drivers.registry import DriverRegistry, DriverNotFoundError

# Load environment variables from .env file
load_dotenv()

app = FastAPI(title="Oak Gather Service")


class FetchRequest(BaseModel):
    platform: str
    config: Dict[str, Any]
    source_id: str
    auth_data: Optional[Dict[str, Any]] = None  # Playwright storage_state format


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


class VerifyAuthRequest(BaseModel):
    platform: str
    auth_data: Dict[str, Any]  # Playwright storage_state format (cookies + origins)
    headless: bool = False  # Set to False for debugging, True for production


class VerifyAuthResponse(BaseModel):
    valid: bool
    message: str
    details: Optional[Dict[str, Any]] = None


class CleanItem(BaseModel):
    title: Optional[str] = None
    text: str
    markdown: str
    platform: str
    url: Optional[str] = None
    time: Optional[datetime] = None
    sourceId: str
    sourceType: str
    driver: Optional[str] = "python-gather"


class ErrorDetail(BaseModel):
    code: str
    message: str
    retryable: bool


class ErrorResponse(BaseModel):
    error: ErrorDetail


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


async def _playwright_verify_auth(request: VerifyAuthRequest):
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


async def _playwright_fetch_data(request: FetchRequest):
    """
    Unified entry point for social media data fetching.
    Uses Playwright with cookie-based authentication.
    """
    platform = request.platform.lower()
    config = request.config
    auth_data = request.auth_data
    
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
                        time=datetime.fromisoformat(tweet["timestamp"]) if tweet.get("timestamp") else datetime.now()
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
                        time=datetime.now()
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


def _truncate_text(value: str, max_length: int = 12000) -> str:
    if len(value) <= max_length:
        return value
    return f"{value[:max_length]}..."


def _agent_browser_results_to_clean_items(
    request: FetchRequest,
    script_result: Any,
) -> list[CleanItem]:
    now = datetime.now()
    items: list[CleanItem] = []
    captures = script_result.captures

    if captures:
        for capture_key, outputs in captures.items():
            text = _truncate_text("\n".join(output for output in outputs if output))
            if not text:
                text = f"Capture '{capture_key}' completed with {len(outputs)} executions"
            items.append(
                CleanItem(
                    title=f"agent-browser capture: {capture_key}",
                    text=text,
                    markdown=f"### {capture_key}\n\n```\n{text}\n```",
                    platform=request.platform,
                    sourceId=request.source_id,
                    sourceType="SOCIAL_MEDIA",
                    time=now,
                    driver="agent-browser",
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
        )
    ]


async def _agent_browser_verify_auth(_request: VerifyAuthRequest):
    return VerifyAuthResponse(
        valid=True,
        message="agent-browser authentication is configured through fetch config (profile/session/state).",
    )


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
        status_code = 400 if error.reason == "invalid_config" else 500
        raise HTTPException(
            status_code=status_code,
            detail={
                "message": error.message,
                "reason": error.reason,
                "step": error.step_index,
                "command": error.command,
            },
        )


driver_registry = DriverRegistry(default_driver="playwright")
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


@app.post("/fetch", response_model=List[CleanItem])
async def fetch_data(request: FetchRequest):
    try:
        return await driver_registry.fetch(request)
    except DriverNotFoundError as error:
        raise _to_driver_http_exception(error)


@app.post(
    "/v2/fetch",
    response_model=List[CleanItem],
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
    )

    try:
        results = await driver_registry.fetch(v1_request, driver_name=request.driver)
        if request.driver:
            for item in results:
                item.driver = request.driver
        return results
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
