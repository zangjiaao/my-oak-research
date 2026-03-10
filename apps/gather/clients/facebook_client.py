"""
Facebook Playwright client (Async version).
Uses browser storage state (cookies) for authentication.
"""
from typing import Dict, Any, AsyncGenerator, Optional
from datetime import datetime
from clients.base_playwright import BasePlaywrightClient


class FacebookPlaywrightClient(BasePlaywrightClient):
    """Playwright client for Facebook - Async version."""
    
    BASE_URL = "https://www.facebook.com"
    
    async def verify_auth(self) -> bool:
        """
        Verify if the Facebook authentication is valid.
        Checks for the presence of common logged-in elements.
        
        Returns:
            True if authenticated, False otherwise.
        """
        try:
            await self.page.goto(self.BASE_URL, wait_until="domcontentloaded")
            
            # Facebook logged-in selectors
            logged_in_selectors = [
                'a[aria-label="Home"]',
                'div[aria-label="Account"]',
                'div[aria-label="Your profile"]',
                'input[placeholder*="Search Facebook"]',
                'a[href="/"]',
            ]
            
            for selector in logged_in_selectors:
                try:
                    el = await self.page.wait_for_selector(selector, timeout=5000)
                    if el:
                        print(f"[Facebook Client] Found element with selector '{selector}' - authenticated")
                        return True
                except Exception:
                    continue
            
            # Check current URL
            current_url = self.page.url
            if "login.php" in current_url or "/login/" in current_url:
                print(f"[Facebook Client] Redirected to login page: {current_url}")
                return False
                
            print(f"[Facebook Client] Auth state unclear, URL: {current_url}")
            return False
                    
        except Exception as e:
            print(f"[Facebook Client] Auth verification failed: {e}")
            return False

    async def fetch_data(self, config: Dict[str, Any]) -> AsyncGenerator[Dict[str, Any], None]:
        """
        Fetch data based on configuration.
        
        Config options:
            - username: Facebook page ID or username
            - query: Search keywords
            - maxResults: Maximum results (default 20)
        """
        max_results = config.get("maxResults", 20)
        username = config.get("username")
        query = config.get("query")
        
        if username:
            async for post in self.get_user_posts(username, max_results):
                yield post
        elif query:
            # Search logic could go here
            pass
        else:
            # Home feed or generic fetch
            pass

    async def get_user_posts(self, username: str, max_results: int = 20) -> AsyncGenerator[Dict[str, Any], None]:
        """Fetch posts from a Facebook profile or page."""
        profile_url = f"{self.BASE_URL}/{username}/"
        await self.page.goto(profile_url, wait_until="networkidle")
        
        collected = 0
        seen_urls = set()
        
        while collected < max_results:
            # Get all post links or containers
            # Facebook post containers usually have data-ad-comet-preview="message" or similar
            post_containers = await self.page.query_selector_all('div[role="main"] div[data-ad-preview="message"]')
            
            # If nothing found, try a wider selector
            if not post_containers:
                post_containers = await self.page.query_selector_all('div[role="article"]')

            for container in post_containers:
                if collected >= max_results:
                    break
                
                # Try to find a link to the post
                link_el = await container.query_selector('a[href*="/posts/"], a[href*="/permalink.php"]')
                if not link_el:
                    link_el = await container.query_selector('a[href*="/photos/"]')
                
                href = ""
                if link_el:
                    href = await link_el.get_attribute("href") or ""
                
                # Use a combined key of text content if no href
                text_content = await container.inner_text()
                if not text_content:
                    continue
                    
                item_key = href or text_content[:50]
                
                if item_key not in seen_urls:
                    seen_urls.add(item_key)
                    
                    data = {
                        "platform": "Facebook",
                        "url": href if href.startswith("http") else f"{self.BASE_URL}{href}" if href else profile_url,
                        "text": text_content,
                        "author": username,
                        "fetched_at": datetime.now().isoformat(),
                    }
                    
                    collected += 1
                    yield data
            
            if collected >= max_results:
                break
                
            # Scroll down to load more
            await self.page.evaluate("window.scrollBy(0, 1000)")
            await self.page.wait_for_timeout(2000)
            
            # check if we reached end of page
            # (Simplistic check)
