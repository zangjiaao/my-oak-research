import asyncio
import sys
from pathlib import Path

import pytest
from fastapi import HTTPException

ROOT_DIR = Path(__file__).resolve().parents[1]
if str(ROOT_DIR) not in sys.path:
    sys.path.insert(0, str(ROOT_DIR))

import main
from main import FetchRequest


def test_resolve_xhttp_urls_rejects_missing_url():
    with pytest.raises(HTTPException) as error:
        main._resolve_xhttp_urls({})
    assert error.value.status_code == 400


def test_xhttp_fetch_data_extracts_html_text(monkeypatch):
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

        async def get(self, url, headers=None):  # noqa: ARG002
            return FakeResponse()

    monkeypatch.setattr(main.httpx, "AsyncClient", FakeClient)

    request = FetchRequest(
        platform="x",
        source_id="source-1",
        config={"url": "https://example.com"},
    )
    items = asyncio.run(main._xhttp_fetch_data(request))
    assert len(items) == 1
    assert items[0].title == "Hello"
    assert "World" in (items[0].text or "")
    assert items[0].recordType == "xhttp"
