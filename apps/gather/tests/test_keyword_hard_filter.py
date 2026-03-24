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
        if request.platform == "scope-case":
            return [
                CleanItem(
                    title="Scope case",
                    text="no keyword here",
                    markdown="no keyword here",
                    platform="X",
                    sourceId=request.source_id,
                    sourceType="SOCIAL_MEDIA",
                    recordContent={
                        "query": "polymarket forecast",
                        "text": "no keyword here",
                    },
                )
            ]
        if request.platform == "ascii-substring-miss":
            return [
                CleanItem(
                    title="International update",
                    text="Airport and campaign updates are highlighted",
                    markdown="Airport and campaign updates are highlighted",
                    platform="BBC",
                    sourceId=request.source_id,
                    sourceType="SOCIAL_MEDIA",
                    recordContent={
                        "title": "International update",
                        "description": "Airport and campaign updates are highlighted",
                    },
                )
            ]
        if request.platform == "ascii-word-hit":
            return [
                CleanItem(
                    title="AI policy",
                    text="AI regulation update",
                    markdown="AI regulation update",
                    platform="BBC",
                    sourceId=request.source_id,
                    sourceType="SOCIAL_MEDIA",
                    recordContent={
                        "title": "AI policy",
                        "description": "AI regulation update",
                    },
                )
            ]
        if request.platform == "term-and-hit":
            return [
                CleanItem(
                    title="Openclaw release",
                    text="Openclaw latest memory improvements are published",
                    markdown="Openclaw latest memory improvements are published",
                    platform="BBC",
                    sourceId=request.source_id,
                    sourceType="SOCIAL_MEDIA",
                    recordContent={
                        "title": "Openclaw release",
                        "description": "Openclaw latest memory improvements are published",
                    },
                )
            ]
        if request.platform == "url-only":
            return [
                CleanItem(
                    title="World update",
                    text="General world update",
                    markdown="General world update",
                    platform="BBC",
                    sourceId=request.source_id,
                    sourceType="SOCIAL_MEDIA",
                    recordContent={
                        "title": "World update",
                        "description": "General world update",
                        "url": "https://example.com/news?at_campaign=world_ai_alert",
                    },
                )
            ]
        if request.platform == "cjk-hit":
            return [
                CleanItem(
                    title="科技动态",
                    text="这篇文章讨论人工智能行业发展",
                    markdown="这篇文章讨论人工智能行业发展",
                    platform="36kr",
                    sourceId=request.source_id,
                    sourceType="SOCIAL_MEDIA",
                    recordContent={
                        "title": "科技动态",
                        "description": "这篇文章讨论人工智能行业发展",
                    },
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
            "keywords": ["ai", "regulation"],
            "driver": {"name": "playwright", "option": {}, "filter": {}},
            "output": {"field": ["text", "markdown"]},
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
            "keywords": ["ai"],
            "driver": {"name": "playwright", "option": {}, "filter": {}},
            "output": {"field": ["text", "markdown"]},
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
            "keywords": ["ai"],
            "driver": {"name": "playwright", "option": {}, "filter": {}},
            "output": {"field": ["text", "markdown"]},
        },
    )

    assert response.status_code == 200
    items = response.json()
    assert len(items) == 1
    assert "ai intelligence market" in items[0]["recordContent"]["text"]
    output = capsys.readouterr().out
    assert "[gather][keyword-filter][audit]" in output


def test_keyword_filter_metrics_emitted(monkeypatch, capsys):
    client = _client_with_stub_driver(monkeypatch)
    response = client.post(
        "/v2/fetch",
        json={
            "platform": "mixed",
            "sourceId": "source-metrics",
            "keywords": ["ai"],
            "driver": {"name": "playwright", "option": {}, "filter": {}},
            "output": {"field": ["text", "markdown"]},
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
            "keywords": ["ai"],
            "driver": {"name": "playwright", "option": {}, "filter": {"minChars": 0}},
            "output": {"field": ["text", "markdown"]},
        },
    )

    assert response.status_code == 400
    payload = response.json()
    assert payload["error"]["code"] == "FETCH_BAD_REQUEST"
    assert "keyword filter invalid config" in payload["error"]["message"]
    assert "error" in capsys.readouterr().out


def test_keyword_min_chars_keeps_record_when_content_is_long_enough(monkeypatch):
    client = _client_with_stub_driver(monkeypatch)
    response = client.post(
        "/v2/fetch",
        json={
            "platform": "chat-batch",
            "sourceId": "source-chat-min",
            "keywords": ["alpha"],
            "driver": {
                "name": "playwright",
                "option": {},
                "filter": {
                    "minChars": 20,
                },
            },
            "output": {"field": ["text", "markdown"]},
        },
    )

    assert response.status_code == 200
    items = response.json()
    assert len(items) == 1
    assert "alpha launch is live" in items[0]["recordContent"]["text"]
    assert items[0]["matchedKeywords"] == ["alpha"]


def test_keyword_min_chars_filters_out_short_content(monkeypatch):
    client = _client_with_stub_driver(monkeypatch)
    response = client.post(
        "/v2/fetch",
        json={
            "platform": "chat-batch",
            "sourceId": "source-chat-too-short",
            "keywords": ["alpha"],
            "driver": {
                "name": "playwright",
                "option": {},
                "filter": {
                    "minChars": 500,
                },
            },
            "output": {"field": ["text", "markdown"]},
        },
    )

    assert response.status_code == 200
    assert response.json() == []


def test_keyword_filter_rejects_split_mode(monkeypatch):
    client = _client_with_stub_driver(monkeypatch)
    response = client.post(
        "/v2/fetch",
        json={
            "platform": "chat-batch",
            "sourceId": "source-chat-split-mode",
            "keywords": ["alpha"],
            "driver": {
                "name": "playwright",
                "option": {},
                "filter": {
                    "splitMode": "line",
                },
            },
            "output": {"field": ["text", "markdown"]},
        },
    )

    assert response.status_code == 400
    payload = response.json()
    assert payload["error"]["code"] == "FETCH_BAD_REQUEST"
    assert "splitMode has been removed" in payload["error"]["message"]


def test_keyword_scope_fields_limit_matching(monkeypatch):
    client = _client_with_stub_driver(monkeypatch)
    response = client.post(
        "/v2/fetch",
        json={
            "platform": "scope-case",
            "sourceId": "source-scope",
            "keywords": ["polymarket"],
            "driver": {"name": "playwright", "option": {}, "filter": {"minChars": 3}},
            "output": {"field": ["query", "text"], "keywordScope": ["text"]},
        },
    )

    assert response.status_code == 200
    assert response.json() == []


def test_short_ascii_keyword_does_not_match_substring(monkeypatch):
    client = _client_with_stub_driver(monkeypatch)
    response = client.post(
        "/v2/fetch",
        json={
            "platform": "ascii-substring-miss",
            "sourceId": "source-ascii-substring-miss",
            "keywords": ["ai"],
            "driver": {"name": "playwright", "option": {}, "filter": {}},
            "output": {"field": ["title", "description"]},
        },
    )

    assert response.status_code == 200
    assert response.json() == []


def test_short_ascii_keyword_matches_whole_word_case_insensitive(monkeypatch):
    client = _client_with_stub_driver(monkeypatch)
    response = client.post(
        "/v2/fetch",
        json={
            "platform": "ascii-word-hit",
            "sourceId": "source-ascii-word-hit",
            "keywords": ["ai"],
            "driver": {"name": "playwright", "option": {}, "filter": {}},
            "output": {"field": ["title", "description"]},
        },
    )

    assert response.status_code == 200
    items = response.json()
    assert len(items) == 1
    assert items[0]["matchedKeywords"] == ["ai"]


def test_keyword_filter_excludes_url_by_default(monkeypatch):
    client = _client_with_stub_driver(monkeypatch)
    response = client.post(
        "/v2/fetch",
        json={
            "platform": "url-only",
            "sourceId": "source-url-only-default",
            "keywords": ["ai"],
            "driver": {"name": "playwright", "option": {}, "filter": {}},
            "output": {"field": ["title", "description", "url"]},
        },
    )

    assert response.status_code == 200
    assert response.json() == []


def test_keyword_filter_can_include_url_when_enabled(monkeypatch):
    client = _client_with_stub_driver(monkeypatch)
    response = client.post(
        "/v2/fetch",
        json={
            "platform": "url-only",
            "sourceId": "source-url-only-include",
            "keywords": ["ai"],
            "driver": {
                "name": "playwright",
                "option": {},
                "filter": {
                    "includeFields": ["url"],
                    "matchMode": "contains",
                },
            },
            "output": {"field": ["title", "description", "url"]},
        },
    )

    assert response.status_code == 200
    items = response.json()
    assert len(items) == 1
    assert items[0]["matchedKeywords"] == ["ai"]


def test_cjk_keyword_matches_content(monkeypatch):
    client = _client_with_stub_driver(monkeypatch)
    response = client.post(
        "/v2/fetch",
        json={
            "platform": "cjk-hit",
            "sourceId": "source-cjk-hit",
            "keywords": ["人工智能"],
            "driver": {"name": "playwright", "option": {}, "filter": {}},
            "output": {"field": ["title", "description"]},
        },
    )

    assert response.status_code == 200
    items = response.json()
    assert len(items) == 1
    assert items[0]["matchedKeywords"] == ["人工智能"]


def test_single_cjk_keyword_filtered_by_min_cjk_chars(monkeypatch):
    client = _client_with_stub_driver(monkeypatch)
    response = client.post(
        "/v2/fetch",
        json={
            "platform": "cjk-hit",
            "sourceId": "source-cjk-short-keyword",
            "keywords": ["智"],
            "driver": {"name": "playwright", "option": {}, "filter": {}},
            "output": {"field": ["title", "description"]},
        },
    )

    assert response.status_code == 200
    assert response.json() == []


def test_term_and_word_boundary_mode_matches_split_terms(monkeypatch):
    client = _client_with_stub_driver(monkeypatch)
    response = client.post(
        "/v2/fetch",
        json={
            "platform": "term-and-hit",
            "sourceId": "source-term-and-hit",
            "keywords": ["openclaw memory"],
            "driver": {
                "name": "playwright",
                "option": {},
                "filter": {"matchMode": "term_and_word_boundary"},
            },
            "output": {"field": ["title", "description"]},
        },
    )

    assert response.status_code == 200
    items = response.json()
    assert len(items) == 1
    assert items[0]["matchedKeywords"] == ["openclaw memory"]


def test_term_and_word_boundary_mode_still_avoids_airport_false_positive(monkeypatch):
    client = _client_with_stub_driver(monkeypatch)
    response = client.post(
        "/v2/fetch",
        json={
            "platform": "ascii-substring-miss",
            "sourceId": "source-term-and-airport",
            "keywords": ["ai"],
            "driver": {
                "name": "playwright",
                "option": {},
                "filter": {"matchMode": "term_and_word_boundary"},
            },
            "output": {"field": ["title", "description"]},
        },
    )

    assert response.status_code == 200
    assert response.json() == []
