"""
Telegram Web Playwright client (Async version).
Uses browser authentication state (cookies + localStorage) to access Telegram Web.
"""
import asyncio
from typing import Dict, Any, AsyncGenerator, Optional
from datetime import datetime
from .base_playwright import BasePlaywrightClient


class TelegramPlaywrightClient(BasePlaywrightClient):
    """Playwright client for Telegram Web - Async version."""
    
    BASE_URL = "https://web.telegram.org/a/"
    
    async def verify_auth(self) -> bool:
        """
        Verify if the Telegram authentication is valid.
        Checks for the presence of chat list or user elements.
        
        Returns:
            True if authenticated, False otherwise.
        """
        try:
            # Use domcontentloaded for faster initial load
            await self.page.goto(self.BASE_URL, wait_until="domcontentloaded", timeout=60000)
            
            # Wait for page to stabilize
            await asyncio.sleep(5)
            
            print(f"[Telegram Client] Current URL: {self.page.url}")
            
            # Check for login state
            try:
                # Primary check: look for chat list or main app container
                logged_in_selectors = [
                    '#LeftColumn',  # Left column with chats
                    '.chat-list',
                    '[class*="ChatList"]',
                    '.ListItem',  # Chat items
                    '#MiddleColumn',  # Middle column (chat view)
                    '.messages-container',
                ]
                
                for selector in logged_in_selectors:
                    try:
                        el = await self.page.wait_for_selector(selector, timeout=5000)
                        if el:
                            print(f"[Telegram Client] Found element with selector '{selector}' - authenticated")
                            return True
                    except Exception:
                        continue
                
                # Check for QR code or login screen (indicates NOT logged in)
                login_selectors = [
                    '.qr-container',
                    '[class*="QrCode"]',
                    '.auth-form',
                    'canvas.qr',  # QR code canvas
                ]
                
                for selector in login_selectors:
                    try:
                        login_el = await self.page.query_selector(selector)
                        if login_el and await login_el.is_visible():
                            print(f"[Telegram Client] Found login/QR element - not authenticated")
                            return False
                    except Exception:
                        continue
                
                # If we can't determine, check page content
                content = await self.page.content()
                if 'Log in to Telegram' in content or 'QR' in content:
                    print("[Telegram Client] Login page detected - not authenticated")
                    return False
                
                print("[Telegram Client] Could not determine auth state, assuming authenticated")
                return True
                    
            except Exception as e:
                print(f"[Telegram Client] Auth check error: {e}")
                return False
                
        except Exception as e:
            print(f"[Telegram Client] Auth verification failed: {e}")
            return False

    async def get_chat_messages(
        self, 
        chat_id: str, 
        max_results: int = 20,
        timeout_per_scroll: int = 2000
    ) -> AsyncGenerator[Dict[str, Any], None]:
        """
        Get messages from a specific chat.
        
        Args:
            chat_id: Chat ID or username
            max_results: Maximum number of messages
            timeout_per_scroll: Milliseconds to wait after each scroll
            
        Yields:
            Message data dictionaries
        """
        # Navigate to specific chat if provided
        if chat_id:
            # Try to find and click on the chat
            try:
                # Search for chat
                search_btn = await self.page.query_selector('[class*="SearchButton"], .btn-menu')
                if search_btn:
                    await search_btn.click()
                    await asyncio.sleep(500)
                
                search_input = await self.page.query_selector('input[type="text"], .input-search')
                if search_input:
                    await search_input.fill(chat_id)
                    await asyncio.sleep(2000)
                    
                    # Click on first result
                    first_result = await self.page.query_selector('.ListItem, .chat-item')
                    if first_result:
                        await first_result.click()
                        await asyncio.sleep(2000)
            except Exception as e:
                print(f"[Telegram Client] Could not navigate to chat: {e}")
        
        # Collect messages
        async for msg in self._collect_messages(max_results, timeout_per_scroll):
            yield msg

    async def get_recent_messages(
        self, 
        max_results: int = 20
    ) -> AsyncGenerator[Dict[str, Any], None]:
        """
        Get recent messages from the current/first chat.
        
        Args:
            max_results: Maximum number of messages
            
        Yields:
            Message data dictionaries
        """
        await self.page.goto(self.BASE_URL, wait_until="domcontentloaded")
        await asyncio.sleep(3)
        
        # Click on first chat if available
        try:
            first_chat = await self.page.query_selector('.ListItem, .chat-item')
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
            await self.page.wait_for_selector('.Message, [class*="message"]', timeout=10000)
        except Exception:
            print("[Telegram Client] No messages found")
            return
        
        while collected < max_results:
            # Get all message elements
            message_elements = await self.page.query_selector_all('.Message, [class*="message-content"]')
            
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
                    print(f"[Telegram Client] Error extracting message: {e}")
                    continue
            
            if collected >= max_results:
                break
            
            # Scroll up to load older messages
            await self.page.evaluate("document.querySelector('.messages-container, .bubbles')?.scrollBy(0, -500)")
            await self.page.wait_for_timeout(timeout_per_scroll)

    async def _extract_message_data(self, msg_el) -> Optional[Dict[str, Any]]:
        """Extract data from a message element."""
        try:
            data = {
                "platform": "Telegram",
                "fetched_at": datetime.now().isoformat(),
            }
            
            # Try to get message ID
            try:
                msg_id = await msg_el.get_attribute("data-message-id")
                if msg_id:
                    data["id"] = msg_id
            except Exception:
                pass
            
            # Extract text content
            text_selectors = [
                '.text-content',
                '[class*="message-text"]',
                '.message-content',
            ]
            for selector in text_selectors:
                try:
                    text_el = await msg_el.query_selector(selector)
                    if text_el:
                        data["text"] = (await text_el.inner_text()).strip()
                        break
                except Exception:
                    continue
            
            # Extract sender
            sender_selectors = [
                '.sender-name',
                '[class*="peer-title"]',
                '.name',
            ]
            for selector in sender_selectors:
                try:
                    sender_el = await msg_el.query_selector(selector)
                    if sender_el:
                        data["sender"] = (await sender_el.inner_text()).strip()
                        break
                except Exception:
                    continue
            
            # Extract timestamp
            time_selectors = [
                '.time',
                '[class*="time"]',
                '.message-time',
            ]
            for selector in time_selectors:
                try:
                    time_el = await msg_el.query_selector(selector)
                    if time_el:
                        data["timestamp"] = (await time_el.inner_text()).strip()
                        break
                except Exception:
                    continue
            
            return data if data.get("text") else None
            
        except Exception:
            return None

    async def fetch_data(self, config: Dict[str, Any]) -> AsyncGenerator[Dict[str, Any], None]:
        """
        Fetch data based on configuration.
        
        Config options:
            - chatId: Chat ID or username to fetch messages from
            - maxResults: Maximum results (default 20)
        """
        max_results = config.get("maxResults", 20)
        chat_id = config.get("chatId")
        
        if chat_id:
            async for msg in self.get_chat_messages(chat_id, max_results):
                yield msg
        else:
            async for msg in self.get_recent_messages(max_results):
                yield msg
