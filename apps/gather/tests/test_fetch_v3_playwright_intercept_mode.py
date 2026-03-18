from pathlib import Path
import sys

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
            "intent": {"type": "search", "query": "openai", "limit": 20},
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
