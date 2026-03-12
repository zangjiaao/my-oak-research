"""Playwright-backed driver implementation."""
from typing import Any, Awaitable, Callable

from .base_driver import BaseDriver


VerifyAuthHandler = Callable[[Any], Awaitable[Any]]
FetchHandler = Callable[[Any], Awaitable[list[Any]]]


class PlaywrightDriver(BaseDriver):
    """Adapter that reuses existing Playwright handlers."""

    def __init__(self, verify_auth_handler: VerifyAuthHandler, fetch_handler: FetchHandler):
        self._verify_auth_handler = verify_auth_handler
        self._fetch_handler = fetch_handler

    async def verify_auth(self, request: Any) -> Any:
        return await self._verify_auth_handler(request)

    async def fetch(self, request: Any) -> list[Any]:
        return await self._fetch_handler(request)
