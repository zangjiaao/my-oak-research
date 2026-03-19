from pathlib import Path
import sys
import subprocess

from fastapi.testclient import TestClient


sys.path.append(str(Path(__file__).resolve().parents[1]))

import main  # noqa: E402
from main import CleanItem  # noqa: E402


def test_fetch_v3_uses_intercept_x_search_mode(monkeypatch):
    async def fake_run_playwright_intercept_x_search(request):  # noqa: ANN001
        return [
            CleanItem(
                platform=request.platform,
                sourceId=request.source_id,
                sourceType="SOCIAL_MEDIA",
                recordContent={
                    "query": request.config.get("playwright", {}).get("args", {}).get("query"),
                    "tweets": [{"id": "1", "text": "hello"}],
                    "text": "hello",
                },
            )
        ]

    monkeypatch.setattr(main, "_run_playwright_intercept_x_search", fake_run_playwright_intercept_x_search)

    client = TestClient(main.app)
    response = client.post(
        "/v3/fetch",
        json={
            "platform": "x",
            "sourceId": "source_123",
            "intent": {"type": "search", "args": {"query": "openai", "limit": 20}},
            "keywords": [],
            "driver": {"name": "playwright", "option": {}},
            "output": {"field": ["query", "tweets"], "type": "x-text"},
        },
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["meta"]["driverUsed"] == "playwright"
    assert payload["meta"]["strategyUsed"] == "cookie"
    assert payload["items"][0]["recordContent"]["query"] == "openai"
    assert payload["items"][0]["recordContent"]["tweets"][0]["id"] == "1"


def test_fetch_v3_opencli_bridge_mode(monkeypatch):
    def fake_run(command, capture_output, text, cwd, check):  # noqa: ANN001
        return subprocess.CompletedProcess(
            args=command,
            returncode=0,
            stdout='[{"id":"1","author":"openai","text":"hello","url":"https://x.com/openai/status/1","created_at":"Tue Mar 17 02:45:00 +0000 2026"}]',
            stderr="",
        )

    monkeypatch.setattr(main.subprocess, "run", fake_run)

    client = TestClient(main.app)
    response = client.post(
        "/v3/fetch",
        json={
            "platform": "x",
            "sourceId": "source_123",
            "intent": {"type": "search", "args": {"query": "openai", "limit": 20}},
            "keywords": [],
            "driver": {"name": "playwright", "option": {"mode": "opencli-bridge"}},
            "output": {
                "field": {
                    "id": "tweets.id",
                    "author": "tweets.author",
                    "text": "tweets.text",
                    "url": "tweets.url",
                    "created_at": "tweets.created_at",
                },
                "type": "x-text",
                "keywordScope": ["text"],
            },
        },
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["items"]
    assert payload["items"][0]["recordContent"]["id"] == "1"
    assert payload["items"][0]["recordContent"]["author"] == "openai"


def test_fetch_v3_uses_intercept_reddit_search_mode(monkeypatch):
    async def fake_run_playwright_intercept_reddit_intent(request, intent_type):  # noqa: ANN001
        return [
            CleanItem(
                platform=request.platform,
                sourceId=request.source_id,
                sourceType="SOCIAL_MEDIA",
                recordContent={
                    "query": request.config.get("playwright", {}).get("args", {}).get("query"),
                    "mode": request.config.get("playwright", {}).get("mode"),
                    "intent_type": intent_type,
                    "posts": [{"id": "p1", "title": "hello"}],
                },
            )
        ]

    monkeypatch.setattr(main, "_run_playwright_intercept_reddit_intent", fake_run_playwright_intercept_reddit_intent)

    client = TestClient(main.app)
    response = client.post(
        "/v3/fetch",
        json={
            "platform": "reddit",
            "sourceId": "source_123",
            "intent": {"type": "search", "args": {"query": "openai", "limit": 20}},
            "keywords": [],
            "driver": {"name": "playwright", "option": {}},
            "output": {"field": ["query", "intent_type", "mode"], "type": "reddit-post"},
        },
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["meta"]["adapter"] == "reddit.search"
    assert payload["items"][0]["recordContent"]["query"] == "openai"
    assert payload["items"][0]["recordContent"]["intent_type"] == "search"
    assert payload["items"][0]["recordContent"]["mode"] == "intercept-reddit-search"


def test_fetch_v3_uses_intercept_xhs_search_mode(monkeypatch):
    async def fake_run_playwright_intercept_xhs_intent(request, intent_type):  # noqa: ANN001
        return [
            CleanItem(
                platform=request.platform,
                sourceId=request.source_id,
                sourceType="SOCIAL_MEDIA",
                recordContent={
                    "query": request.config.get("playwright", {}).get("args", {}).get("query"),
                    "mode": request.config.get("playwright", {}).get("mode"),
                    "intent_type": intent_type,
                    "notes": [{"id": "n1", "title": "hello"}],
                },
            )
        ]

    monkeypatch.setattr(main, "_run_playwright_intercept_xhs_intent", fake_run_playwright_intercept_xhs_intent)

    client = TestClient(main.app)
    response = client.post(
        "/v3/fetch",
        json={
            "platform": "xhs",
            "sourceId": "source_123",
            "intent": {"type": "search", "args": {"query": "openai", "limit": 20}},
            "keywords": [],
            "driver": {"name": "playwright", "option": {}},
            "output": {"field": ["query", "intent_type", "mode"], "type": "xhs-note"},
        },
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["meta"]["adapter"] == "xhs.search"
    assert payload["items"][0]["recordContent"]["query"] == "openai"
    assert payload["items"][0]["recordContent"]["intent_type"] == "search"
    assert payload["items"][0]["recordContent"]["mode"] == "intercept-xhs-search"


def test_fetch_v3_uses_intercept_bbc_news_mode(monkeypatch):
    async def fake_run_playwright_intercept_bbc_intent(request, intent_type):  # noqa: ANN001
        return [
            CleanItem(
                platform=request.platform,
                sourceId=request.source_id,
                sourceType="NEWS",
                recordContent={
                    "count": request.config.get("playwright", {}).get("args", {}).get("count"),
                    "mode": request.config.get("playwright", {}).get("mode"),
                    "intent_type": intent_type,
                    "items": [{"rank": 1, "title": "BBC headline"}],
                },
            )
        ]

    monkeypatch.setattr(main, "_run_playwright_intercept_bbc_intent", fake_run_playwright_intercept_bbc_intent)

    client = TestClient(main.app)
    response = client.post(
        "/v3/fetch",
        json={
            "platform": "bbc",
            "sourceId": "source_123",
            "intent": {"type": "news", "args": {"limit": 10}},
            "keywords": [],
            "driver": {"name": "playwright", "option": {}},
            "output": {"field": ["count", "intent_type", "mode"], "type": "bbc-news"},
        },
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["meta"]["adapter"] == "bbc.news"
    assert payload["items"][0]["recordContent"]["count"] == "10"
    assert payload["items"][0]["recordContent"]["intent_type"] == "news"
    assert payload["items"][0]["recordContent"]["mode"] == "intercept-bbc-news"


def test_fetch_v3_uses_intercept_hackernews_top_mode(monkeypatch):
    async def fake_run_playwright_intercept_hackernews_intent(request, intent_type):  # noqa: ANN001
        return [
            CleanItem(
                platform=request.platform,
                sourceId=request.source_id,
                sourceType="NEWS",
                recordContent={
                    "count": request.config.get("playwright", {}).get("args", {}).get("count"),
                    "mode": request.config.get("playwright", {}).get("mode"),
                    "intent_type": intent_type,
                    "items": [{"rank": 1, "title": "HN headline"}],
                },
            )
        ]

    monkeypatch.setattr(main, "_run_playwright_intercept_hackernews_intent", fake_run_playwright_intercept_hackernews_intent)

    client = TestClient(main.app)
    response = client.post(
        "/v3/fetch",
        json={
            "platform": "hackernews",
            "sourceId": "source_123",
            "intent": {"type": "top", "args": {"limit": 10}},
            "keywords": [],
            "driver": {"name": "playwright", "option": {}},
            "output": {"field": ["count", "intent_type", "mode"], "type": "hn-top"},
        },
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["meta"]["adapter"] == "hackernews.top"
    assert payload["items"][0]["recordContent"]["count"] == "10"
    assert payload["items"][0]["recordContent"]["intent_type"] == "top"
    assert payload["items"][0]["recordContent"]["mode"] == "intercept-hackernews-top"


def test_fetch_v3_uses_intercept_linkedin_search_mode(monkeypatch):
    async def fake_run_playwright_intercept_linkedin_intent(request, intent_type):  # noqa: ANN001
        return [
            CleanItem(
                platform=request.platform,
                sourceId=request.source_id,
                sourceType="SOCIAL_MEDIA",
                recordContent={
                    "query": request.config.get("playwright", {}).get("args", {}).get("query"),
                    "mode": request.config.get("playwright", {}).get("mode"),
                    "intent_type": intent_type,
                    "jobs": [{"rank": 1, "title": "Software Engineer"}],
                },
            )
        ]

    monkeypatch.setattr(main, "_run_playwright_intercept_linkedin_intent", fake_run_playwright_intercept_linkedin_intent)

    client = TestClient(main.app)
    response = client.post(
        "/v3/fetch",
        json={
            "platform": "linkedin",
            "sourceId": "source_123",
            "intent": {"type": "search", "args": {"query": "software engineer", "limit": 10}},
            "keywords": [],
            "driver": {"name": "playwright", "option": {}},
            "output": {"field": ["query", "intent_type", "mode"], "type": "linkedin-job"},
        },
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["meta"]["adapter"] == "linkedin.search"
    assert payload["items"][0]["recordContent"]["query"] == "software engineer"
    assert payload["items"][0]["recordContent"]["intent_type"] == "search"
    assert payload["items"][0]["recordContent"]["mode"] == "intercept-linkedin-search"
