import asyncio
import sys
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

ROOT_DIR = Path(__file__).resolve().parents[1]
if str(ROOT_DIR) not in sys.path:
    sys.path.insert(0, str(ROOT_DIR))

import main
from drivers.base_driver import BaseDriver
from drivers.registry import DriverNotFoundError, DriverRegistry
from main import CleanItem, FetchRequest, VerifyAuthResponse


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


def test_fetch_v2_driver_selected(monkeypatch):
    registry = DriverRegistry(default_driver="playwright")
    default_driver = DummyDriver("default-playwright")
    selected_driver = DummyDriver("stub-driver")

    registry.register("playwright", default_driver)
    registry.register("stub", selected_driver)

    monkeypatch.setattr(main, "driver_registry", registry)

    client = TestClient(main.app)
    response = client.post(
        "/v2/fetch",
        json={
            "platform": "x",
            "driverOptions": {},
            "sourceId": "source-1",
            "driver": "stub",
        },
    )

    assert response.status_code == 200
    assert selected_driver.fetch_calls == 1
    assert default_driver.fetch_calls == 0
    assert response.json()[0]["platform"] == "stub-driver"


def test_main_driver_registry_contains_three_drivers():
    assert set(main.driver_registry.available_drivers) == {"agent-browser", "playwright", "xhttp"}
