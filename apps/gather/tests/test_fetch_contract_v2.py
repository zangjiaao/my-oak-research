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


class StubListMappingDriver(BaseDriver):
    async def verify_auth(self, _request):
        return {"valid": True}

    async def fetch(self, request):
        return [
            CleanItem(
                platform=request.platform,
                sourceId=request.source_id,
                sourceType="SOCIAL_MEDIA",
                recordContent={
                    "query": "openai",
                    "product": "Latest",
                    "text": [
                        {
                            "id": "1",
                            "author": "alice",
                            "name": "Alice",
                            "url": "https://x.com/alice/status/1",
                            "text": "hello openai",
                            "created_at": "Tue Mar 17 02:45:00 +0000 2026",
                        },
                        {
                            "id": "2",
                            "author": "bob",
                            "name": "Bob",
                            "url": "https://x.com/bob/status/2",
                            "text": "openai rocks",
                            "created_at": "Tue Mar 17 02:46:00 +0000 2026",
                        },
                    ],
                },
            )
        ]


def _client_with_stub_driver(monkeypatch) -> TestClient:
    registry = DriverRegistry(default_driver="playwright")
    registry.register("playwright", StubFetchDriver())
    monkeypatch.setattr(main, "driver_registry", registry)
    return TestClient(main.app)


def _client_with_list_mapping_driver(monkeypatch) -> TestClient:
    registry = DriverRegistry(default_driver="playwright")
    registry.register("playwright", StubListMappingDriver())
    monkeypatch.setattr(main, "driver_registry", registry)
    return TestClient(main.app)


def test_fetch_v2_happy_path(monkeypatch):
    response = _client_with_stub_driver(monkeypatch).post(
        "/v2/fetch",
        json={
            "platform": "contract-test-platform",
            "sourceId": "source_123",
            "keywords": [],
            "driver": "playwright",
            "output": {"field": ["text", "markdown"]},
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


def test_fetch_v2_output_fields_text_only(monkeypatch):
    response = _client_with_stub_driver(monkeypatch).post(
        "/v2/fetch",
        json={
            "platform": "contract-test-platform",
            "sourceId": "source_123",
            "keywords": [],
            "driver": "playwright",
            "output": {"field": ["text"]},
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


def test_fetch_v2_output_fields_markdown_only(monkeypatch):
    response = _client_with_stub_driver(monkeypatch).post(
        "/v2/fetch",
        json={
            "platform": "contract-test-platform",
            "sourceId": "source_123",
            "keywords": [],
            "driver": "playwright",
            "output": {"field": ["markdown"]},
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
            "keywords": [],
            "driver": "playwright",
            "output": {"field": ["text"]},
            "driverOptions": {"query": "AI"},
        },
    )

    assert response.status_code == 200
    items = response.json()
    assert isinstance(items, list)
    assert items
    assert "recordContent" in items[0]
    assert "text" in items[0]["recordContent"]


def test_fetch_v2_output_fields_keep_requested_content_only(monkeypatch):
    response = _client_with_stub_driver(monkeypatch).post(
        "/v2/fetch",
        json={
            "platform": "contract-test-platform",
            "sourceId": "source_123",
            "keywords": [],
            "driver": "playwright",
            "output": {"field": ["text", "url"]},
            "driverOptions": {},
        },
    )

    assert response.status_code == 200
    items = response.json()
    assert items
    assert "text" in items[0]["recordContent"]
    assert "url" not in items[0]["recordContent"]


def test_fetch_v2_output_type_overrides_record_type(monkeypatch):
    response = _client_with_stub_driver(monkeypatch).post(
        "/v2/fetch",
        json={
            "platform": "contract-test-platform",
            "sourceId": "source_123",
            "keywords": [],
            "driver": "playwright",
            "output": {"field": ["text"], "type": "x.post"},
            "driverOptions": {},
        },
    )

    assert response.status_code == 200
    items = response.json()
    assert items
    assert items[0]["recordType"] == "x.post"


def test_fetch_v2_output_field_mapping(monkeypatch):
    response = _client_with_stub_driver(monkeypatch).post(
        "/v2/fetch",
        json={
            "platform": "contract-test-platform",
            "sourceId": "source_123",
            "keywords": [],
            "driver": "playwright",
            "output": {"field": {"query": "text", "body": "markdown"}},
            "driverOptions": {},
        },
    )

    assert response.status_code == 200
    items = response.json()
    assert items
    assert items[0]["recordContent"] == {"query": "stub text", "body": "stub markdown"}


def test_fetch_v2_output_field_mapping_expands_list_records(monkeypatch):
    response = _client_with_list_mapping_driver(monkeypatch).post(
        "/v2/fetch",
        json={
            "platform": "x",
            "sourceId": "source-x-001",
            "keywords": [],
            "driver": "playwright",
            "output": {
                "field": {
                    "id": "text.id",
                    "author": "text.author",
                    "name": "text.name",
                    "url": "text.url",
                    "text": "text.text",
                    "created_at": "text.created_at",
                },
                "type": "text",
            },
            "driverOptions": {},
        },
    )

    assert response.status_code == 200
    items = response.json()
    assert len(items) == 2
    assert items[0]["recordId"] == "1"
    assert items[0]["recordType"] == "text"
    assert items[0]["recordContent"]["author"] == "alice"
    assert items[1]["recordId"] == "2"
    assert items[1]["recordContent"]["text"] == "openai rocks"


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
