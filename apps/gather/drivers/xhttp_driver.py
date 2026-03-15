"""xhttp driver for lightweight HTTP fetching without browser automation."""
from __future__ import annotations

import base64
import copy
import hashlib
import hmac
import json
import os
import re
import secrets
import time
from datetime import datetime
from html import unescape
from typing import Any
from urllib.parse import quote, urlparse, urlunparse

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


def _resolve_method(config: dict[str, Any]) -> str:
    method = str(config.get("method", "GET")).upper().strip()
    if method not in {"GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"}:
        raise HTTPException(status_code=400, detail=f"xhttp unsupported method: {method}")
    return method


def _resolve_params(config: dict[str, Any]) -> dict[str, Any]:
    raw_params = config.get("params", {})
    if raw_params is None:
        return {}
    if not isinstance(raw_params, dict):
        raise HTTPException(status_code=400, detail="config.params must be an object")
    params: dict[str, Any] = {}
    for key, value in raw_params.items():
        if not isinstance(key, str) or not key.strip():
            raise HTTPException(status_code=400, detail="config.params keys must be non-empty strings")
        if value is None:
            continue
        if isinstance(value, (str, int, float, bool)):
            params[key] = value
            continue
        raise HTTPException(status_code=400, detail="config.params values must be string/number/bool")
    return params


def _inject_proxy_credentials(proxy_url: str, username: str | None, password: str | None) -> str:
    parsed = urlparse(proxy_url)
    if parsed.username:
        return proxy_url
    if username is None:
        return proxy_url
    encoded_user = quote(username, safe="")
    encoded_password = quote(password or "", safe="")
    netloc = f"{encoded_user}:{encoded_password}@{parsed.hostname or ''}"
    if parsed.port:
        netloc = f"{netloc}:{parsed.port}"
    return urlunparse((parsed.scheme, netloc, parsed.path, parsed.params, parsed.query, parsed.fragment))


def _resolve_proxy_url(config: dict[str, Any]) -> str | None:
    network = config.get("network")
    if network is None:
        return None
    if not isinstance(network, dict):
        raise HTTPException(status_code=400, detail="config.network must be an object")

    raw_proxy = network.get("proxy")
    if raw_proxy is None:
        return None

    if isinstance(raw_proxy, str):
        proxy_url = raw_proxy.strip()
        username = None
        password = None
    elif isinstance(raw_proxy, dict):
        raw_url = raw_proxy.get("url", raw_proxy.get("server"))
        if not isinstance(raw_url, str) or not raw_url.strip():
            raise HTTPException(status_code=400, detail="config.network.proxy.url is required")
        proxy_url = raw_url.strip()
        username = raw_proxy.get("username")
        password = raw_proxy.get("password")
        if username is not None and not isinstance(username, str):
            raise HTTPException(status_code=400, detail="config.network.proxy.username must be a string")
        if password is not None and not isinstance(password, str):
            raise HTTPException(status_code=400, detail="config.network.proxy.password must be a string")
    else:
        raise HTTPException(status_code=400, detail="config.network.proxy must be a string or object")

    parsed = urlparse(proxy_url)
    if parsed.scheme.lower() not in {"http", "https", "socks5", "socks5h"}:
        raise HTTPException(status_code=400, detail="config.network.proxy must use http/https/socks5/socks5h")
    if not parsed.hostname:
        raise HTTPException(status_code=400, detail="config.network.proxy.url is invalid")
    return _inject_proxy_credentials(proxy_url, username, password)


def _resolve_body_payload(config: dict[str, Any]) -> tuple[Any | None, Any | None, bytes | None]:
    has_json = "json" in config
    has_form = "form" in config
    has_body = "body" in config
    if sum([has_json, has_form, has_body]) > 1:
        raise HTTPException(status_code=400, detail="use only one of config.json/config.form/config.body")

    if has_json:
        json_payload = config.get("json")
        if not isinstance(json_payload, (dict, list)):
            raise HTTPException(status_code=400, detail="config.json must be an object or array")
        return json_payload, None, None

    if has_form:
        form_payload = config.get("form")
        if not isinstance(form_payload, dict):
            raise HTTPException(status_code=400, detail="config.form must be an object")
        normalized_form: dict[str, str] = {}
        for key, value in form_payload.items():
            if not isinstance(key, str) or not key.strip():
                raise HTTPException(status_code=400, detail="config.form keys must be non-empty strings")
            if not isinstance(value, (str, int, float, bool)):
                raise HTTPException(status_code=400, detail="config.form values must be string/number/bool")
            normalized_form[key] = str(value)
        return None, normalized_form, None

    if not has_body:
        return None, None, None

    body = config.get("body")
    if body is None:
        return None, None, None
    if isinstance(body, (dict, list)):
        return body, None, None
    if isinstance(body, str):
        return None, None, body.encode("utf-8")
    raise HTTPException(status_code=400, detail="config.body must be object/array/string/null")


def _canonicalize_signature_pairs(payload: dict[str, Any], fields: list[str] | None) -> list[tuple[str, str]]:
    keys = fields if fields else sorted(payload.keys())
    pairs: list[tuple[str, str]] = []
    for key in keys:
        if key not in payload:
            continue
        value = payload[key]
        if value is None:
            continue
        pairs.append((key, str(value)))
    return pairs


def _apply_request_signature(
    *,
    signature_config: Any,
    query_params: dict[str, Any],
    json_payload: Any | None,
    form_payload: dict[str, str] | None,
    headers: dict[str, str],
) -> tuple[dict[str, Any], Any | None, dict[str, str] | None, dict[str, str]]:
    if signature_config is None:
        return query_params, json_payload, form_payload, headers
    if not isinstance(signature_config, dict):
        raise HTTPException(status_code=400, detail="config.signature must be an object")

    secret = signature_config.get("secret")
    if not secret:
        secret_env = signature_config.get("secretEnv")
        if not isinstance(secret_env, str) or not secret_env.strip():
            raise HTTPException(status_code=400, detail="config.signature.secret or secretEnv is required")
        secret = os.getenv(secret_env)
        if not secret:
            raise HTTPException(status_code=400, detail=f"signature secretEnv not found: {secret_env}")
    secret_str = str(secret)

    source = str(signature_config.get("source", "query")).lower()
    if source == "query":
        source_payload: dict[str, Any] = query_params
    elif source == "body":
        if isinstance(json_payload, dict):
            source_payload = json_payload
        elif form_payload is not None:
            source_payload = form_payload
        else:
            raise HTTPException(status_code=400, detail="signature source=body requires object body/json/form payload")
    else:
        raise HTTPException(status_code=400, detail="config.signature.source must be query or body")

    timestamp_field = signature_config.get("timestampField")
    if timestamp_field is not None:
        if not isinstance(timestamp_field, str) or not timestamp_field.strip():
            raise HTTPException(status_code=400, detail="config.signature.timestampField must be a non-empty string")
        if timestamp_field not in source_payload:
            source_payload[timestamp_field] = int(time.time())

    nonce_field = signature_config.get("nonceField")
    if nonce_field is not None:
        if not isinstance(nonce_field, str) or not nonce_field.strip():
            raise HTTPException(status_code=400, detail="config.signature.nonceField must be a non-empty string")
        if nonce_field not in source_payload:
            source_payload[nonce_field] = secrets.token_hex(8)

    raw_fields = signature_config.get("fields")
    fields: list[str] | None = None
    if raw_fields is not None:
        if not isinstance(raw_fields, list) or not raw_fields:
            raise HTTPException(status_code=400, detail="config.signature.fields must be a non-empty array")
        fields = []
        for field_name in raw_fields:
            if not isinstance(field_name, str) or not field_name.strip():
                raise HTTPException(status_code=400, detail="config.signature.fields must contain non-empty strings")
            fields.append(field_name.strip())

    joiner = str(signature_config.get("joiner", "&"))
    kv_separator = str(signature_config.get("kvSeparator", "="))
    prefix = str(signature_config.get("prefix", ""))
    suffix = str(signature_config.get("suffix", ""))
    pairs = _canonicalize_signature_pairs(source_payload, fields)
    base_string = joiner.join(f"{k}{kv_separator}{v}" for k, v in pairs)
    signing_payload = f"{prefix}{base_string}{suffix}".encode("utf-8")

    algorithm = str(signature_config.get("algorithm", "hmac-sha256")).lower()
    if algorithm == "hmac-sha256":
        digest = hmac.new(secret_str.encode("utf-8"), signing_payload, hashlib.sha256).digest()
    elif algorithm == "hmac-sha1":
        digest = hmac.new(secret_str.encode("utf-8"), signing_payload, hashlib.sha1).digest()
    else:
        raise HTTPException(status_code=400, detail="config.signature.algorithm must be hmac-sha256 or hmac-sha1")

    digest_encoding = str(signature_config.get("digest", "hex")).lower()
    if digest_encoding == "hex":
        signature = digest.hex()
    elif digest_encoding == "base64":
        signature = base64.b64encode(digest).decode("utf-8")
    else:
        raise HTTPException(status_code=400, detail="config.signature.digest must be hex or base64")

    target = str(signature_config.get("target", "query")).lower()
    if target == "query":
        field_name = str(signature_config.get("field", "sign"))
        query_params[field_name] = signature
    elif target == "body":
        field_name = str(signature_config.get("field", "sign"))
        if isinstance(json_payload, dict):
            json_payload[field_name] = signature
        elif form_payload is not None:
            form_payload[field_name] = signature
        else:
            raise HTTPException(status_code=400, detail="signature target=body requires object body/json/form payload")
    elif target == "header":
        header_name = str(signature_config.get("header", "X-Signature"))
        headers[header_name] = signature
    else:
        raise HTTPException(status_code=400, detail="config.signature.target must be query/body/header")

    return query_params, json_payload, form_payload, headers


def _response_to_text(response: httpx.Response) -> tuple[str | None, str]:
    content_type = response.headers.get("content-type", "").lower()
    text = response.text
    if "html" in content_type:
        title = _extract_html_title(text)
        return title, _strip_html_text(text)

    if "json" in content_type:
        try:
            return None, json.dumps(response.json(), ensure_ascii=False)
        except ValueError:
            return None, text.strip()

    return None, text.strip()


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
        method = _resolve_method(config)
        proxy_url = _resolve_proxy_url(config)
        base_params = _resolve_params(config)
        base_json_payload, base_form_payload, base_content_payload = _resolve_body_payload(config)
        headers = config.get("headers", {})
        timeout_seconds = config.get("timeoutSeconds", 15)
        max_chars = int(config.get("maxChars", 20000))
        signature_config = config.get("signature")
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
        async with httpx.AsyncClient(timeout=float(timeout_seconds), follow_redirects=True, proxy=proxy_url) as client:
            for target_url in urls:
                request_params = copy.deepcopy(base_params)
                request_json_payload = copy.deepcopy(base_json_payload)
                request_form_payload = copy.deepcopy(base_form_payload)
                request_content_payload = copy.deepcopy(base_content_payload)
                request_headers = dict(safe_headers)

                request_params, request_json_payload, request_form_payload, request_headers = _apply_request_signature(
                    signature_config=signature_config,
                    query_params=request_params,
                    json_payload=request_json_payload,
                    form_payload=request_form_payload,
                    headers=request_headers,
                )

                try:
                    response = await client.request(
                        method,
                        target_url,
                        headers=request_headers,
                        params=request_params,
                        json=request_json_payload,
                        data=request_form_payload,
                        content=request_content_payload,
                    )
                    response.raise_for_status()
                except httpx.HTTPError as error:
                    raise HTTPException(
                        status_code=502, detail=f"xhttp request failed for {target_url}: {error}"
                    ) from error

                title, plain_text = _response_to_text(response)
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
