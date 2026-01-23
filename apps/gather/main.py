"""
Oak Gather Service
Social media data fetching service using Playwright with cookie-based authentication.
"""
import os
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
from typing import List, Optional, Any, Dict
from datetime import datetime
from dotenv import load_dotenv

# Load environment variables from .env file
load_dotenv()

app = FastAPI(title="Oak Gather Service")


class FetchRequest(BaseModel):
    platform: str
    config: Dict[str, Any]
    source_id: str
    auth_data: Optional[Dict[str, Any]] = None  # Playwright storage_state format


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


@app.get("/")
async def root():
    return {"status": "ok", "service": "oak-gather"}


@app.post("/verify-auth", response_model=VerifyAuthResponse)
async def verify_auth(request: VerifyAuthRequest):
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
            
            async with WhatsAppPlaywrightClient(headless=headless) as client:
                is_valid = await client.verify_auth()
                
            if is_valid:
                return VerifyAuthResponse(
                    valid=True,
                    message="WhatsApp authentication is valid",
                    details={"platform": "WhatsApp", "auth_type": "persistent_profile"}
                )
            else:
                return VerifyAuthResponse(
                    valid=False,
                    message="WhatsApp authentication is invalid or expired",
                    details={"platform": "WhatsApp", "suggestion": "Please run: uv run export_chrome_cookies.py whatsapp"}
                )
                
        else:
            return VerifyAuthResponse(
                valid=False,
                message=f"Platform '{platform}' is not supported for auth verification",
                details={"supported_platforms": ["x", "twitter", "xiaohongshu", "xhs", "reddit", "douyin", "tiktok", "weibo", "telegram", "whatsapp"]}
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


@app.post("/fetch", response_model=List[CleanItem])
async def fetch_data(request: FetchRequest):
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
            # WhatsApp uses persistent context, no auth_data needed
            from clients.whatsapp_client import WhatsAppPlaywrightClient
            
            async with WhatsAppPlaywrightClient(headless=True) as client:
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


if __name__ == "__main__":
    import uvicorn
    host = os.getenv("GATHER_HOST", "0.0.0.0")
    port = int(os.getenv("GATHER_PORT", "8000"))
    reload = os.getenv("GATHER_RELOAD", "false").lower() == "true"
    
    print(f"[gather] Starting service on {host}:{port} (reload={reload})")
    # Using string import "main:app" to support reload
    uvicorn.run("main:app", host=host, port=port, reload=reload)
