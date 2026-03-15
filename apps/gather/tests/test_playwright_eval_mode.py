import sys
from pathlib import Path

import pytest
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


def test_extract_playwright_eval_options_supports_state_file(tmp_path):
    state_file = tmp_path / "x.auth.json"
    state_file.write_text('{"cookies":[{"name":"ct0","value":"abc"}],"origins":[]}', encoding="utf-8")

    options = main._extract_playwright_eval_options(
        {
            "playwright": {
                "mode": "eval-js",
                "targetUrl": "https://x.com",
                "scriptBody": "(args) => ({ text: 'ok' })",
                "stateFile": str(state_file),
            }
        }
    )

    assert options["storage_state"] is not None
    assert options["storage_state"]["cookies"][0]["name"] == "ct0"


def test_normalize_playwright_eval_result_flattens_bb_site_tweets():
    result = {
        "query": "openai",
        "count": 1,
        "tweets": [
            {
                "id": "123",
                "author": "alice",
                "name": "Alice",
                "url": "https://x.com/alice/status/123",
                "text": "hello world",
                "created_at": "Sun Mar 15 04:03:16 +0000 2026",
            }
        ],
    }
    request = main.FetchRequest(platform="x", source_id="source-x-001", config={})
    items = main._normalize_playwright_eval_result(result, request, "https://x.com")

    assert len(items) == 1
    item = items[0]
    assert item.recordId == "123"
    assert item.recordType == "eval-js"
    assert item.title == "Alice"
    assert item.text == "hello world"
    assert item.markdown.startswith("@alice:")


def test_normalize_playwright_eval_result_raises_bad_request_on_error_payload():
    request = main.FetchRequest(platform="x", source_id="source-x-001", config={})
    with pytest.raises(main.HTTPException) as error:
        main._normalize_playwright_eval_result(
            {"error": "No ct0 cookie", "hint": "Please log in first"},
            request,
            "https://x.com",
        )
    assert error.value.status_code == 400
    assert "No ct0 cookie" in str(error.value.detail)


def test_extract_playwright_eval_options_supports_network_proxy():
    options = main._extract_playwright_eval_options(
        {
            "network": {
                "proxy": {
                    "url": "socks5h://127.0.0.1:9050",
                }
            },
            "playwright": {
                "mode": "eval-js",
                "targetUrl": "https://x.com",
                "scriptBody": "(args) => ({ text: 'ok' })",
            },
        }
    )

    assert options["proxy"] == {"server": "socks5h://127.0.0.1:9050"}
