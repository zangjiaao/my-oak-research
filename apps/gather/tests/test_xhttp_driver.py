import asyncio
import hashlib
import hmac
import sys
from pathlib import Path

import pytest
from fastapi import HTTPException

ROOT_DIR = Path(__file__).resolve().parents[1]
if str(ROOT_DIR) not in sys.path:
    sys.path.insert(0, str(ROOT_DIR))

from schemas import FetchRequest
from drivers.xhttp_driver import XHttpDriver, _resolve_xhttp_urls


def test_resolve_xhttp_urls_rejects_missing_url():
    with pytest.raises(HTTPException) as error:
        _resolve_xhttp_urls({})
    assert error.value.status_code == 400


def test_xhttp_fetch_data_extracts_html_text(monkeypatch):
    calls = []

    class FakeResponse:
        def __init__(self):
            self.headers = {"content-type": "text/html"}
            self.text = "<html><head><title>Hello</title></head><body><h1>World</h1></body></html>"
            self.url = "https://example.com"

        def raise_for_status(self):
            return None

    class FakeClient:
        def __init__(self, *args, **kwargs):  # noqa: ARG002
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, exc_type, exc, tb):  # noqa: ARG002
            return False

        async def request(self, method, url, headers=None, params=None, json=None, data=None, content=None):  # noqa: ARG002
            calls.append(
                {
                    "method": method,
                    "url": url,
                    "headers": headers,
                    "params": params,
                    "json": json,
                    "data": data,
                    "content": content,
                }
            )
            return FakeResponse()

    from drivers import xhttp_driver

    monkeypatch.setattr(xhttp_driver.httpx, "AsyncClient", FakeClient)

    request = FetchRequest(
        platform="x",
        source_id="source-1",
        config={"url": "https://example.com"},
    )
    items = asyncio.run(XHttpDriver().fetch(request))
    assert len(items) == 1
    assert items[0]["title"] == "Hello"
    assert "World" in (items[0]["text"] or "")
    assert items[0]["recordType"] == "xhttp"
    assert calls and calls[0]["method"] == "GET"


def test_xhttp_fetch_data_supports_post_json_with_signature(monkeypatch):
    calls = []

    class FakeResponse:
        def __init__(self):
            self.headers = {"content-type": "application/json"}
            self.url = "https://api.example.com/search"
            self.text = "{\"ok\":true}"

        def raise_for_status(self):
            return None

        def json(self):
            return {"ok": True}

    class FakeClient:
        def __init__(self, *args, **kwargs):  # noqa: ARG002
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, exc_type, exc, tb):  # noqa: ARG002
            return False

        async def request(self, method, url, headers=None, params=None, json=None, data=None, content=None):  # noqa: ARG002
            calls.append(
                {
                    "method": method,
                    "url": url,
                    "headers": headers or {},
                    "params": params or {},
                    "json": json,
                    "data": data,
                    "content": content,
                }
            )
            return FakeResponse()

    from drivers import xhttp_driver

    monkeypatch.setattr(xhttp_driver.httpx, "AsyncClient", FakeClient)
    monkeypatch.setattr(xhttp_driver.time, "time", lambda: 1710000000)
    monkeypatch.setattr(xhttp_driver.secrets, "token_hex", lambda _: "abc12345")

    request = FetchRequest(
        platform="x",
        source_id="source-1",
        config={
            "url": "https://api.example.com/search",
            "method": "POST",
            "params": {"q": "openai"},
            "json": {"query": "openai"},
            "signature": {
                "secret": "demo-secret",
                "source": "query",
                "timestampField": "ts",
                "nonceField": "nonce",
                "fields": ["q", "ts", "nonce"],
                "target": "header",
                "header": "X-Signature",
            },
        },
    )
    items = asyncio.run(XHttpDriver().fetch(request))

    assert len(items) == 1
    assert calls and calls[0]["method"] == "POST"
    assert calls[0]["params"]["q"] == "openai"
    assert calls[0]["params"]["ts"] == 1710000000
    assert calls[0]["params"]["nonce"] == "abc12345"
    expected = hmac.new(
        b"demo-secret",
        b"q=openai&ts=1710000000&nonce=abc12345",
        hashlib.sha256,
    ).hexdigest()
    assert calls[0]["headers"]["X-Signature"] == expected


def test_xhttp_fetch_data_supports_network_proxy(monkeypatch):
    client_kwargs = {}

    class FakeResponse:
        def __init__(self):
            self.headers = {"content-type": "application/json"}
            self.url = "https://api.example.com/search"
            self.text = "{\"ok\":true}"

        def raise_for_status(self):
            return None

        def json(self):
            return {"ok": True}

    class FakeClient:
        def __init__(self, *args, **kwargs):
            client_kwargs.update(kwargs)

        async def __aenter__(self):
            return self

        async def __aexit__(self, exc_type, exc, tb):  # noqa: ARG002
            return False

        async def request(self, method, url, headers=None, params=None, json=None, data=None, content=None):  # noqa: ARG002
            return FakeResponse()

    from drivers import xhttp_driver

    monkeypatch.setattr(xhttp_driver.httpx, "AsyncClient", FakeClient)

    request = FetchRequest(
        platform="x",
        source_id="source-1",
        config={
            "url": "https://api.example.com/search",
            "network": {
                "proxy": {
                    "url": "socks5h://127.0.0.1:9050",
                }
            },
        },
    )
    asyncio.run(XHttpDriver().fetch(request))

    assert client_kwargs["proxy"] == "socks5h://127.0.0.1:9050"
