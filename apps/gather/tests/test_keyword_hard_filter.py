import sys
from pathlib import Path

from fastapi.testclient import TestClient

ROOT_DIR = Path(__file__).resolve().parents[1]
if str(ROOT_DIR) not in sys.path:
    sys.path.insert(0, str(ROOT_DIR))

import main
from drivers.base_driver import BaseDriver
from drivers.registry import DriverRegistry
from main import CleanItem, FetchRequest


class StubKeywordDriver(BaseDriver):
    async def verify_auth(self, _request):
        return {"valid": True}

    async def fetch(self, request):
        if request.platform == "hit-only":
            return [
                CleanItem(
                    title="Oak AI update",
                    text="This post tracks ai regulation and policy",
                    markdown="ai regulation",
                    platform="X",
                    sourceId=request.source_id,
                    sourceType="SOCIAL_MEDIA",
                )
            ]
        if request.platform == "miss-only":
            return [
                CleanItem(
                    title="Cooking tips",
                    text="Kitchen story with no match",
                    markdown="food life",
                    platform="X",
                    sourceId=request.source_id,
                    sourceType="SOCIAL_MEDIA",
                )
            ]
        if request.platform == "chat-batch":
            return [
                CleanItem(
                    title="Chat batch",
                    text="\n".join(
                        [
                            "[10:00] Alice: hello everyone",
                            "[10:01] Bob: random message",
                            "[10:02] Carol: alpha launch is live",
                            "[10:03] Dave: nothing useful",
                        ]
                    ),
                    markdown="chat batch markdown",
                    platform="Telegram",
                    sourceId=request.source_id,
                    sourceType="SOCIAL_MEDIA",
                )
            ]
        return [
            CleanItem(
                title="AI signal",
                text="ai intelligence market",
                markdown="ai intelligence",
                platform="X",
                sourceId=request.source_id,
                sourceType="SOCIAL_MEDIA",
            ),
            CleanItem(
                title="Random life",
                text="weekend travel notes",
                markdown="travel notes",
                platform="X",
                sourceId=request.source_id,
                sourceType="SOCIAL_MEDIA",
            ),
        ]


def _client_with_stub_driver(monkeypatch) -> TestClient:
    registry = DriverRegistry(default_driver="playwright")
    registry.register("playwright", StubKeywordDriver())
    monkeypatch.setattr(main, "driver_registry", registry)
    return TestClient(main.app)


def test_keyword_hit_content_persisted(monkeypatch):
    client = _client_with_stub_driver(monkeypatch)
    response = client.post(
        "/v2/fetch",
        json={
            "platform": "hit-only",
            "sourceId": "source-hit",
            "driverOptions": {"filters": {"keyword": {"keywords": ["ai", "regulation"]}}},
        },
    )

    assert response.status_code == 200
    items = response.json()
    assert len(items) == 1
    assert items[0]["matchedKeywords"] == ["ai", "regulation"]
    assert items[0]["keywordMatchScore"] == 1.0


def test_keyword_miss_content_not_persisted(monkeypatch, capsys):
    client = _client_with_stub_driver(monkeypatch)
    response = client.post(
        "/v2/fetch",
        json={
            "platform": "miss-only",
            "sourceId": "source-miss",
            "driverOptions": {"filters": {"keyword": {"keywords": ["ai"]}}},
        },
    )

    assert response.status_code == 200
    assert response.json() == []
    output = capsys.readouterr().out
    assert "[gather][keyword-filter][audit]" in output


def test_keyword_hit_only_persisted_miss_audit_only(monkeypatch, capsys):
    client = _client_with_stub_driver(monkeypatch)
    response = client.post(
        "/v2/fetch",
        json={
            "platform": "mixed",
            "sourceId": "source-mixed",
            "driverOptions": {"filters": {"keyword": {"keywords": ["ai"]}}},
        },
    )

    assert response.status_code == 200
    items = response.json()
    assert len(items) == 1
    assert items[0]["title"] == "AI signal"
    output = capsys.readouterr().out
    assert "[gather][keyword-filter][audit]" in output


def test_keyword_filter_metrics_emitted(monkeypatch, capsys):
    client = _client_with_stub_driver(monkeypatch)
    response = client.post(
        "/v2/fetch",
        json={
            "platform": "mixed",
            "sourceId": "source-metrics",
            "driverOptions": {"filters": {"keyword": {"keywords": ["ai"]}}},
        },
    )

    assert response.status_code == 200
    metrics_line = capsys.readouterr().out
    assert "[gather][keyword-filter][metrics]" in metrics_line
    assert '"fetched": 2' in metrics_line
    assert '"hit": 1' in metrics_line
    assert '"miss": 1' in metrics_line
    assert '"persisted": 1' in metrics_line


def test_keyword_filter_invalid_config_fails_closed(monkeypatch, capsys):
    client = _client_with_stub_driver(monkeypatch)
    response = client.post(
        "/v2/fetch",
        json={
            "platform": "mixed",
            "sourceId": "source-invalid",
            "driverOptions": {"filters": {"keyword": {"keywords": []}}},
        },
    )

    assert response.status_code == 400
    payload = response.json()
    assert payload["error"]["code"] == "FETCH_BAD_REQUEST"
    assert "keyword filter invalid config" in payload["error"]["message"]
    assert "error" in capsys.readouterr().out


def test_keyword_segment_scope_keeps_only_matched_segments(monkeypatch):
    client = _client_with_stub_driver(monkeypatch)
    response = client.post(
        "/v2/fetch",
        json={
            "platform": "chat-batch",
            "sourceId": "source-chat-segment",
            "driverOptions": {
                "filters": {
                    "keyword": {
                        "keywords": ["alpha"],
                        "matchScope": "segment",
                        "splitMode": "line",
                    }
                }
            },
        },
    )

    assert response.status_code == 200
    items = response.json()
    assert len(items) == 1
    assert "alpha launch is live" in items[0]["text"]
    assert items[0]["matchedKeywords"] == ["alpha"]
    assert items[0]["title"].endswith("[segment 3]")


def test_keyword_segment_scope_supports_min_segment_chars(monkeypatch):
    client = _client_with_stub_driver(monkeypatch)
    response = client.post(
        "/v2/fetch",
        json={
            "platform": "chat-batch",
            "sourceId": "source-chat-min-chars",
            "driverOptions": {
                "filters": {
                    "keyword": {
                        "keywords": ["alpha"],
                        "matchScope": "segment",
                        "splitMode": "line",
                        "minChars": 30,
                    }
                }
            },
        },
    )

    assert response.status_code == 200
    items = response.json()
    assert len(items) == 1
    assert "alpha launch is live" in items[0]["text"]
