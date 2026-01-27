"""
Instagram Playwright client (Async version).
Uses browser storage state (cookies) for authentication.
"""
from typing import Dict, Any, AsyncGenerator, Optional
from datetime import datetime
from clients.base_playwright import BasePlaywrightClient


class InstagramPlaywrightClient(BasePlaywrightClient):
    """Playwright client for Instagram - Async version."""
    
    BASE_URL = "https://www.instagram.com"
    
    async def verify_auth(self) -> bool:
        """
        Verify if the Instagram authentication is valid.
        Checks for the presence of the profile link or main nav.
        
        Returns:
            True if authenticated, False otherwise.
        """
        try:
            await self.page.goto(self.BASE_URL, wait_until="domcontentloaded")
            
            # Instagram often shows a login modal or redirects to /accounts/login if not authenticated
            # Check for common logged-in elements
            logged_in_selectors = [
                'svg[aria-label="Home"]',
                'svg[aria-label="New post"]',
                'svg[aria-label="Direct messaging"]',
                'img[alt*="profile picture"]',
                'a[href*="/direct/inbox/"]',
            ]
            
            for selector in logged_in_selectors:
                try:
                    el = await self.page.wait_for_selector(selector, timeout=5000)
                    if el:
                        print(f"[Instagram Client] Found element with selector '{selector}' - authenticated")
                        return True
                except Exception:
                    continue
            
            # Check current URL
            current_url = self.page.url
            if "/accounts/login" in current_url:
                print(f"[Instagram Client] Redirected to login page: {current_url}")
                return False
                
            print(f"[Instagram Client] Auth state unclear, URL: {current_url}")
            return False
                    
        except Exception as e:
            print(f"[Instagram Client] Auth verification failed: {e}")
            return False

    async def fetch_data(self, config: Dict[str, Any]) -> AsyncGenerator[Dict[str, Any], None]:
        """
        Fetch data based on configuration.
        
        Config options:
            - username: Instagram username to fetch posts from
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
        """Fetch posts from a user profile."""
        profile_url = f"{self.BASE_URL}/{username}/"
        await self.page.goto(profile_url, wait_until="networkidle")
        
        collected = 0
        seen_urls = set()
        
        while collected < max_results:
            # Get all post links
            post_links = await self.page.query_selector_all('a[href*="/p/"]')
            
            for link in post_links:
                if collected >= max_results:
                    break
                    
                href = await link.get_attribute("href")
                if href and href not in seen_urls:
                    seen_urls.add(href)
                    
                    # Basic data extraction (link and maybe caption from alt text)
                    img_el = await link.query_selector('img')
                    caption = ""
                    if img_el:
                        caption = await img_el.get_attribute("alt") or ""
                    
                    data = {
                        "platform": "Instagram",
                        "url": f"{self.BASE_URL}{href}" if not href.startswith("http") else href,
                        "text": caption,
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
            
            # Check if we can't scroll anymore or no new items found
            # (Simplistic check for now)
