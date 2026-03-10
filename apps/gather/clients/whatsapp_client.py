"""
WhatsApp Web Playwright client (Async version).
Uses Playwright persistent context for authentication (QR code login).
"""
import asyncio
from typing import Dict, Any, AsyncGenerator, Optional
from datetime import datetime
from pathlib import Path
from playwright.async_api import async_playwright, BrowserContext


class WhatsAppPlaywrightClient:
    """
    Playwright client for WhatsApp Web - Async version.
    
    Unlike other clients, WhatsApp uses a persistent browser context
    because it requires QR code scanning for login, and the session
    is stored in the browser's profile directory.
    """
    
    BASE_URL = "https://web.whatsapp.com"
    DEFAULT_PROFILE_DIR = Path(__file__).parent.parent / ".auth" / "whatsapp_profile"
    
    def __init__(self, headless: bool = True, profile_path: Optional[Path] = None):
        """
        Initialize WhatsApp client.
        
        Args:
            headless: Whether to run browser in headless mode
            profile_path: Custom profile directory path. If None, uses default.
        """
        self.headless = headless
        self.profile_dir = Path(profile_path) if profile_path else self.DEFAULT_PROFILE_DIR
        self.context: Optional[BrowserContext] = None
        self.page = None
        self._playwright = None
    
    async def __aenter__(self):
        """Async context manager entry."""
        self._playwright = await async_playwright().start()
        
        # Ensure profile directory exists
        self.profile_dir.mkdir(parents=True, exist_ok=True)
        
        print(f"[WhatsApp Client] Launching with profile directory: {self.profile_dir.absolute()}")
        
        # Launch persistent context
        self.context = await self._playwright.chromium.launch_persistent_context(
            user_data_dir=str(self.profile_dir),
            headless=self.headless,
            viewport={"width": 1280, "height": 720},
            user_agent="Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
            args=[
                '--disable-blink-features=AutomationControlled',
                '--disable-dev-shm-usage',
            ]
        )
        
        self.page = self.context.pages[0] if self.context.pages else await self.context.new_page()
        return self
    
    async def __aexit__(self, exc_type, exc_val, exc_tb):
        """Async context manager exit."""
        if self.context:
            await self.context.close()
        if self._playwright:
            await self._playwright.stop()
    
    async def verify_auth(self) -> bool:
        """
        Verify if the WhatsApp authentication is valid.
        Checks for the presence of chat list or main app elements.
        
        Returns:
            True if authenticated, False otherwise.
        """
        try:
            await self.page.goto(self.BASE_URL, wait_until="domcontentloaded", timeout=60000)
            
            # Wait for page to stabilize
            await asyncio.sleep(5)
            
            print(f"[WhatsApp Client] Current URL: {self.page.url}")
            
            try:
                # Check for logged in state
                logged_in_selectors = [
                    '[data-testid="chat-list"]',
                    '[aria-label="Chat list"]',
                    '#pane-side',  # Side panel with chats
                    '[class*="chat-list"]',
                    'div[data-testid="conversation-panel-wrapper"]',
                ]
                
                for selector in logged_in_selectors:
                    try:
                        el = await self.page.wait_for_selector(selector, timeout=5000)
                        if el:
                            print(f"[WhatsApp Client] Found element with selector '{selector}' - authenticated")
                            return True
                    except Exception:
                        continue
                
                # Check for QR code (indicates NOT logged in)
                qr_selectors = [
                    'canvas[aria-label*="QR"]',
                    '[data-testid="qrcode"]',
                    'canvas',  # QR code is usually a canvas
                    '[class*="landing"]',
                ]
                
                for selector in qr_selectors:
                    try:
                        qr_el = await self.page.query_selector(selector)
                        if qr_el and await qr_el.is_visible():
                            print(f"[WhatsApp Client] Found QR code - not authenticated")
                            print("[WhatsApp Client] Please run: uv run export_chrome_cookies.py whatsapp")
                            return False
                    except Exception:
                        continue
                
                # Check page content
                content = await self.page.content()
                if 'Use WhatsApp' in content or 'Scan the QR code' in content:
                    print("[WhatsApp Client] QR code page detected - not authenticated")
                    return False
                
                print("[WhatsApp Client] Auth state unclear, assuming authenticated")
                return True
                    
            except Exception as e:
                print(f"[WhatsApp Client] Auth check error: {e}")
                return False
                
        except Exception as e:
            print(f"[WhatsApp Client] Auth verification failed: {e}")
            return False

    async def get_chat_messages(
        self, 
        contact_name: str, 
        max_results: int = 20,
        timeout_per_scroll: int = 2000
    ) -> AsyncGenerator[Dict[str, Any], None]:
        """
        Get messages from a specific chat.
        
        Args:
            contact_name: Contact or group name to search for
            max_results: Maximum number of messages
            timeout_per_scroll: Milliseconds to wait after each scroll
            
        Yields:
            Message data dictionaries
        """
        try:
            # Click search button or search input
            search_selectors = [
                '[data-testid="chat-list-search"]',
                '[aria-label="Search"]',
                'button[aria-label*="search"]',
            ]
            
            for selector in search_selectors:
                try:
                    search_btn = await self.page.query_selector(selector)
                    if search_btn:
                        await search_btn.click()
                        await asyncio.sleep(500)
                        break
                except Exception:
                    continue
            
            # Type in search
            search_input = await self.page.query_selector('[data-testid="search-input"], input[type="text"]')
            if search_input:
                await search_input.fill(contact_name)
                await asyncio.sleep(2000)
                
                # Click first result
                first_result = await self.page.query_selector('[data-testid="cell-frame-container"], [class*="chat-list"] > div')
                if first_result:
                    await first_result.click()
                    await asyncio.sleep(2000)
        except Exception as e:
            print(f"[WhatsApp Client] Could not search for chat: {e}")
        
        async for msg in self._collect_messages(max_results, timeout_per_scroll):
            yield msg

    async def get_recent_messages(
        self, 
        max_results: int = 20
    ) -> AsyncGenerator[Dict[str, Any], None]:
        """
        Get recent messages from the first/current chat.
        
        Args:
            max_results: Maximum number of messages
            
        Yields:
            Message data dictionaries
        """
        await self.page.goto(self.BASE_URL, wait_until="domcontentloaded")
        await asyncio.sleep(5)
        
        # Click on first chat if no chat is open
        try:
            first_chat = await self.page.query_selector('[data-testid="cell-frame-container"]')
            if first_chat:
                await first_chat.click()
                await asyncio.sleep(2)
        except Exception:
            pass
        
        async for msg in self._collect_messages(max_results):
            yield msg

    async def _collect_messages(
        self, 
        max_results: int,
        timeout_per_scroll: int = 2000
    ) -> AsyncGenerator[Dict[str, Any], None]:
        """Collect messages from current chat view."""
        collected = 0
        seen_ids = set()
        
        # Wait for messages to load
        try:
            await self.page.wait_for_selector('[data-testid="msg-container"], [class*="message"]', timeout=10000)
        except Exception:
            print("[WhatsApp Client] No messages found in current view")
            return
        
        while collected < max_results:
            # Get all message elements
            message_elements = await self.page.query_selector_all('[data-testid="msg-container"]')
            
            for msg_el in message_elements:
                if collected >= max_results:
                    break
                
                try:
                    msg_data = await self._extract_message_data(msg_el)
                    if msg_data:
                        msg_id = msg_data.get("id") or msg_data.get("text", "")[:50]
                        if msg_id not in seen_ids:
                            seen_ids.add(msg_id)
                            collected += 1
                            yield msg_data
                except Exception as e:
                    print(f"[WhatsApp Client] Error extracting message: {e}")
                    continue
            
            if collected >= max_results:
                break
            
            # Scroll up to load older messages
            messages_container = await self.page.query_selector('[data-testid="conversation-panel-messages"]')
            if messages_container:
                await messages_container.evaluate("el => el.scrollBy(0, -500)")
            await self.page.wait_for_timeout(timeout_per_scroll)

    async def _extract_message_data(self, msg_el) -> Optional[Dict[str, Any]]:
        """Extract data from a message element."""
        try:
            data = {
                "platform": "WhatsApp",
                "fetched_at": datetime.now().isoformat(),
            }
            
            # Try to get message ID
            try:
                msg_id = await msg_el.get_attribute("data-id")
                if msg_id:
                    data["id"] = msg_id
            except Exception:
                pass
            
            # Extract text content
            text_selectors = [
                '[data-testid="msg-text"]',
                '.selectable-text',
                'span.selectable-text',
            ]
            for selector in text_selectors:
                try:
                    text_el = await msg_el.query_selector(selector)
                    if text_el:
                        data["text"] = (await text_el.inner_text()).strip()
                        break
                except Exception:
                    continue
            
            # Check if it's incoming or outgoing
            try:
                classes = await msg_el.get_attribute("class") or ""
                if "message-in" in classes:
                    data["direction"] = "incoming"
                elif "message-out" in classes:
                    data["direction"] = "outgoing"
            except Exception:
                pass
            
            # Extract timestamp
            try:
                time_el = await msg_el.query_selector('[data-testid="msg-time"], [class*="msg-time"]')
                if time_el:
                    data["timestamp"] = (await time_el.inner_text()).strip()
            except Exception:
                pass
            
            return data if data.get("text") else None
            
        except Exception:
            return None

    async def fetch_data(self, config: Dict[str, Any]) -> AsyncGenerator[Dict[str, Any], None]:
        """
        Fetch data based on configuration.
        
        Config options:
            - contactName: Contact or group name to fetch messages from
            - maxResults: Maximum results (default 20)
        """
        max_results = config.get("maxResults", 20)
        contact_name = config.get("contactName")
        
        if contact_name:
            async for msg in self.get_chat_messages(contact_name, max_results):
                yield msg
        else:
            async for msg in self.get_recent_messages(max_results):
                yield msg
