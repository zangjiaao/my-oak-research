"""
Base Playwright client for social media data fetching (Async version).
Uses browser storage state (cookies) for authentication.
"""
import os
import json
import tempfile
from abc import ABC, abstractmethod
from typing import Optional, Dict, Any, AsyncGenerator
from playwright.async_api import async_playwright, Page, Browser, BrowserContext, Playwright


class BasePlaywrightClient(ABC):
    """Base class for Playwright-based social media clients (Async version)."""
    
    def __init__(
        self,
        auth_data: Optional[Dict[str, Any]] = None,
        auth_file: Optional[str] = None,
        headless: bool = True,
        proxy: Optional[Dict[str, str]] = None,
    ):
        """
        Initialize the Playwright client.
        
        Args:
            auth_data: Authentication state as dictionary (Playwright storage_state format)
            auth_file: Path to authentication state file
            headless: Whether to run browser in headless mode
            proxy: Proxy configuration {"server": "http://...", "username": "...", "password": "..."}
        """
        self.auth_data = auth_data
        self.auth_file = auth_file
        self.headless = headless
        self.proxy = proxy
        
        self._playwright: Optional[Playwright] = None
        self._browser: Optional[Browser] = None
        self._context: Optional[BrowserContext] = None
        self._page: Optional[Page] = None
        self._temp_auth_file: Optional[str] = None

    async def __aenter__(self):
        await self._start()
        return self

    async def __aexit__(self, exc_type, exc_val, exc_tb):
        await self._stop()

    async def _start(self):
        """Start the browser with authentication state."""
        # Determine storage state source
        storage_state = None
        
        if self.auth_file and os.path.exists(self.auth_file):
            storage_state = self.auth_file
        elif self.auth_data:
            # Write auth_data to a temporary file
            self._temp_auth_file = tempfile.NamedTemporaryFile(
                mode='w', 
                suffix='.json', 
                delete=False
            ).name
            with open(self._temp_auth_file, 'w') as f:
                json.dump(self.auth_data, f)
            storage_state = self._temp_auth_file
        
        if not storage_state:
            raise ValueError(
                "No authentication data provided. "
                "Please provide auth_data or auth_file."
            )

        self._playwright = await async_playwright().start()
        
        # Browser launch options
        launch_options = {
            "headless": self.headless,
        }
        
        self._browser = await self._playwright.chromium.launch(**launch_options)
        
        # Context options
        context_options = {
            "storage_state": storage_state,
        }
        
        if self.proxy:
            context_options["proxy"] = self.proxy
        
        self._context = await self._browser.new_context(**context_options)
        self._page = await self._context.new_page()

    async def _stop(self):
        """Close the browser and clean up resources."""
        if self._page:
            await self._page.close()
            self._page = None
        if self._context:
            await self._context.close()
            self._context = None
        if self._browser:
            await self._browser.close()
            self._browser = None
        if self._playwright:
            await self._playwright.stop()
            self._playwright = None
        
        # Clean up temporary auth file
        if self._temp_auth_file and os.path.exists(self._temp_auth_file):
            os.unlink(self._temp_auth_file)
            self._temp_auth_file = None

    @property
    def page(self) -> Page:
        """Get the current page instance."""
        if not self._page:
            raise RuntimeError("Browser not started. Use async with statement or call _start().")
        return self._page

    @abstractmethod
    async def verify_auth(self) -> bool:
        """
        Verify if the authentication is still valid.
        
        Returns:
            True if authenticated, False otherwise.
        """
        pass

    @abstractmethod
    async def fetch_data(self, config: Dict[str, Any]) -> AsyncGenerator[Dict[str, Any], None]:
        """
        Fetch data based on the provided configuration.
        
        Args:
            config: Platform-specific configuration
            
        Yields:
            Data items
        """
        pass
