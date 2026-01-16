"""
Reddit Playwright client (Async version).
Uses browser authentication state to access Reddit.
"""
import asyncio
from typing import Dict, Any, AsyncGenerator, Optional
from datetime import datetime
from .base_playwright import BasePlaywrightClient


class RedditPlaywrightClient(BasePlaywrightClient):
    """Playwright client for Reddit - Async version."""
    
    BASE_URL = "https://www.reddit.com"
    
    async def verify_auth(self) -> bool:
        """
        Verify if the Reddit authentication is valid.
        Navigates to the home page and checks for login state.
        
        Returns:
            True if authenticated, False otherwise.
        """
        try:
            # Use domcontentloaded for faster initial load
            await self.page.goto(f"{self.BASE_URL}", wait_until="domcontentloaded", timeout=60000)
            
            # Wait for page to stabilize
            await asyncio.sleep(3)
            
            print(f"[Reddit Client] Current URL: {self.page.url}")
            
            # Check for login state - look for user menu or avatar
            try:
                # Primary check: look for user dropdown/menu button (logged-in users have this)
                user_menu_selectors = [
                    '#USER_DROPDOWN_ID',  # New Reddit user dropdown
                    'button[id*="USER_DROPDOWN"]',
                    '[data-testid="user-drawer-button"]',
                    'a[href*="/user/"]',  # User profile link
                    '#header-bottom-right .user',  # Old Reddit
                    '.header-user-dropdown',
                ]
                
                for selector in user_menu_selectors:
                    try:
                        el = await self.page.wait_for_selector(selector, timeout=5000)
                        if el:
                            print(f"[Reddit Client] Found element with selector '{selector}' - authenticated")
                            return True
                    except Exception:
                        continue
                
                # Alternative: check for login button (indicates NOT logged in)
                login_selectors = [
                    'a[href*="login"]',
                    'button:has-text("Log In")',
                    '[data-testid="login-button"]',
                ]
                
                for selector in login_selectors:
                    try:
                        login_btn = await self.page.query_selector(selector)
                        if login_btn and await login_btn.is_visible():
                            print(f"[Reddit Client] Found login button - not authenticated")
                            return False
                    except Exception:
                        continue
                
                # If we can't determine, try navigating to a user-only page
                await self.page.goto(f"{self.BASE_URL}/settings", wait_until="domcontentloaded", timeout=10000)
                await asyncio.sleep(2)
                
                # If redirected to login, not authenticated
                if "login" in self.page.url.lower():
                    print("[Reddit Client] Redirected to login - not authenticated")
                    return False
                
                print("[Reddit Client] Accessed settings page - authenticated")
                return True
                    
            except Exception as e:
                print(f"[Reddit Client] Auth check error: {e}")
                return False
                
        except Exception as e:
            print(f"[Reddit Client] Auth verification failed: {e}")
            return False

    async def get_subreddit_posts(
        self, 
        subreddit: str, 
        sort: str = "hot",
        max_results: int = 10,
        timeout_per_scroll: int = 1500
    ) -> AsyncGenerator[Dict[str, Any], None]:
        """
        Get posts from a specific subreddit.
        
        Args:
            subreddit: Subreddit name (without r/)
            sort: Sort method (hot, new, top, rising)
            max_results: Maximum number of results
            timeout_per_scroll: Milliseconds to wait after each scroll
            
        Yields:
            Post data dictionaries
        """
        subreddit = subreddit.lstrip("r/")
        url = f"{self.BASE_URL}/r/{subreddit}/{sort}"
        
        await self.page.goto(url, wait_until="domcontentloaded")
        
        # Wait for posts to load
        try:
            await self.page.wait_for_selector('[data-testid="post-container"], .Post', timeout=15000)
        except Exception as e:
            print(f"[Reddit Client] No posts found for r/{subreddit}: {e}")
            return
        
        async for post in self._collect_posts(max_results, timeout_per_scroll):
            yield post

    async def search_posts(
        self, 
        query: str, 
        subreddit: Optional[str] = None,
        sort: str = "relevance",
        max_results: int = 10,
        timeout_per_scroll: int = 1500
    ) -> AsyncGenerator[Dict[str, Any], None]:
        """
        Search for posts.
        
        Args:
            query: Search query
            subreddit: Optional subreddit to search within
            sort: Sort method (relevance, hot, top, new, comments)
            max_results: Maximum number of results
            timeout_per_scroll: Milliseconds to wait after each scroll
            
        Yields:
            Post data dictionaries
        """
        if subreddit:
            subreddit = subreddit.lstrip("r/")
            url = f"{self.BASE_URL}/r/{subreddit}/search?q={query}&restrict_sr=1&sort={sort}"
        else:
            url = f"{self.BASE_URL}/search?q={query}&sort={sort}"
        
        await self.page.goto(url, wait_until="domcontentloaded")
        
        # Wait for posts to load
        try:
            await self.page.wait_for_selector('[data-testid="post-container"], .Post, .search-result', timeout=15000)
        except Exception as e:
            print(f"[Reddit Client] No posts found for query '{query}': {e}")
            return
        
        async for post in self._collect_posts(max_results, timeout_per_scroll):
            yield post

    async def get_user_posts(
        self, 
        username: str, 
        max_results: int = 10,
        timeout_per_scroll: int = 1500
    ) -> AsyncGenerator[Dict[str, Any], None]:
        """
        Get posts from a specific user.
        
        Args:
            username: Reddit username (without u/)
            max_results: Maximum number of results
            timeout_per_scroll: Milliseconds to wait after each scroll
            
        Yields:
            Post data dictionaries
        """
        username = username.lstrip("u/")
        url = f"{self.BASE_URL}/user/{username}/posts"
        
        await self.page.goto(url, wait_until="domcontentloaded")
        
        # Wait for posts to load
        try:
            await self.page.wait_for_selector('[data-testid="post-container"], .Post', timeout=15000)
        except Exception as e:
            print(f"[Reddit Client] No posts found for u/{username}: {e}")
            return
        
        async for post in self._collect_posts(max_results, timeout_per_scroll):
            yield post

    async def _collect_posts(
        self, 
        max_results: int,
        timeout_per_scroll: int = 1500
    ) -> AsyncGenerator[Dict[str, Any], None]:
        """Common post collection logic."""
        collected = 0
        seen_ids = set()
        
        while collected < max_results:
            # Get all post elements on the current page (new Reddit)
            post_elements = await self.page.query_selector_all('[data-testid="post-container"], .Post')
            
            for post_el in post_elements:
                if collected >= max_results:
                    break
                
                try:
                    post_data = await self._extract_post_data(post_el)
                    if post_data:
                        post_id = post_data.get("id") or post_data.get("title", "")
                        if post_id not in seen_ids:
                            seen_ids.add(post_id)
                            collected += 1
                            yield post_data
                except Exception as e:
                    print(f"[Reddit Client] Error extracting post: {e}")
                    continue
            
            if collected >= max_results:
                break
            
            # Scroll down to load more posts
            await self.page.evaluate("window.scrollBy(0, 1000)")
            await self.page.wait_for_timeout(timeout_per_scroll)

    async def _extract_post_data(self, post_el) -> Optional[Dict[str, Any]]:
        """Extract data from a post element."""
        try:
            data = {
                "platform": "Reddit",
                "fetched_at": datetime.now().isoformat(),
            }
            
            # Try to get post ID from data attribute or link
            try:
                post_id = await post_el.get_attribute("id")
                if post_id:
                    data["id"] = post_id
            except Exception:
                pass
            
            # Extract title
            title_selectors = [
                'h3',
                '[data-adclicklocation="title"]',
                'a[data-click-id="body"]',
                '.title a',
            ]
            for selector in title_selectors:
                try:
                    title_el = await post_el.query_selector(selector)
                    if title_el:
                        data["title"] = (await title_el.inner_text()).strip()
                        break
                except Exception:
                    continue
            
            # Extract post link
            link_selectors = [
                'a[data-click-id="body"]',
                'a[href*="/comments/"]',
                '.title a',
            ]
            for selector in link_selectors:
                try:
                    link_el = await post_el.query_selector(selector)
                    if link_el:
                        href = await link_el.get_attribute("href")
                        if href:
                            data["url"] = f"{self.BASE_URL}{href}" if href.startswith("/") else href
                            # Extract post ID from URL
                            if "/comments/" in href:
                                parts = href.split("/comments/")
                                if len(parts) > 1:
                                    data["id"] = parts[1].split("/")[0]
                        break
                except Exception:
                    continue
            
            # Extract subreddit
            subreddit_selectors = [
                'a[href^="/r/"]',
                '[data-testid="subreddit-name"]',
            ]
            for selector in subreddit_selectors:
                try:
                    sub_el = await post_el.query_selector(selector)
                    if sub_el:
                        sub_text = await sub_el.inner_text()
                        data["subreddit"] = sub_text.strip()
                        break
                except Exception:
                    continue
            
            # Extract author
            author_selectors = [
                'a[href^="/user/"]',
                '[data-testid="post_author_link"]',
            ]
            for selector in author_selectors:
                try:
                    author_el = await post_el.query_selector(selector)
                    if author_el:
                        author_text = await author_el.inner_text()
                        data["author"] = author_text.strip()
                        break
                except Exception:
                    continue
            
            # Extract score/upvotes
            score_selectors = [
                '[data-testid="vote-score"]',
                '.score',
                '[id*="score"]',
            ]
            for selector in score_selectors:
                try:
                    score_el = await post_el.query_selector(selector)
                    if score_el:
                        score_text = await score_el.inner_text()
                        data["score"] = score_text.strip()
                        break
                except Exception:
                    continue
            
            # Extract comment count
            comment_selectors = [
                'a[data-click-id="comments"]',
                '[data-testid="comments-link"]',
            ]
            for selector in comment_selectors:
                try:
                    comment_el = await post_el.query_selector(selector)
                    if comment_el:
                        comment_text = await comment_el.inner_text()
                        data["comments"] = comment_text.strip()
                        break
                except Exception:
                    continue
            
            # Extract timestamp
            time_selectors = [
                'time',
                '[data-testid="post-timestamp"]',
            ]
            for selector in time_selectors:
                try:
                    time_el = await post_el.query_selector(selector)
                    if time_el:
                        datetime_attr = await time_el.get_attribute("datetime")
                        if datetime_attr:
                            data["timestamp"] = datetime_attr
                        else:
                            data["timestamp"] = (await time_el.inner_text()).strip()
                        break
                except Exception:
                    continue
            
            return data if (data.get("title") or data.get("id")) else None
            
        except Exception:
            return None

    async def fetch_data(self, config: Dict[str, Any]) -> AsyncGenerator[Dict[str, Any], None]:
        """
        Fetch data based on configuration.
        
        Config options:
            - subreddit: Subreddit to fetch posts from
            - sort: Sort method (hot, new, top, rising) - default: hot
            - query: Search query
            - username: User to fetch posts from
            - maxResults: Maximum results (default 10)
        """
        max_results = config.get("maxResults", 10)
        sort = config.get("sort", "hot")
        
        if config.get("query"):
            subreddit = config.get("subreddit")
            async for post in self.search_posts(config["query"], subreddit, sort, max_results):
                yield post
        elif config.get("username"):
            async for post in self.get_user_posts(config["username"], max_results):
                yield post
        elif config.get("subreddit"):
            async for post in self.get_subreddit_posts(config["subreddit"], sort, max_results):
                yield post
        else:
            raise ValueError("Must provide one of: subreddit, query, or username")
