from pathlib import Path
import sys

from fastapi.testclient import TestClient


sys.path.append(str(Path(__file__).resolve().parents[1]))

import main  # noqa: E402
from drivers.base_driver import BaseDriver  # noqa: E402
from drivers.registry import DriverRegistry  # noqa: E402
from main import CleanItem  # noqa: E402


class StubFetchDriver(BaseDriver):
    async def verify_auth(self, _request):
        return {"valid": True}

    async def fetch(self, request):
        playwright = request.config.get("playwright") if isinstance(request.config, dict) else {}
        args = playwright.get("args", {}) if isinstance(playwright, dict) else {}
        return [
            CleanItem(
                platform=request.platform,
                sourceId=request.source_id,
                sourceType="SOCIAL_MEDIA",
                recordContent={
                    "text": f"stub text {args.get('query', '')}".strip(),
                    "url": "https://x.com/openai/status/1",
                    "query": args.get("query"),
                    "count": args.get("count"),
                },
            )
        ]


def _client_with_stub_driver(monkeypatch) -> TestClient:
    registry = DriverRegistry(default_driver="playwright")
    registry.register("playwright", StubFetchDriver())
    monkeypatch.setattr(main, "driver_registry", registry)
    return TestClient(main.app)


def test_fetch_v3_happy_path(monkeypatch):
    response = _client_with_stub_driver(monkeypatch).post(
        "/v3/fetch",
        json={
            "platform": "x",
            "sourceId": "source_123",
                "intent": {"type": "search", "query": "openai", "limit": 20},
                "keywords": [],
                "driver": {"name": "playwright", "option": {}},
                "output": {"field": ["text", "url", "query", "count"], "type": "x-text"},
            },
        )

    assert response.status_code == 200
    payload = response.json()
    assert "items" in payload
    assert isinstance(payload["items"], list)
    assert payload["items"]
    assert payload["meta"]["driverUsed"] == "playwright"
    assert payload["meta"]["strategyUsed"] == "cookie"
    assert payload["meta"]["adapter"] == "x.search"
    assert payload["items"][0]["recordContent"]["query"] == "openai"
    assert payload["items"][0]["recordContent"]["count"] == "20"


def test_fetch_v3_uses_default_playwright_driver(monkeypatch):
    response = _client_with_stub_driver(monkeypatch).post(
        "/v3/fetch",
        json={
            "platform": "x",
            "sourceId": "source_123",
            "intent": {"type": "search", "query": "openai"},
            "keywords": [],
            "output": {"field": ["text"], "type": "x-text"},
        },
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["meta"]["driverUsed"] == "playwright"
    assert payload["meta"]["strategyTried"] == ["cookie", "header", "intercept", "ui"]


def test_fetch_v3_keeps_existing_driver_args(monkeypatch):
    response = _client_with_stub_driver(monkeypatch).post(
        "/v3/fetch",
        json={
            "platform": "x",
            "sourceId": "source_123",
            "intent": {"type": "search", "query": "openai", "limit": 20},
            "driver": {
                "name": "playwright",
                "option": {"mode": "eval-js", "args": {"query": "manual-query", "count": "5"}},
            },
            "keywords": [],
            "output": {"field": ["text", "query", "count"], "type": "x-text"},
        },
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["items"][0]["recordContent"]["query"] == "manual-query"
    assert payload["items"][0]["recordContent"]["count"] == "5"


def test_fetch_v3_validation_error():
    client = TestClient(main.app)
    response = client.post(
        "/v3/fetch",
        json={
            "platform": "x",
            "sourceId": "source_123",
            "keywords": [],
            "output": {"field": ["text"]},
        },
    )

    assert response.status_code == 422
    payload = response.json()
    assert "error" in payload
    assert payload["error"]["code"] == "VALIDATION_ERROR"
