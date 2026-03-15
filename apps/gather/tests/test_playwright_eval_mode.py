import sys
from pathlib import Path

from fastapi.testclient import TestClient

ROOT_DIR = Path(__file__).resolve().parents[1]
if str(ROOT_DIR) not in sys.path:
    sys.path.insert(0, str(ROOT_DIR))

import main
from main import CleanItem


def test_fetch_v2_playwright_eval_mode_uses_eval_runner(monkeypatch):
    async def fake_eval_runner(request):
        return [
            CleanItem(
                title="eval-title",
                text="eval keyword text",
                markdown="eval keyword text",
                platform=request.platform,
                sourceId=request.source_id,
                sourceType="SOCIAL_MEDIA",
                recordType="eval-js",
            )
        ]

    monkeypatch.setattr(main, "_run_playwright_eval_script", fake_eval_runner)

    client = TestClient(main.app)
    response = client.post(
        "/v2/fetch",
        json={
            "platform": "x",
            "sourceId": "source-eval-1",
            "driver": "playwright",
            "config": {
                "playwright": {
                    "mode": "eval-js",
                    "targetUrl": "https://x.com",
                    "scriptBody": "(args) => ({ text: 'ok', title: 'ok' })",
                    "args": {"query": "hello"},
                },
                "keywordFilter": {"keywords": ["keyword"]},
            },
        },
    )

    assert response.status_code == 200
    payload = response.json()
    assert isinstance(payload, list)
    assert payload
    assert payload[0]["title"] == "eval-title"
    assert payload[0]["driver"] == "playwright"
    assert payload[0]["recordType"] == "eval-js"


def test_fetch_v2_playwright_eval_mode_requires_target_url():
    client = TestClient(main.app)
    response = client.post(
        "/v2/fetch",
        json={
            "platform": "x",
            "sourceId": "source-eval-2",
            "driver": "playwright",
            "config": {
                "playwright": {
                    "mode": "eval-js",
                    "scriptBody": "(args) => ({ text: 'ok' })",
                }
            },
        },
    )

    assert response.status_code == 400
    payload = response.json()
    assert payload["error"]["code"] == "FETCH_BAD_REQUEST"
    assert "targetUrl" in payload["error"]["message"]
