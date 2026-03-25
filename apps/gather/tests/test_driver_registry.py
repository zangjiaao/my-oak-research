import asyncio
import sys
from pathlib import Path

import pytest

ROOT_DIR = Path(__file__).resolve().parents[1]
if str(ROOT_DIR) not in sys.path:
    sys.path.insert(0, str(ROOT_DIR))

import core.fetch as core_fetch
from drivers.base_driver import BaseDriver
from drivers.registry import DriverNotFoundError, DriverRegistry
from schemas import CleanItem, FetchRequest, VerifyAuthResponse


class DummyDriver(BaseDriver):
    def __init__(self, platform_name: str):
        self.platform_name = platform_name
        self.fetch_calls = 0

    async def verify_auth(self, request):
        return VerifyAuthResponse(valid=True, message=f"{self.platform_name} auth ok")

    async def fetch(self, request):
        self.fetch_calls += 1
        return [
            CleanItem(
                title=f"{self.platform_name}-title",
                text="dummy",
                markdown="dummy",
                platform=self.platform_name,
                sourceId=request.source_id,
                sourceType="SOCIAL_MEDIA",
            )
        ]


def test_driver_registry_default_fallback():
    registry = DriverRegistry(default_driver="playwright")
    default_driver = DummyDriver("default-playwright")
    registry.register("playwright", default_driver)

    request = FetchRequest(platform="x", config={}, source_id="source-1")
    results = asyncio.run(registry.fetch(request))

    assert default_driver.fetch_calls == 1
    assert results[0].platform == "default-playwright"


def test_driver_registry_not_found():
    registry = DriverRegistry(default_driver="playwright")
    registry.register("playwright", DummyDriver("default-playwright"))

    request = FetchRequest(platform="x", config={}, source_id="source-1")

    with pytest.raises(DriverNotFoundError) as error:
        asyncio.run(registry.fetch(request, driver_name="unknown-driver"))

    assert error.value.code == "DRIVER_NOT_FOUND"


def test_main_driver_registry_contains_expected_drivers():
    assert set(core_fetch.driver_registry.available_drivers) == {"playwright", "xhttp"}
