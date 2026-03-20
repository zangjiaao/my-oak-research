import asyncio
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
            "keywords": ["keyword"],
            "driver": {
                "name": "playwright",
                "option": {
                    "mode": "eval-js",
                    "targetUrl": "https://x.com",
                    "scriptBody": "(args) => ({ text: 'ok', title: 'ok' })",
                    "args": {"query": "hello"},
                },
                "filter": {},
            },
            "output": {"field": ["text", "markdown", "url"]},
        },
    )

    assert response.status_code == 200
    payload = response.json()
    assert isinstance(payload, list)
    assert payload
    assert payload[0]["recordContent"]["text"] == "eval keyword text"
    assert payload[0]["driver"] == "playwright"
    assert payload[0]["recordType"] == "eval-js"


def test_fetch_v2_playwright_eval_mode_allows_missing_target_url():
    client = TestClient(main.app)
    response = client.post(
        "/v2/fetch",
        json={
            "platform": "x",
            "sourceId": "source-eval-2",
            "keywords": [],
            "driver": {
                "name": "playwright",
                "option": {
                    "mode": "eval-js",
                    "scriptBody": "(args) => ({ text: 'ok' })",
                },
            },
            "output": {"field": ["text", "markdown"]},
        },
    )

    assert response.status_code == 200
    payload = response.json()
    assert isinstance(payload, list)


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


def test_extract_playwright_eval_options_includes_pool_settings():
    options = main._extract_playwright_eval_options(
        {
            "playwright": {
                "mode": "eval-js",
                "targetUrl": "https://x.com",
                "scriptBody": "(args) => ({ text: 'ok' })",
                "userId": "user-1",
                "poolEnabled": True,
                "poolIdleTimeoutMs": 15000,
            }
        }
    )

    assert options["pool_enabled"] is True
    assert options["pool_user_id"] == "user-1"
    assert options["pool_idle_timeout_ms"] == 15000


def test_extract_playwright_eval_options_disables_pool_without_user_id():
    options = main._extract_playwright_eval_options(
        {
            "playwright": {
                "mode": "eval-js",
                "targetUrl": "https://x.com",
                "scriptBody": "(args) => ({ text: 'ok' })",
                "poolEnabled": True,
            }
        }
    )

    assert options["pool_enabled"] is False
    assert options["pool_user_id"] == ""


def test_playwright_pool_key_changes_when_auth_changes():
    request = main.FetchRequest(platform="x", source_id="source-x-001", config={})
    base_options = {
        "headless": True,
        "proxy": {"server": "socks5h://127.0.0.1:9050"},
        "pool_user_id": "u1",
        "pool_driver": "playwright",
    }
    key1 = main._build_playwright_pool_key(request, base_options, {"cookies": [{"name": "ct0", "value": "a"}]})
    key2 = main._build_playwright_pool_key(
        request,
        base_options,
        {"cookies": [{"name": "ct0", "value": "b"}]},
    )

    assert key1 != key2


def test_run_playwright_eval_script_pooled_success_does_not_reraise(monkeypatch):
    options = {
        "target_url": "https://www.xiaohongshu.com",
        "script_body": "(args) => ({ text: 'ok', title: 'ok' })",
        "wait_until": "domcontentloaded",
        "navigation_timeout_ms": 60000,
        "post_navigation_wait_ms": 0,
        "wait_selector": None,
        "args_json": "{}",
        "headless": True,
        "storage_state": None,
        "proxy": None,
        "pool_enabled": True,
        "pool_idle_timeout_ms": 120000,
        "pool_user_id": "user-1",
        "pool_driver": "playwright",
    }

    async def fake_apply_fallback(page, result, request):
        return result

    async def fake_run_script(*args, **kwargs):
        return {"text": "ok", "title": "ok"}

    monkeypatch.setattr(main, "_extract_playwright_eval_options", lambda config: options)
    monkeypatch.setattr(main, "_run_playwright_script", fake_run_script)
    monkeypatch.setattr(main, "_apply_xiaohongshu_user_me_fallback", fake_apply_fallback)

    expected_items = [
        CleanItem(
            title="ok",
            text="ok",
            markdown="ok",
            platform="xhs",
            sourceId="source-x-001",
            sourceType="SOCIAL_MEDIA",
            recordType="eval-js",
        )
    ]
    monkeypatch.setattr(main, "_normalize_playwright_eval_result", lambda *args, **kwargs: expected_items)

    request = main.FetchRequest(platform="xhs", source_id="source-x-001", config={})
    items = asyncio.run(main._run_playwright_eval_script(request))

    assert items == expected_items
