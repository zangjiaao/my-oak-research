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
                    "username": args.get("username"),
                    "tweet_id": args.get("tweet_id"),
                    "count": args.get("count"),
                    "mode": playwright.get("mode"),
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
                "intent": {"type": "search", "args": {"query": "openai", "limit": 20}},
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
            "intent": {"type": "search", "args": {"query": "openai"}},
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
            "intent": {"type": "search", "args": {"query": "openai", "limit": 20}},
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


def test_fetch_v3_profile_intent_maps_username_and_mode(monkeypatch):
    response = _client_with_stub_driver(monkeypatch).post(
        "/v3/fetch",
        json={
            "platform": "x",
            "sourceId": "source_123",
            "intent": {"type": "profile", "args": {"username": "openai"}},
            "keywords": [],
            "driver": {"name": "playwright", "option": {}},
            "output": {"field": ["username", "mode"], "type": "x-profile"},
        },
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["meta"]["adapter"] == "x.profile"
    assert payload["items"][0]["recordContent"]["username"] == "openai"
    assert payload["items"][0]["recordContent"]["mode"] == "intercept-x-profile"


def test_fetch_v3_thread_intent_maps_tweet_id_and_mode(monkeypatch):
    response = _client_with_stub_driver(monkeypatch).post(
        "/v3/fetch",
        json={
            "platform": "x",
            "sourceId": "source_123",
            "intent": {"type": "thread", "args": {"url": "https://x.com/openai/status/1900000000000000000", "limit": 10}},
            "keywords": [],
            "driver": {"name": "playwright", "option": {}},
            "output": {"field": ["tweet_id", "mode", "count"], "type": "x-thread"},
        },
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["meta"]["adapter"] == "x.thread"
    assert payload["items"][0]["recordContent"]["tweet_id"] == "1900000000000000000"
    assert payload["items"][0]["recordContent"]["mode"] == "intercept-x-thread"
    assert payload["items"][0]["recordContent"]["count"] == "10"


def test_fetch_v3_reddit_search_intent_maps_mode_and_limit(monkeypatch):
    response = _client_with_stub_driver(monkeypatch).post(
        "/v3/fetch",
        json={
            "platform": "reddit",
            "sourceId": "source_123",
            "intent": {"type": "search", "args": {"query": "openai", "limit": 15, "sort": "new", "time": "week"}},
            "keywords": [],
            "driver": {"name": "playwright", "option": {}},
            "output": {"field": ["query", "count", "mode"], "type": "reddit-post"},
        },
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["meta"]["adapter"] == "reddit.search"
    assert payload["items"][0]["recordContent"]["query"] == "openai"
    assert payload["items"][0]["recordContent"]["count"] == "15"
    assert payload["items"][0]["recordContent"]["mode"] == "intercept-reddit-search"


def test_fetch_v3_reddit_user_posts_maps_username(monkeypatch):
    response = _client_with_stub_driver(monkeypatch).post(
        "/v3/fetch",
        json={
            "platform": "reddit",
            "sourceId": "source_123",
            "intent": {"type": "user-posts", "args": {"username": "u/spez", "limit": 5}},
            "keywords": [],
            "driver": {"name": "playwright", "option": {}},
            "output": {"field": ["username", "mode", "count"], "type": "reddit-post"},
        },
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["meta"]["adapter"] == "reddit.user-posts"
    assert payload["items"][0]["recordContent"]["username"] == "spez"
    assert payload["items"][0]["recordContent"]["mode"] == "intercept-reddit-user-posts"
    assert payload["items"][0]["recordContent"]["count"] == "5"


def test_fetch_v3_xhs_search_intent_maps_mode(monkeypatch):
    response = _client_with_stub_driver(monkeypatch).post(
        "/v3/fetch",
        json={
            "platform": "xhs",
            "sourceId": "source_123",
            "intent": {"type": "search", "args": {"query": "mcp", "limit": 8}},
            "keywords": [],
            "driver": {"name": "playwright", "option": {}},
            "output": {"field": ["query", "count", "mode"], "type": "xhs-note"},
        },
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["meta"]["adapter"] == "xhs.search"
    assert payload["items"][0]["recordContent"]["query"] == "mcp"
    assert payload["items"][0]["recordContent"]["count"] == "8"
    assert payload["items"][0]["recordContent"]["mode"] == "intercept-xhs-search"


def test_fetch_v3_xhs_user_intent_maps_id(monkeypatch):
    response = _client_with_stub_driver(monkeypatch).post(
        "/v3/fetch",
        json={
            "platform": "xhs",
            "sourceId": "source_123",
            "intent": {"type": "user", "args": {"id": "abc123", "limit": 5}},
            "keywords": [],
            "driver": {"name": "playwright", "option": {}},
            "output": {"field": ["count", "mode"], "type": "xhs-user"},
        },
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["meta"]["adapter"] == "xhs.user"
    assert payload["items"][0]["recordContent"]["count"] == "5"
    assert payload["items"][0]["recordContent"]["mode"] == "intercept-xhs-user"


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
