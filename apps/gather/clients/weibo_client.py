"""
Weibo (微博) Playwright client (Async version).
Uses browser authentication state to access Weibo.
"""
import asyncio
from typing import Dict, Any, AsyncGenerator, Optional
from datetime import datetime
from .base_playwright import BasePlaywrightClient


class WeiboPlaywrightClient(BasePlaywrightClient):
    """Playwright client for Weibo (微博) - Async version."""
    
    BASE_URL = "https://weibo.com"
    
    async def verify_auth(self) -> bool:
        """
        Verify if the Weibo authentication is valid.
        Checks for the presence of user profile element.
        
        Returns:
            True if authenticated, False otherwise.
        """
        try:
            # Use domcontentloaded for faster initial load
            await self.page.goto(f"{self.BASE_URL}", wait_until="domcontentloaded", timeout=60000)
            
            # Wait for page to stabilize
            await asyncio.sleep(3)
            
            print(f"[Weibo Client] Current URL: {self.page.url}")
            
            # Check for login state - look for user avatar or profile elements
            try:
                # Primary check: look for user avatar/profile in header
                user_selectors = [
                    '.gn_name',  # User name in header
                    '.WB_miniblog .gn_name',
                    'a[href*="/u/"]',  # User profile link
                    '.nav_avatar',  # Avatar in navigation
                    '[class*="avatar"]',
                    '.woo-avatar-main',  # New Weibo avatar
                    '.Nav_user_',  # New Weibo user nav
                ]
                
                for selector in user_selectors:
                    try:
                        el = await self.page.wait_for_selector(selector, timeout=5000)
                        if el:
                            print(f"[Weibo Client] Found element with selector '{selector}' - authenticated")
                            return True
                    except Exception:
                        continue
                
                # Alternative: check for login button (indicates NOT logged in)
                login_selectors = [
                    'a[href*="login"]',
                    '.gn_login',
                    'button:has-text("登录")',
                    '.LoginCard',
                ]
                
                for selector in login_selectors:
                    try:
                        login_btn = await self.page.query_selector(selector)
                        if login_btn and await login_btn.is_visible():
                            print(f"[Weibo Client] Found login button - not authenticated")
                            return False
                    except Exception:
                        continue
                
                # Try accessing personal home page
                await self.page.goto(f"{self.BASE_URL}/home", wait_until="domcontentloaded", timeout=10000)
                await asyncio.sleep(2)
                
                # If redirected to login, not authenticated
                if "login" in self.page.url.lower() or "passport" in self.page.url.lower():
                    print("[Weibo Client] Redirected to login - not authenticated")
                    return False
                
                print("[Weibo Client] Accessed home page - authenticated")
                return True
                    
            except Exception as e:
                print(f"[Weibo Client] Auth check error: {e}")
                return False
                
        except Exception as e:
            print(f"[Weibo Client] Auth verification failed: {e}")
            return False

    async def search_posts(
        self, 
        query: str, 
        max_results: int = 10,
        timeout_per_scroll: int = 2000
    ) -> AsyncGenerator[Dict[str, Any], None]:
        """
        Search for posts.
        
        Args:
            query: Search query
            max_results: Maximum number of results
            timeout_per_scroll: Milliseconds to wait after each scroll
            
        Yields:
            Post data dictionaries
        """
        # Navigate to search page
        search_url = f"{self.BASE_URL}/search?q={query}"
        await self.page.goto(search_url, wait_until="domcontentloaded")
        
        # Wait for posts to load
        try:
            await self.page.wait_for_selector('[class*="card-wrap"], [class*="Feed_body"], .WB_cardwrap', timeout=15000)
        except Exception as e:
            print(f"[Weibo Client] No posts found for query '{query}': {e}")
            return
        
        async for post in self._collect_posts(max_results, timeout_per_scroll):
            yield post

    async def get_user_posts(
        self, 
        user_id: str, 
        max_results: int = 10,
        timeout_per_scroll: int = 2000
    ) -> AsyncGenerator[Dict[str, Any], None]:
        """
        Get posts from a specific user.
        
        Args:
            user_id: Weibo user ID (uid)
            max_results: Maximum number of results
            timeout_per_scroll: Milliseconds to wait after each scroll
            
        Yields:
            Post data dictionaries
        """
        url = f"{self.BASE_URL}/u/{user_id}"
        await self.page.goto(url, wait_until="domcontentloaded")
        
        # Wait for posts to load
        try:
            await self.page.wait_for_selector('[class*="card-wrap"], [class*="Feed_body"], .WB_cardwrap', timeout=15000)
        except Exception as e:
            print(f"[Weibo Client] No posts found for user '{user_id}': {e}")
            return
        
        async for post in self._collect_posts(max_results, timeout_per_scroll):
            yield post

    async def get_hot_topics(
        self, 
        max_results: int = 10
    ) -> AsyncGenerator[Dict[str, Any], None]:
        """
        Get hot topics/trending.
        
        Args:
            max_results: Maximum number of results
            
        Yields:
            Topic data dictionaries
        """
        url = f"{self.BASE_URL}/hot/search"
        await self.page.goto(url, wait_until="domcontentloaded")
        
        try:
            await self.page.wait_for_selector('.td-02, [class*="HotTopic"], .hot-list', timeout=15000)
        except Exception as e:
            print(f"[Weibo Client] No hot topics found: {e}")
            return
        
        collected = 0
        topic_elements = await self.page.query_selector_all('.td-02 a, [class*="HotTopic"] a, .hot-list a')
        
        for topic_el in topic_elements:
            if collected >= max_results:
                break
            
            try:
                text = (await topic_el.inner_text()).strip()
                href = await topic_el.get_attribute("href")
                
                if text:
                    collected += 1
                    yield {
                        "platform": "Weibo",
                        "type": "hot_topic",
                        "title": text,
                        "url": f"{self.BASE_URL}{href}" if href and href.startswith("/") else href,
                        "fetched_at": datetime.now().isoformat(),
                    }
            except Exception:
                continue

    async def _collect_posts(
        self, 
        max_results: int,
        timeout_per_scroll: int = 2000
    ) -> AsyncGenerator[Dict[str, Any], None]:
        """Common post collection logic."""
        collected = 0
        seen_ids = set()
        
        while collected < max_results:
            # Get all post elements on the current page
            post_elements = await self.page.query_selector_all('[class*="card-wrap"], [class*="Feed_body"], .WB_cardwrap')
            
            for post_el in post_elements:
                if collected >= max_results:
                    break
                
                try:
                    post_data = await self._extract_post_data(post_el)
                    if post_data:
                        post_id = post_data.get("id") or post_data.get("content", "")[:50]
                        if post_id not in seen_ids:
                            seen_ids.add(post_id)
                            collected += 1
                            yield post_data
                except Exception as e:
                    print(f"[Weibo Client] Error extracting post: {e}")
                    continue
            
            if collected >= max_results:
                break
            
            # Scroll down to load more posts
            await self.page.evaluate("window.scrollBy(0, 800)")
            await self.page.wait_for_timeout(timeout_per_scroll)

    async def _extract_post_data(self, post_el) -> Optional[Dict[str, Any]]:
        """Extract data from a post element."""
        try:
            data = {
                "platform": "Weibo",
                "fetched_at": datetime.now().isoformat(),
            }
            
            # Try to get post ID from data attribute or link
            try:
                mid = await post_el.get_attribute("mid")
                if mid:
                    data["id"] = mid
            except Exception:
                pass
            
            # Extract post link
            link_selectors = [
                'a[href*="/detail/"]',
                'a[href*="/status/"]',
                '.WB_from a',
            ]
            for selector in link_selectors:
                try:
                    link_el = await post_el.query_selector(selector)
                    if link_el:
                        href = await link_el.get_attribute("href")
                        if href:
                            data["url"] = f"{self.BASE_URL}{href}" if href.startswith("/") else href
                            # Extract post ID from URL
                            if "/detail/" in href:
                                data["id"] = href.split("/detail/")[-1].split("?")[0]
                            elif "/status/" in href:
                                data["id"] = href.split("/status/")[-1].split("?")[0]
                        break
                except Exception:
                    continue
            
            # Extract content
            content_selectors = [
                '[class*="detail_wbtext"]',
                '[class*="Feed_body"] [class*="text"]',
                '.WB_text',
                '.txt',
            ]
            for selector in content_selectors:
                try:
                    content_el = await post_el.query_selector(selector)
                    if content_el:
                        data["content"] = (await content_el.inner_text()).strip()
                        break
                except Exception:
                    continue
            
            # Extract author
            author_selectors = [
                '[class*="head_name"]',
                '.WB_name',
                'a[class*="name"]',
                '[class*="Feed_"] [class*="name"]',
            ]
            for selector in author_selectors:
                try:
                    author_el = await post_el.query_selector(selector)
                    if author_el:
                        data["author"] = (await author_el.inner_text()).strip()
                        break
                except Exception:
                    continue
            
            # Extract engagement metrics
            stats_selectors = {
                "reposts": '[class*="repost"], .WB_handle [node-type="forward_btn"]',
                "comments": '[class*="comment"], .WB_handle [node-type="comment_btn"]',
                "likes": '[class*="like"], .WB_handle [node-type="like"]',
            }
            
            for metric_name, selector in stats_selectors.items():
                try:
                    metric_el = await post_el.query_selector(selector)
                    if metric_el:
                        text = (await metric_el.inner_text()).strip()
                        # Extract number from text like "转发 123"
                        import re
                        numbers = re.findall(r'\d+', text)
                        if numbers:
                            data[metric_name] = numbers[0]
                except Exception:
                    continue
            
            # Extract timestamp
            time_selectors = [
                '[class*="head_time"]',
                '.WB_from',
                'time',
            ]
            for selector in time_selectors:
                try:
                    time_el = await post_el.query_selector(selector)
                    if time_el:
                        data["timestamp"] = (await time_el.inner_text()).strip()
                        break
                except Exception:
                    continue
            
            # Extract images
            try:
                img_elements = await post_el.query_selector_all('[class*="pic"] img, .WB_pic img')
                images = []
                for img_el in img_elements[:4]:  # Limit to 4 images
                    src = await img_el.get_attribute("src")
                    if src:
                        images.append(src)
                if images:
                    data["images"] = images
            except Exception:
                pass
            
            return data if (data.get("content") or data.get("id")) else None
            
        except Exception:
            return None

    async def fetch_data(self, config: Dict[str, Any]) -> AsyncGenerator[Dict[str, Any], None]:
        """
        Fetch data based on configuration.
        
        Config options:
            - query: Search query
            - userId: User ID to fetch posts from
            - hotTopics: Set to true to fetch hot topics
            - maxResults: Maximum results (default 10)
        """
        max_results = config.get("maxResults", 10)
        
        if config.get("hotTopics"):
            async for topic in self.get_hot_topics(max_results):
                yield topic
        elif config.get("query"):
            async for post in self.search_posts(config["query"], max_results):
                yield post
        elif config.get("userId"):
            async for post in self.get_user_posts(config["userId"], max_results):
                yield post
        else:
            raise ValueError("Must provide one of: query, userId, or hotTopics")
