"""
Douyin (抖音) Playwright client (Async version).
Uses browser authentication state to access Douyin.
"""
import asyncio
from typing import Dict, Any, AsyncGenerator, Optional
from datetime import datetime
from .base_playwright import BasePlaywrightClient


class DouyinPlaywrightClient(BasePlaywrightClient):
    """Playwright client for Douyin (抖音) - Async version."""
    
    BASE_URL = "https://www.douyin.com"
    
    async def verify_auth(self) -> bool:
        """
        Verify if the Douyin authentication is valid.
        Checks for the presence of user profile element.
        
        Returns:
            True if authenticated, False otherwise.
        """
        try:
            # Use domcontentloaded for faster initial load
            await self.page.goto(f"{self.BASE_URL}", wait_until="domcontentloaded", timeout=60000)
            
            # Wait for page to stabilize
            await asyncio.sleep(3)
            
            print(f"[Douyin Client] Current URL: {self.page.url}")
            
            # Check for login state - look for user avatar or profile elements
            try:
                # Primary check: look for user avatar/profile in header
                user_selectors = [
                    '.avatar-wrapper',  # User avatar
                    '[class*="avatar"]',
                    '.user-avatar',
                    'a[href*="/user/"]',  # User profile link
                    '[class*="login-avatar"]',
                ]
                
                for selector in user_selectors:
                    try:
                        el = await self.page.wait_for_selector(selector, timeout=5000)
                        if el:
                            print(f"[Douyin Client] Found element with selector '{selector}' - authenticated")
                            return True
                    except Exception:
                        continue
                
                # Alternative: check for login button (indicates NOT logged in)
                login_selectors = [
                    'button:has-text("登录")',
                    '[class*="login-btn"]',
                    'a:has-text("登录")',
                ]
                
                for selector in login_selectors:
                    try:
                        login_btn = await self.page.query_selector(selector)
                        if login_btn and await login_btn.is_visible():
                            print(f"[Douyin Client] Found login button - not authenticated")
                            return False
                    except Exception:
                        continue
                
                # Try accessing user center
                await self.page.goto(f"{self.BASE_URL}/user/self", wait_until="domcontentloaded", timeout=10000)
                await asyncio.sleep(2)
                
                # If redirected to login, not authenticated
                if "login" in self.page.url.lower() or "passport" in self.page.url.lower():
                    print("[Douyin Client] Redirected to login - not authenticated")
                    return False
                
                print("[Douyin Client] Accessed user page - authenticated")
                return True
                    
            except Exception as e:
                print(f"[Douyin Client] Auth check error: {e}")
                return False
                
        except Exception as e:
            print(f"[Douyin Client] Auth verification failed: {e}")
            return False

    async def search_videos(
        self, 
        query: str, 
        max_results: int = 10,
        timeout_per_scroll: int = 2000
    ) -> AsyncGenerator[Dict[str, Any], None]:
        """
        Search for videos.
        
        Args:
            query: Search query
            max_results: Maximum number of results
            timeout_per_scroll: Milliseconds to wait after each scroll
            
        Yields:
            Video data dictionaries
        """
        # Navigate to search page
        search_url = f"{self.BASE_URL}/search/{query}?type=video"
        await self.page.goto(search_url, wait_until="domcontentloaded")
        
        # Wait for videos to load
        try:
            await self.page.wait_for_selector('[class*="video-card"], [class*="search-result"]', timeout=15000)
        except Exception as e:
            print(f"[Douyin Client] No videos found for query '{query}': {e}")
            return
        
        async for video in self._collect_videos(max_results, timeout_per_scroll):
            yield video

    async def get_user_videos(
        self, 
        user_id: str, 
        max_results: int = 10,
        timeout_per_scroll: int = 2000
    ) -> AsyncGenerator[Dict[str, Any], None]:
        """
        Get videos from a specific user.
        
        Args:
            user_id: Douyin user ID or sec_uid
            max_results: Maximum number of results
            timeout_per_scroll: Milliseconds to wait after each scroll
            
        Yields:
            Video data dictionaries
        """
        url = f"{self.BASE_URL}/user/{user_id}"
        await self.page.goto(url, wait_until="domcontentloaded")
        
        # Wait for videos to load
        try:
            await self.page.wait_for_selector('[class*="video-card"], [class*="user-video"]', timeout=15000)
        except Exception as e:
            print(f"[Douyin Client] No videos found for user '{user_id}': {e}")
            return
        
        async for video in self._collect_videos(max_results, timeout_per_scroll):
            yield video

    async def get_video_detail(self, video_id: str) -> Optional[Dict[str, Any]]:
        """
        Get detailed content of a specific video.
        
        Args:
            video_id: Video ID
            
        Returns:
            Video detail data or None
        """
        try:
            url = f"{self.BASE_URL}/video/{video_id}"
            await self.page.goto(url, wait_until="domcontentloaded")
            
            # Wait for content to load
            await self.page.wait_for_selector('[class*="video-container"], video', timeout=15000)
            await asyncio.sleep(2)
            
            data = {
                "id": video_id,
                "platform": "Douyin",
                "url": url,
                "fetched_at": datetime.now().isoformat(),
            }
            
            # Extract title/description
            desc_selectors = [
                '[class*="video-info-detail"] span',
                '[class*="desc"]',
                '.video-desc',
            ]
            for selector in desc_selectors:
                try:
                    desc_el = await self.page.query_selector(selector)
                    if desc_el:
                        data["description"] = (await desc_el.inner_text()).strip()
                        break
                except Exception:
                    continue
            
            # Extract author info
            author_selectors = [
                '[class*="author-name"]',
                '[class*="nickname"]',
                'a[href*="/user/"] span',
            ]
            for selector in author_selectors:
                try:
                    author_el = await self.page.query_selector(selector)
                    if author_el:
                        data["author"] = (await author_el.inner_text()).strip()
                        break
                except Exception:
                    continue
            
            # Extract engagement metrics
            stats_selectors = {
                "likes": '[class*="like-count"], [class*="digg-count"]',
                "comments": '[class*="comment-count"]',
                "shares": '[class*="share-count"]',
            }
            
            for metric_name, selector in stats_selectors.items():
                try:
                    metric_el = await self.page.query_selector(selector)
                    if metric_el:
                        data[metric_name] = (await metric_el.inner_text()).strip()
                except Exception:
                    continue
            
            return data
            
        except Exception as e:
            print(f"[Douyin Client] Error getting video detail: {e}")
            return None

    async def _collect_videos(
        self, 
        max_results: int,
        timeout_per_scroll: int = 2000
    ) -> AsyncGenerator[Dict[str, Any], None]:
        """Common video collection logic."""
        collected = 0
        seen_ids = set()
        
        while collected < max_results:
            # Get all video elements on the current page
            video_elements = await self.page.query_selector_all('[class*="video-card"], [class*="search-result-card"]')
            
            for video_el in video_elements:
                if collected >= max_results:
                    break
                
                try:
                    video_data = await self._extract_video_data(video_el)
                    if video_data:
                        video_id = video_data.get("id") or video_data.get("title", "")
                        if video_id not in seen_ids:
                            seen_ids.add(video_id)
                            collected += 1
                            yield video_data
                except Exception as e:
                    print(f"[Douyin Client] Error extracting video: {e}")
                    continue
            
            if collected >= max_results:
                break
            
            # Scroll down to load more videos
            await self.page.evaluate("window.scrollBy(0, 800)")
            await self.page.wait_for_timeout(timeout_per_scroll)

    async def _extract_video_data(self, video_el) -> Optional[Dict[str, Any]]:
        """Extract data from a video element."""
        try:
            data = {
                "platform": "Douyin",
                "fetched_at": datetime.now().isoformat(),
            }
            
            # Try to get video link and ID
            link_selectors = [
                'a[href*="/video/"]',
                'a[href*="modal_id"]',
            ]
            for selector in link_selectors:
                try:
                    link_el = await video_el.query_selector(selector)
                    if link_el:
                        href = await link_el.get_attribute("href")
                        if href:
                            data["url"] = f"{self.BASE_URL}{href}" if href.startswith("/") else href
                            # Extract video ID from URL
                            if "/video/" in href:
                                parts = href.split("/video/")
                                if len(parts) > 1:
                                    data["id"] = parts[1].split("?")[0].split("/")[0]
                        break
                except Exception:
                    continue
            
            # Extract title/description
            title_selectors = [
                '[class*="title"]',
                '[class*="desc"]',
                'span',
            ]
            for selector in title_selectors:
                try:
                    title_el = await video_el.query_selector(selector)
                    if title_el:
                        text = (await title_el.inner_text()).strip()
                        if text and len(text) > 2:  # Avoid empty or very short text
                            data["title"] = text
                            break
                except Exception:
                    continue
            
            # Extract author
            author_selectors = [
                '[class*="author"]',
                '[class*="nickname"]',
                'a[href*="/user/"]',
            ]
            for selector in author_selectors:
                try:
                    author_el = await video_el.query_selector(selector)
                    if author_el:
                        data["author"] = (await author_el.inner_text()).strip()
                        break
                except Exception:
                    continue
            
            # Extract like count
            like_selectors = [
                '[class*="like"]',
                '[class*="digg"]',
            ]
            for selector in like_selectors:
                try:
                    like_el = await video_el.query_selector(selector)
                    if like_el:
                        like_text = (await like_el.inner_text()).strip()
                        if like_text:
                            data["likes"] = like_text
                            break
                except Exception:
                    continue
            
            # Extract cover image
            try:
                img_el = await video_el.query_selector('img')
                if img_el:
                    data["cover_image"] = await img_el.get_attribute("src")
            except Exception:
                pass
            
            return data if (data.get("title") or data.get("id")) else None
            
        except Exception:
            return None

    async def fetch_data(self, config: Dict[str, Any]) -> AsyncGenerator[Dict[str, Any], None]:
        """
        Fetch data based on configuration.
        
        Config options:
            - query: Search query
            - userId: User ID to fetch videos from
            - videoId: Specific video ID to fetch
            - maxResults: Maximum results (default 10)
        """
        max_results = config.get("maxResults", 10)
        
        if config.get("videoId"):
            detail = await self.get_video_detail(config["videoId"])
            if detail:
                yield detail
        elif config.get("query"):
            async for video in self.search_videos(config["query"], max_results):
                yield video
        elif config.get("userId"):
            async for video in self.get_user_videos(config["userId"], max_results):
                yield video
        else:
            raise ValueError("Must provide one of: query, userId, or videoId")
