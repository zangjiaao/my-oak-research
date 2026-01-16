"""
Xiaohongshu (小红书) Playwright client (Async version).
Uses browser authentication state to access Xiaohongshu.
"""
import asyncio
from typing import Dict, Any, AsyncGenerator, Optional
from datetime import datetime
from .base_playwright import BasePlaywrightClient


class XiaohongshuPlaywrightClient(BasePlaywrightClient):
    """Playwright client for Xiaohongshu (小红书) - Async version."""
    
    BASE_URL = "https://www.xiaohongshu.com"
    
    async def verify_auth(self) -> bool:
        """
        Verify if the Xiaohongshu authentication is valid.
        Checks for the presence of user profile element in sidebar.
        
        Returns:
            True if authenticated, False otherwise.
        """
        try:
            # Use domcontentloaded for faster initial load
            await self.page.goto(f"{self.BASE_URL}/explore", wait_until="domcontentloaded", timeout=60000)
            
            # Wait for page to stabilize
            await asyncio.sleep(3)
            
            print(f"[Xiaohongshu Client] Current URL: {self.page.url}")
            
            # Check for login state - look for the user sidebar component
            # This element appears when user is logged in: 
            # <li class="user side-bar-component"> with a link to /user/profile/xxx
            try:
                # Primary check: look for the sidebar user component
                user_sidebar_selector = 'li.user.side-bar-component'
                user_el = await self.page.wait_for_selector(user_sidebar_selector, timeout=10000)
                
                if user_el:
                    # Verify it contains a profile link
                    profile_link = await user_el.query_selector('a[href*="/user/profile/"]')
                    if profile_link:
                        print("[Xiaohongshu Client] Found user sidebar with profile link - authenticated")
                        return True
                    
                    # Even without profile link, if sidebar user exists, likely logged in
                    print("[Xiaohongshu Client] Found user sidebar element - authenticated")
                    return True
                    
            except Exception as primary_error:
                print(f"[Xiaohongshu Client] Primary selector failed: {primary_error}")
                
                # Alternative check: look for user avatar in header/sidebar
                try:
                    alt_selectors = [
                        'a[href*="/user/profile/"] .reds-avatar',  # Avatar with profile link
                        '.side-bar-user',
                        '[class*="user"] [class*="avatar"]',
                        'a[title="我"]',  # "Me" link
                    ]
                    
                    for selector in alt_selectors:
                        try:
                            el = await self.page.wait_for_selector(selector, timeout=3000)
                            if el:
                                print(f"[Xiaohongshu Client] Found element with selector '{selector}' - authenticated")
                                return True
                        except Exception:
                            continue
                            
                except Exception as alt_error:
                    print(f"[Xiaohongshu Client] Alternative selectors failed: {alt_error}")
            
            # Check if login modal is showing (indicates not logged in)
            try:
                login_modal = await self.page.query_selector('.login-modal, [class*="login-container"], .login-btn')
                if login_modal and await login_modal.is_visible():
                    print("[Xiaohongshu Client] Login modal visible - not authenticated")
                    return False
            except Exception:
                pass
            
            print("[Xiaohongshu Client] Could not find authentication indicators")
            return False
                
        except Exception as e:
            print(f"[Xiaohongshu Client] Auth verification failed: {e}")
            return False

    async def search_notes(
        self, 
        query: str, 
        max_results: int = 10,
        timeout_per_scroll: int = 1500
    ) -> AsyncGenerator[Dict[str, Any], None]:
        """
        Search for notes.
        
        Args:
            query: Search query
            max_results: Maximum number of results
            timeout_per_scroll: Milliseconds to wait after each scroll
            
        Yields:
            Note data dictionaries
        """
        # Navigate to search page
        search_url = f"{self.BASE_URL}/search_result?keyword={query}"
        await self.page.goto(search_url)
        
        # Wait for notes to load
        try:
            # Wait for note cards to appear
            await self.page.wait_for_selector('.note-item, [class*="note-card"]', timeout=15000)
        except Exception as e:
            print(f"[Xiaohongshu Client] No notes found for query '{query}': {e}")
            return
        
        async for note in self._collect_notes(max_results, timeout_per_scroll):
            yield note

    async def get_user_notes(
        self, 
        user_id: str, 
        max_results: int = 10
    ) -> AsyncGenerator[Dict[str, Any], None]:
        """
        Get notes from a specific user.
        
        Args:
            user_id: Xiaohongshu user ID
            max_results: Maximum number of results
            
        Yields:
            Note data dictionaries
        """
        url = f"{self.BASE_URL}/user/profile/{user_id}"
        await self.page.goto(url)
        
        try:
            await self.page.wait_for_selector('.note-item, [class*="note-card"]', timeout=15000)
        except Exception as e:
            print(f"[Xiaohongshu Client] No notes found for user '{user_id}': {e}")
            return
        
        async for note in self._collect_notes(max_results):
            yield note

    async def _collect_notes(
        self, 
        max_results: int,
        timeout_per_scroll: int = 1500
    ) -> AsyncGenerator[Dict[str, Any], None]:
        """Common note collection logic."""
        collected = 0
        seen_ids = set()
        
        while collected < max_results:
            # Get all note elements on the current page
            note_elements = await self.page.query_selector_all('.note-item, [class*="note-card"]')
            
            for note_el in note_elements:
                if collected >= max_results:
                    break
                
                try:
                    note_data = await self._extract_note_data(note_el)
                    if note_data:
                        note_id = note_data.get("id") or note_data.get("title", "")
                        if note_id not in seen_ids:
                            seen_ids.add(note_id)
                            collected += 1
                            yield note_data
                except Exception as e:
                    print(f"[Xiaohongshu Client] Error extracting note: {e}")
                    continue
            
            if collected >= max_results:
                break
            
            # Scroll down to load more notes
            await self.page.evaluate("window.scrollBy(0, 800)")
            await self.page.wait_for_timeout(timeout_per_scroll)

    async def _extract_note_data(self, note_el) -> Optional[Dict[str, Any]]:
        """Extract data from a note element."""
        try:
            data = {
                "platform": "Xiaohongshu",
                "fetched_at": datetime.now().isoformat(),
            }
            
            # Try to get note ID from link
            link_el = await note_el.query_selector('a[href*="/explore/"]')
            if link_el:
                href = await link_el.get_attribute("href")
                if href:
                    # Extract note ID from URL
                    parts = href.split("/")
                    for part in parts:
                        if len(part) == 24:  # Xiaohongshu note IDs are 24 chars
                            data["id"] = part
                            data["url"] = f"{self.BASE_URL}{href}" if href.startswith("/") else href
                            break
            
            # Extract title
            title_el = await note_el.query_selector('.title, [class*="title"]')
            if title_el:
                data["title"] = (await title_el.inner_text()).strip()
            
            # Extract author
            author_el = await note_el.query_selector('.author, .name, [class*="author"]')
            if author_el:
                data["author"] = (await author_el.inner_text()).strip()
            
            # Extract like count
            like_el = await note_el.query_selector('.like-count, [class*="like"]')
            if like_el:
                like_text = (await like_el.inner_text()).strip()
                data["likes"] = like_text
            
            # Extract cover image
            img_el = await note_el.query_selector('img')
            if img_el:
                data["cover_image"] = await img_el.get_attribute("src")
            
            return data if (data.get("title") or data.get("id")) else None
            
        except Exception:
            return None

    async def get_note_detail(self, note_id: str) -> Optional[Dict[str, Any]]:
        """
        Get detailed content of a specific note.
        
        Args:
            note_id: Note ID
            
        Returns:
            Note detail data or None
        """
        try:
            url = f"{self.BASE_URL}/explore/{note_id}"
            await self.page.goto(url, wait_until="networkidle")
            
            # Wait for content to load
            await self.page.wait_for_selector('.note-content, [class*="content"]', timeout=10000)
            
            data = {
                "id": note_id,
                "platform": "Xiaohongshu",
                "url": url,
                "fetched_at": datetime.now().isoformat(),
            }
            
            # Extract title
            title_el = await self.page.query_selector('h1, .title')
            if title_el:
                data["title"] = (await title_el.inner_text()).strip()
            
            # Extract content
            content_el = await self.page.query_selector('.note-content, [class*="content"]')
            if content_el:
                data["content"] = (await content_el.inner_text()).strip()
            
            # Extract author info
            author_el = await self.page.query_selector('.author-wrapper .name, [class*="author"] .name')
            if author_el:
                data["author"] = (await author_el.inner_text()).strip()
            
            # Extract engagement metrics
            for metric_name, selector in [
                ("likes", '[class*="like"] span'),
                ("comments", '[class*="comment"] span'),
                ("shares", '[class*="share"] span'),
            ]:
                metric_el = await self.page.query_selector(selector)
                if metric_el:
                    data[metric_name] = (await metric_el.inner_text()).strip()
            
            return data
            
        except Exception as e:
            print(f"[Xiaohongshu Client] Error getting note detail: {e}")
            return None

    async def fetch_data(self, config: Dict[str, Any]) -> AsyncGenerator[Dict[str, Any], None]:
        """
        Fetch data based on configuration.
        
        Config options:
            - query: Search query
            - userId: User ID to fetch notes from
            - noteId: Specific note ID to fetch
            - maxResults: Maximum results (default 10)
        """
        max_results = config.get("maxResults", 10)
        
        if config.get("noteId"):
            detail = await self.get_note_detail(config["noteId"])
            if detail:
                yield detail
        elif config.get("query"):
            async for note in self.search_notes(config["query"], max_results):
                yield note
        elif config.get("userId"):
            async for note in self.get_user_notes(config["userId"], max_results):
                yield note
        else:
            raise ValueError("Must provide one of: query, userId, or noteId")
