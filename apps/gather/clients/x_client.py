"""
X.com (Twitter) Playwright client (Async version).
Uses browser authentication state to access X.com.
"""
import asyncio
from typing import Dict, Any, AsyncGenerator, Optional, List
from datetime import datetime
from .base_playwright import BasePlaywrightClient


class XPlaywrightClient(BasePlaywrightClient):
    """Playwright client for X.com (Twitter) - Async version."""
    
    BASE_URL = "https://x.com"
    
    async def verify_auth(self) -> bool:
        """
        Verify if the X.com authentication is valid.
        Navigates to the home page and checks for login state.
        
        Returns:
            True if authenticated, False otherwise.
        """
        try:
            # Use domcontentloaded instead of networkidle for faster initial load
            # X.com has many background requests that can cause networkidle to timeout
            await self.page.goto(f"{self.BASE_URL}/home", wait_until="domcontentloaded", timeout=60000)
            
            # Wait a bit for any redirects and initial JS execution
            await asyncio.sleep(3)
            
            # Check current URL - if redirected to login page, not authenticated
            current_url = self.page.url
            print(f"[X Client] Current URL after navigation: {current_url}")
            
            if "login" in current_url.lower() or "i/flow" in current_url.lower():
                print("[X Client] Redirected to login page - not authenticated")
                return False
            
            # Try to find elements that only appear when logged in
            try:
                # Wait for page to stabilize
                await asyncio.sleep(2)
                
                # Check for the main navigation (only visible when logged in)
                nav_selector = 'nav[role="navigation"]'
                nav_el = await self.page.wait_for_selector(nav_selector, timeout=10000)
                
                if nav_el:
                    print("[X Client] Found navigation - user is authenticated")
                    return True
                    
            except Exception as nav_error:
                print(f"[X Client] Could not find nav element: {nav_error}")
                
                # Try alternative check - look for profile menu or avatar
                try:
                    profile_selector = '[data-testid="SideNav_AccountSwitcher_Button"], [aria-label*="Account"]'
                    profile_el = await self.page.wait_for_selector(profile_selector, timeout=5000)
                    if profile_el:
                        print("[X Client] Found profile button - user is authenticated")
                        return True
                except Exception:
                    pass
                
                return False
                
        except Exception as e:
            print(f"[X Client] Auth verification failed: {e}")
            return False

    async def search_recent(
        self, 
        query: str, 
        max_results: int = 10,
        timeout_per_scroll: int = 1000
    ) -> AsyncGenerator[Dict[str, Any], None]:
        """
        Search for recent tweets.
        
        Args:
            query: Search query
            max_results: Maximum number of results to return
            timeout_per_scroll: Milliseconds to wait after each scroll
            
        Yields:
            Tweet data dictionaries
        """
        # Navigate to search page with "Latest" filter
        search_url = f"{self.BASE_URL}/search?q={query}&src=typed_query&f=live"
        await self.page.goto(search_url)
        
        # Wait for tweets to load
        try:
            await self.page.wait_for_selector('article[data-testid="tweet"]', timeout=15000)
        except Exception as e:
            print(f"[X Client] No tweets found for query '{query}': {e}")
            return
        
        collected = 0
        seen_texts = set()
        
        while collected < max_results:
            # Get all tweet elements on the current page
            tweet_elements = await self.page.query_selector_all('article[data-testid="tweet"]')
            
            for tweet_el in tweet_elements:
                if collected >= max_results:
                    break
                
                try:
                    tweet_data = await self._extract_tweet_data(tweet_el)
                    if tweet_data and tweet_data.get("text"):
                        text = tweet_data["text"]
                        if text not in seen_texts:
                            seen_texts.add(text)
                            collected += 1
                            yield tweet_data
                except Exception as e:
                    print(f"[X Client] Error extracting tweet: {e}")
                    continue
            
            if collected >= max_results:
                break
            
            # Scroll down to load more tweets
            await self.page.evaluate("window.scrollBy(0, 1000)")
            await self.page.wait_for_timeout(timeout_per_scroll)

    async def get_user_tweets(
        self, 
        username: str, 
        max_results: int = 10,
        include_replies: bool = False
    ) -> AsyncGenerator[Dict[str, Any], None]:
        """
        Get tweets from a specific user.
        
        Args:
            username: X.com username (without @)
            max_results: Maximum number of results
            include_replies: Whether to include replies
            
        Yields:
            Tweet data dictionaries
        """
        username = username.lstrip("@")
        url = f"{self.BASE_URL}/{username}"
        if include_replies:
            url = f"{url}/with_replies"
        
        await self.page.goto(url)
        
        try:
            await self.page.wait_for_selector('article[data-testid="tweet"]', timeout=15000)
        except Exception as e:
            print(f"[X Client] No tweets found for user '{username}': {e}")
            return
        
        async for tweet in self._collect_tweets(max_results):
            yield tweet

    async def get_list_tweets(
        self, 
        list_id: str, 
        max_results: int = 10
    ) -> AsyncGenerator[Dict[str, Any], None]:
        """
        Get tweets from a specific list.
        
        Args:
            list_id: X.com list ID
            max_results: Maximum number of results
            
        Yields:
            Tweet data dictionaries
        """
        url = f"{self.BASE_URL}/i/lists/{list_id}"
        await self.page.goto(url)
        
        try:
            await self.page.wait_for_selector('article[data-testid="tweet"]', timeout=15000)
        except Exception as e:
            print(f"[X Client] No tweets found for list '{list_id}': {e}")
            return
        
        async for tweet in self._collect_tweets(max_results):
            yield tweet

    async def _collect_tweets(self, max_results: int) -> AsyncGenerator[Dict[str, Any], None]:
        """Common tweet collection logic."""
        collected = 0
        seen_texts = set()
        
        while collected < max_results:
            tweet_elements = await self.page.query_selector_all('article[data-testid="tweet"]')
            
            for tweet_el in tweet_elements:
                if collected >= max_results:
                    break
                
                try:
                    tweet_data = await self._extract_tweet_data(tweet_el)
                    if tweet_data and tweet_data.get("text"):
                        text = tweet_data["text"]
                        if text not in seen_texts:
                            seen_texts.add(text)
                            collected += 1
                            yield tweet_data
                except Exception:
                    continue
            
            if collected >= max_results:
                break
            
            await self.page.evaluate("window.scrollBy(0, 1000)")
            await self.page.wait_for_timeout(1000)

    async def _extract_tweet_data(self, tweet_el) -> Optional[Dict[str, Any]]:
        """Extract data from a tweet element."""
        try:
            data = {
                "platform": "X",
                "fetched_at": datetime.now().isoformat(),
            }
            
            # Extract tweet text
            text_el = await tweet_el.query_selector('[data-testid="tweetText"]')
            if text_el:
                data["text"] = await text_el.inner_text()
            
            # Extract username
            user_el = await tweet_el.query_selector('a[role="link"][href^="/"]')
            if user_el:
                href = await user_el.get_attribute("href")
                if href:
                    data["username"] = href.strip("/").split("/")[0]
            
            # Extract display name
            name_el = await tweet_el.query_selector('a[role="link"] span')
            if name_el:
                data["display_name"] = await name_el.inner_text()
            
            # Extract timestamp
            time_el = await tweet_el.query_selector("time")
            if time_el:
                datetime_attr = await time_el.get_attribute("datetime")
                if datetime_attr:
                    data["timestamp"] = datetime_attr
            
            # Extract tweet URL
            link_el = await tweet_el.query_selector('a[href*="/status/"]')
            if link_el:
                href = await link_el.get_attribute("href")
                if href:
                    data["url"] = f"{self.BASE_URL}{href}" if href.startswith("/") else href
            
            return data if data.get("text") else None
            
        except Exception:
            return None

    async def fetch_data(self, config: Dict[str, Any]) -> AsyncGenerator[Dict[str, Any], None]:
        """
        Fetch data based on configuration.
        
        Config options:
            - user: Username to fetch tweets from
            - listId: List ID to fetch tweets from  
            - query: Search query
            - maxResults: Maximum results (default 10)
        """
        max_results = config.get("maxResults", 10)
        
        if config.get("query"):
            async for tweet in self.search_recent(config["query"], max_results):
                yield tweet
        elif config.get("user"):
            async for tweet in self.get_user_tweets(config["user"], max_results):
                yield tweet
        elif config.get("listId"):
            async for tweet in self.get_list_tweets(config["listId"], max_results):
                yield tweet
        else:
            raise ValueError("Must provide one of: query, user, or listId")
