"""xhttp driver for lightweight HTTP fetching without browser automation."""
from __future__ import annotations

import re
from datetime import datetime
from html import unescape
from typing import Any
from urllib.parse import urlparse

import httpx
from fastapi import HTTPException

from .base_driver import BaseDriver


def _strip_html_text(html: str) -> str:
    no_script = re.sub(r"<script[\s\S]*?</script>", " ", html, flags=re.IGNORECASE)
    no_style = re.sub(r"<style[\s\S]*?</style>", " ", no_script, flags=re.IGNORECASE)
    no_tags = re.sub(r"<[^>]+>", " ", no_style)
    normalized = re.sub(r"\s+", " ", unescape(no_tags)).strip()
    return normalized


def _extract_html_title(html: str) -> str | None:
    matched = re.search(r"<title[^>]*>(.*?)</title>", html, flags=re.IGNORECASE | re.DOTALL)
    if not matched:
        return None
    title = re.sub(r"\s+", " ", unescape(matched.group(1))).strip()
    return title or None


def _resolve_xhttp_urls(config: dict[str, Any]) -> list[str]:
    raw_urls = config.get("urls")
    if raw_urls is None:
        raw_url = config.get("url")
        if raw_url is None:
            raise HTTPException(status_code=400, detail="xhttp requires config.url or config.urls")
        raw_urls = [raw_url]
    if not isinstance(raw_urls, list) or not raw_urls:
        raise HTTPException(status_code=400, detail="config.urls must be a non-empty array")

    urls: list[str] = []
    for raw_url in raw_urls:
        if not isinstance(raw_url, str) or not raw_url.strip():
            raise HTTPException(status_code=400, detail="config.urls must contain non-empty strings")
        parsed = urlparse(raw_url.strip())
        if parsed.scheme not in {"http", "https"}:
            raise HTTPException(status_code=400, detail="xhttp only supports http/https urls")
        urls.append(raw_url.strip())
    return urls


class XHttpDriver(BaseDriver):
    async def verify_auth(self, request: Any) -> Any:  # noqa: ANN401
        return {
            "valid": True,
            "message": "xhttp driver does not require auth verification",
            "details": {"platform": request.platform, "driver": "xhttp"},
        }

    async def fetch(self, request: Any) -> list[Any]:  # noqa: ANN401
        config = request.config
        urls = _resolve_xhttp_urls(config)
        headers = config.get("headers", {})
        timeout_seconds = config.get("timeoutSeconds", 15)
        max_chars = int(config.get("maxChars", 20000))
        if max_chars < 1000:
            max_chars = 1000

        if headers is None:
            headers = {}
        if not isinstance(headers, dict):
            raise HTTPException(status_code=400, detail="config.headers must be an object")
        safe_headers = {
            str(k): str(v)
            for k, v in headers.items()
            if isinstance(k, str) and isinstance(v, (str, int, float, bool))
        }

        results: list[Any] = []
        async with httpx.AsyncClient(timeout=float(timeout_seconds), follow_redirects=True) as client:
            for target_url in urls:
                try:
                    response = await client.get(target_url, headers=safe_headers)
                    response.raise_for_status()
                except httpx.HTTPError as error:
                    raise HTTPException(
                        status_code=502, detail=f"xhttp request failed for {target_url}: {error}"
                    ) from error

                content_type = response.headers.get("content-type", "").lower()
                text = response.text
                if "html" in content_type:
                    title = _extract_html_title(text)
                    plain_text = _strip_html_text(text)
                    markdown = plain_text[:max_chars]
                else:
                    title = None
                    plain_text = text.strip()
                    markdown = plain_text[:max_chars]

                results.append(
                    {
                        "title": title,
                        "text": plain_text[:max_chars],
                        "markdown": markdown,
                        "platform": request.platform,
                        "url": str(response.url),
                        "sourceId": request.source_id,
                        "sourceType": "SOCIAL_MEDIA",
                        "time": datetime.now(),
                        "recordType": "xhttp",
                    }
                )

        return results
