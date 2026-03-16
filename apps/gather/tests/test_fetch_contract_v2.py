from pathlib import Path
import sys

from fastapi.testclient import TestClient


sys.path.append(str(Path(__file__).resolve().parents[1]))

import main  # noqa: E402
from drivers.base_driver import BaseDriver  # noqa: E402
from drivers.registry import DriverRegistry  # noqa: E402
from main import CleanItem, app  # noqa: E402


client = TestClient(app)


class StubFetchDriver(BaseDriver):
    async def verify_auth(self, _request):
        return {"valid": True}

    async def fetch(self, request):
        return [
            CleanItem(
                title="stub",
                text="stub text",
                markdown="stub markdown",
                platform=request.platform,
                sourceId=request.source_id,
                sourceType="SOCIAL_MEDIA",
            )
        ]


def _client_with_stub_driver(monkeypatch) -> TestClient:
    registry = DriverRegistry(default_driver="playwright")
    registry.register("playwright", StubFetchDriver())
    monkeypatch.setattr(main, "driver_registry", registry)
    return TestClient(main.app)


def test_fetch_v2_happy_path(monkeypatch):
    response = _client_with_stub_driver(monkeypatch).post(
        "/v2/fetch",
        json={
            "platform": "contract-test-platform",
            "sourceId": "source_123",
            "driverOptions": {},
        },
    )

    assert response.status_code == 200
    items = response.json()
    assert isinstance(items, list)
    assert items

    for item in items:
        assert "platform" in item
        assert "sourceId" in item
        assert "sourceType" in item
        assert "recordId" in item
        assert "recordType" in item
        assert "recordTime" in item
        assert "recordContent" in item
        assert item["recordContent"]["text"]


def test_fetch_v2_validation_error():
    response = client.post(
        "/v2/fetch",
        json={
            "sourceId": "source_123",
            "driverOptions": {},
        },
    )

    assert response.status_code == 422
    payload = response.json()

    assert "error" in payload
    assert payload["error"]["code"]
    assert payload["error"]["message"]
    assert payload["error"]["retryable"] is False


def test_fetch_v2_response_formats_text_only(monkeypatch):
    response = _client_with_stub_driver(monkeypatch).post(
        "/v2/fetch",
        json={
            "platform": "contract-test-platform",
            "sourceId": "source_123",
            "output": {"formats": ["text"]},
            "driverOptions": {},
        },
    )

    assert response.status_code == 200
    items = response.json()
    assert isinstance(items, list)
    assert items
    for item in items:
        assert "recordContent" in item
        assert "text" in item["recordContent"]
        assert "markdown" not in item["recordContent"]


def test_fetch_v2_response_formats_markdown_only(monkeypatch):
    response = _client_with_stub_driver(monkeypatch).post(
        "/v2/fetch",
        json={
            "platform": "contract-test-platform",
            "sourceId": "source_123",
            "output": {"formats": ["markdown"]},
            "driverOptions": {},
        },
    )

    assert response.status_code == 200
    items = response.json()
    assert isinstance(items, list)
    assert items
    for item in items:
        assert "recordContent" in item
        assert "text" not in item["recordContent"]
        assert "markdown" in item["recordContent"]


def test_fetch_v2_driver_options_without_legacy_config(monkeypatch):
    response = _client_with_stub_driver(monkeypatch).post(
        "/v2/fetch",
        json={
            "platform": "contract-test-platform",
            "sourceId": "source_123",
            "driver": "playwright",
            "output": {"formats": ["text"]},
            "driverOptions": {"query": "AI"},
        },
    )

    assert response.status_code == 200
    items = response.json()
    assert isinstance(items, list)
    assert items
    assert "recordContent" in items[0]
    assert "text" in items[0]["recordContent"]


def test_fetch_v1_endpoint_removed():
    response = client.post(
        "/fetch",
        json={
            "platform": "contract-test-platform",
            "source_id": "legacy_source_123",
            "config": {},
        },
    )
    assert response.status_code == 404
