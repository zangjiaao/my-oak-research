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

@app.post("/fetch", response_model=List[CleanItem])
async def fetch_data(request: FetchRequest):
    """
    Unified entry point for social media data fetching.
    """
    platform = request.platform.lower()
    config = request.config
    
    print(f"[gather] Fetching data for {platform} with config {config}")
    
    # Placeholder logic for different platforms
    # In a real implementation, each platform's logic would be in a separate module
    
    results = []
    
    try:
        if platform == "x" or platform == "twitter":
            # TODO: Implement X crawler
            results.append(CleanItem(
                title="X Post Placeholder",
                text=f"This is a placeholder for X content based on config {config}",
                markdown=f"### X Post\n\nPlaceholder content.",
                platform="X",
                sourceId=request.source_id,
                sourceType="SOCIAL_MEDIA",
                time=datetime.now()
            ))
        elif platform == "telegram":
            # TODO: Implement Telegram crawler
            results.append(CleanItem(
                title="Telegram Message Placeholder",
                text=f"This is a placeholder for Telegram content based on config {config}",
                markdown=f"### Telegram Message\n\nPlaceholder content.",
                platform="Telegram",
                sourceId=request.source_id,
                sourceType="SOCIAL_MEDIA",
                time=datetime.now()
            ))
        elif platform == "xiaohongshu" or platform == "xhs":
            # TODO: Implement XHS crawler
            results.append(CleanItem(
                title="Xiaohongshu Note Placeholder",
                text=f"This is a placeholder for XHS content based on config {config}",
                markdown=f"### XHS Note\n\nPlaceholder content.",
                platform="Xiaohongshu",
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
