from pathlib import Path
import sys

from fastapi.testclient import TestClient
import pytest


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
                    "keyword": args.get("keyword"),
                    "bvid": args.get("bvid"),
                    "order": args.get("order"),
                    "sort": args.get("sort"),
                    "category": args.get("category"),
                    "feed_type": args.get("type"),
                    "video_url": args.get("url"),
                    "channel_id": args.get("id"),
                    "uid": args.get("uid"),
                    "max_id": args.get("max_id"),
                    "page": args.get("page"),
                    "feature": args.get("feature"),
                    "lang": args.get("lang"),
                    "transcript_mode": args.get("mode"),
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


def test_fetch_v3_bbc_news_intent_maps_mode_and_limit(monkeypatch):
    response = _client_with_stub_driver(monkeypatch).post(
        "/v3/fetch",
        json={
            "platform": "bbc",
            "sourceId": "source_123",
            "intent": {"type": "news", "args": {"limit": 12}},
            "keywords": [],
            "driver": {"name": "playwright", "option": {}},
            "output": {"field": ["count", "mode"], "type": "bbc-news"},
        },
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["meta"]["adapter"] == "bbc.news"
    assert payload["items"][0]["recordContent"]["count"] == "12"
    assert payload["items"][0]["recordContent"]["mode"] == "intercept-bbc-news"


def test_fetch_v3_hackernews_top_intent_maps_mode_and_limit(monkeypatch):
    response = _client_with_stub_driver(monkeypatch).post(
        "/v3/fetch",
        json={
            "platform": "hackernews",
            "sourceId": "source_123",
            "intent": {"type": "top", "args": {"limit": 15}},
            "keywords": [],
            "driver": {"name": "playwright", "option": {}},
            "output": {"field": ["count", "mode"], "type": "hn-top"},
        },
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["meta"]["adapter"] == "hackernews.top"
    assert payload["items"][0]["recordContent"]["count"] == "15"
    assert payload["items"][0]["recordContent"]["mode"] == "intercept-hackernews-top"


def test_fetch_v3_linkedin_search_maps_mode_and_args(monkeypatch):
    response = _client_with_stub_driver(monkeypatch).post(
        "/v3/fetch",
        json={
            "platform": "linkedin",
            "sourceId": "source_123",
            "intent": {
                "type": "search",
                "args": {
                    "query": "software engineer",
                    "location": "San Francisco",
                    "start": 5,
                    "limit": 10,
                },
            },
            "keywords": [],
            "driver": {"name": "playwright", "option": {}},
            "output": {"field": ["query", "count", "mode"], "type": "linkedin-job"},
        },
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["meta"]["adapter"] == "linkedin.search"
    assert payload["items"][0]["recordContent"]["query"] == "software engineer"
    assert payload["items"][0]["recordContent"]["count"] == "10"
    assert payload["items"][0]["recordContent"]["mode"] == "intercept-linkedin-search"


def test_fetch_v3_linux_do_search_maps_mode_and_keyword(monkeypatch):
    response = _client_with_stub_driver(monkeypatch).post(
        "/v3/fetch",
        json={
            "platform": "linux-do",
            "sourceId": "source_123",
            "intent": {
                "type": "search",
                "args": {
                    "keyword": "playwright",
                    "limit": 10,
                },
            },
            "keywords": [],
            "driver": {"name": "playwright", "option": {}},
            "output": {"field": ["keyword", "count", "mode"], "type": "linux-do-topic"},
        },
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["meta"]["adapter"] == "linux-do.search"
    assert payload["items"][0]["recordContent"]["keyword"] == "playwright"
    assert payload["items"][0]["recordContent"]["count"] == "10"
    assert payload["items"][0]["recordContent"]["mode"] == "intercept-linux-do-search"


def test_fetch_v3_youtube_search_maps_mode(monkeypatch):
    response = _client_with_stub_driver(monkeypatch).post(
        "/v3/fetch",
        json={
            "platform": "youtube",
            "sourceId": "source_123",
            "intent": {"type": "search", "args": {"query": "openai", "limit": 12}},
            "keywords": [],
            "driver": {"name": "playwright", "option": {}},
            "output": {"field": ["query", "count", "mode"], "type": "youtube-video"},
        },
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["meta"]["adapter"] == "youtube.search"
    assert payload["items"][0]["recordContent"]["query"] == "openai"
    assert payload["items"][0]["recordContent"]["count"] == "12"
    assert payload["items"][0]["recordContent"]["mode"] == "intercept-youtube-search"


def test_fetch_v3_youtube_transcript_maps_url_lang_mode(monkeypatch):
    response = _client_with_stub_driver(monkeypatch).post(
        "/v3/fetch",
        json={
            "platform": "youtube",
            "sourceId": "source_123",
            "intent": {
                "type": "transcript",
                "args": {
                    "url": "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
                    "lang": "en",
                    "mode": "raw",
                    "limit": 8,
                },
            },
            "keywords": [],
            "driver": {"name": "playwright", "option": {}},
            "output": {"field": ["video_url", "lang", "transcript_mode", "count", "mode"], "type": "youtube-transcript"},
        },
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["meta"]["adapter"] == "youtube.transcript"
    assert payload["items"][0]["recordContent"]["video_url"] == "https://www.youtube.com/watch?v=dQw4w9WgXcQ"
    assert payload["items"][0]["recordContent"]["lang"] == "en"
    assert payload["items"][0]["recordContent"]["transcript_mode"] == "raw"
    assert payload["items"][0]["recordContent"]["count"] == "8"
    assert payload["items"][0]["recordContent"]["mode"] == "intercept-youtube-transcript"


def test_fetch_v3_youtube_channel_maps_channel_id(monkeypatch):
    response = _client_with_stub_driver(monkeypatch).post(
        "/v3/fetch",
        json={
            "platform": "youtube",
            "sourceId": "source_123",
            "intent": {
                "type": "channel",
                "args": {
                    "id": "@openai",
                    "limit": 6,
                },
            },
            "keywords": [],
            "driver": {"name": "playwright", "option": {}},
            "output": {"field": ["channel_id", "count", "mode"], "type": "youtube-channel"},
        },
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["meta"]["adapter"] == "youtube.channel"
    assert payload["items"][0]["recordContent"]["channel_id"] == "@openai"
    assert payload["items"][0]["recordContent"]["count"] == "6"
    assert payload["items"][0]["recordContent"]["mode"] == "intercept-youtube-channel"


def test_fetch_v3_weibo_user_posts_maps_mode_and_args(monkeypatch):
    response = _client_with_stub_driver(monkeypatch).post(
        "/v3/fetch",
        json={
            "platform": "weibo",
            "sourceId": "source_123",
            "intent": {
                "type": "user_posts",
                "args": {
                    "uid": "1654184992",
                    "page": 2,
                    "feature": 3,
                    "limit": 9,
                },
            },
            "keywords": [],
            "driver": {"name": "playwright", "option": {}},
            "output": {"field": ["uid", "page", "feature", "count", "mode"], "type": "weibo-post"},
        },
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["meta"]["adapter"] == "weibo.user_posts"
    assert payload["items"][0]["recordContent"]["uid"] == "1654184992"
    assert payload["items"][0]["recordContent"]["page"] == 2
    assert payload["items"][0]["recordContent"]["feature"] == 3
    assert payload["items"][0]["recordContent"]["count"] == "9"
    assert payload["items"][0]["recordContent"]["mode"] == "intercept-weibo-user_posts"


def test_fetch_v3_zhihu_search_maps_keyword_and_mode(monkeypatch):
    response = _client_with_stub_driver(monkeypatch).post(
        "/v3/fetch",
        json={
            "platform": "zhihu",
            "sourceId": "source_123",
            "intent": {
                "type": "search",
                "args": {
                    "query": "openai",
                    "limit": 8,
                },
            },
            "keywords": [],
            "driver": {"name": "playwright", "option": {}},
            "output": {"field": ["query", "keyword", "count", "mode"], "type": "zhihu-search"},
        },
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["meta"]["adapter"] == "zhihu.search"
    assert payload["items"][0]["recordContent"]["query"] == "openai"
    assert payload["items"][0]["recordContent"]["keyword"] == "openai"
    assert payload["items"][0]["recordContent"]["count"] == "8"
    assert payload["items"][0]["recordContent"]["mode"] == "intercept-zhihu-search"


def test_fetch_v3_zhihu_question_maps_id_and_mode(monkeypatch):
    response = _client_with_stub_driver(monkeypatch).post(
        "/v3/fetch",
        json={
            "platform": "zhihu",
            "sourceId": "source_123",
            "intent": {
                "type": "question",
                "args": {
                    "question_id": "34816524",
                    "limit": 5,
                },
            },
            "keywords": [],
            "driver": {"name": "playwright", "option": {}},
            "output": {"field": ["count", "mode"], "type": "zhihu-question"},
        },
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["meta"]["adapter"] == "zhihu.question"
    assert payload["items"][0]["recordContent"]["count"] == "5"
    assert payload["items"][0]["recordContent"]["mode"] == "intercept-zhihu-question"


def test_fetch_v3_bilibili_search_maps_keyword_order_page_and_mode(monkeypatch):
    response = _client_with_stub_driver(monkeypatch).post(
        "/v3/fetch",
        json={
            "platform": "bilibili",
            "sourceId": "source_123",
            "intent": {
                "type": "search",
                "args": {
                    "query": "openai",
                    "order": "pubdate",
                    "page": 2,
                    "limit": 9,
                },
            },
            "keywords": [],
            "driver": {"name": "playwright", "option": {}},
            "output": {"field": ["keyword", "order", "page", "count", "mode"], "type": "bilibili-video"},
        },
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["meta"]["adapter"] == "bilibili.search"
    assert payload["items"][0]["recordContent"]["keyword"] == "openai"
    assert payload["items"][0]["recordContent"]["order"] == "pubdate"
    assert payload["items"][0]["recordContent"]["page"] == 2
    assert payload["items"][0]["recordContent"]["count"] == "9"
    assert payload["items"][0]["recordContent"]["mode"] == "intercept-bilibili-search"


def test_fetch_v3_bilibili_video_maps_bvid_and_mode(monkeypatch):
    response = _client_with_stub_driver(monkeypatch).post(
        "/v3/fetch",
        json={
            "platform": "bilibili",
            "sourceId": "source_123",
            "intent": {
                "type": "video",
                "args": {
                    "bvid": "BV1LGwHzrE4A",
                    "limit": 3,
                },
            },
            "keywords": [],
            "driver": {"name": "playwright", "option": {}},
            "output": {"field": ["bvid", "count", "mode"], "type": "bilibili-video"},
        },
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["meta"]["adapter"] == "bilibili.video"
    assert payload["items"][0]["recordContent"]["bvid"] == "BV1LGwHzrE4A"
    assert payload["items"][0]["recordContent"]["count"] == "3"
    assert payload["items"][0]["recordContent"]["mode"] == "intercept-bilibili-video"


@pytest.mark.parametrize(
    ("platform", "intent_type", "intent_args", "expected_mode"),
    [
        ("36kr", "newsflash", {"limit": 8}, "intercept-36kr-newsflash"),
        ("arxiv", "search", {"query": "llm", "limit": 6}, "intercept-arxiv-search"),
        ("baidu", "search", {"query": "openai", "limit": 5}, "intercept-baidu-search"),
        ("bing", "search", {"query": "openai", "limit": 5}, "intercept-bing-search"),
        ("cnblogs", "search", {"query": "python", "page": 2, "limit": 5}, "intercept-cnblogs-search"),
        ("csdn", "search", {"query": "python", "page": 2, "limit": 5}, "intercept-csdn-search"),
        ("ctrip", "search", {"query": "sanya", "limit": 5}, "intercept-ctrip-search"),
        ("devto", "search", {"query": "rust", "limit": 5}, "intercept-devto-search"),
        ("duckduckgo", "search", {"query": "openai", "limit": 5}, "intercept-duckduckgo-search"),
        ("google", "search", {"query": "openai", "limit": 5}, "intercept-google-search"),
        ("reuters", "search", {"query": "ai", "limit": 5}, "intercept-reuters-search"),
        ("toutiao", "search", {"query": "ai", "limit": 5}, "intercept-toutiao-search"),
        ("toutiao", "hot", {"limit": 5}, "intercept-toutiao-hot"),
        ("hupu", "hot", {"limit": 5}, "intercept-hupu-hot"),
    ],
)
def test_fetch_v3_new_web_sources_map_mode(monkeypatch, platform, intent_type, intent_args, expected_mode):
    response = _client_with_stub_driver(monkeypatch).post(
        "/v3/fetch",
        json={
            "platform": platform,
            "sourceId": "source_123",
            "intent": {"type": intent_type, "args": intent_args},
            "keywords": [],
            "driver": {"name": "playwright", "option": {}},
            "output": {"field": ["mode"], "type": f"{platform}-{intent_type}"},
        },
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["meta"]["adapter"] == f"{platform}.{intent_type}"
    assert payload["items"][0]["recordContent"]["mode"] == expected_mode


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
