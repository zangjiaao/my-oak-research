"""Driver registry for gather service dispatch."""
from typing import Any

from .base_driver import BaseDriver


class DriverNotFoundError(Exception):
    """Raised when driver selection cannot be resolved."""

    code = "DRIVER_NOT_FOUND"

    def __init__(self, driver_name: str, available_drivers: list[str]):
        self.driver_name = driver_name
        self.available_drivers = sorted(available_drivers)
        message = f"Driver '{driver_name}' is not registered"
        super().__init__(message)

    def to_detail(self) -> dict[str, Any]:
        return {
            "code": self.code,
            "message": str(self),
            "driver": self.driver_name,
            "available_drivers": self.available_drivers,
        }


class DriverRegistry:
    """Registry that dispatches auth/fetch calls to concrete drivers."""

    def __init__(self, default_driver: str):
        self.default_driver = default_driver
        self._drivers: dict[str, BaseDriver] = {}

    def register(self, name: str, driver: BaseDriver) -> None:
        self._drivers[name] = driver

    def get_driver(self, driver_name: str | None = None) -> BaseDriver:
        resolved_name = driver_name or self.default_driver
        if resolved_name not in self._drivers:
            raise DriverNotFoundError(resolved_name, self.available_drivers)
        return self._drivers[resolved_name]

    @property
    def available_drivers(self) -> list[str]:
        return sorted(self._drivers.keys())

    async def verify_auth(self, request: Any, driver_name: str | None = None) -> Any:
        driver = self.get_driver(driver_name)
        return await driver.verify_auth(request)

    async def fetch(self, request: Any, driver_name: str | None = None) -> list[Any]:
        driver = self.get_driver(driver_name)
        return await driver.fetch(request)
