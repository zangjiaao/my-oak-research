"""Driver abstraction for gather fetch/auth flows."""
from abc import ABC, abstractmethod
from typing import Any


class BaseDriver(ABC):
    """Base driver contract for gather implementations."""

    @abstractmethod
    async def verify_auth(self, request: Any) -> Any:
        """Verify auth payload for a platform."""

    @abstractmethod
    async def fetch(self, request: Any) -> list[Any]:
        """Fetch data for a platform."""
