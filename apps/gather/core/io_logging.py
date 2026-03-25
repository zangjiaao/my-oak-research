"""API I/O logging with truncation and sensitive-data redaction."""

import json
import logging
import traceback
from datetime import datetime, timezone
from typing import Any, Dict

from core.config import (
    API_IO_LOG_DIR,
    API_IO_LOG_ENABLED,
    API_IO_LOG_MAX_CHARS,
)

logger = logging.getLogger("gather")


def _truncate_for_log(value: Any, max_chars: int) -> Any:
    if isinstance(value, str):
        if len(value) <= max_chars:
            return value
        return f"{value[:max_chars]}...(truncated, total={len(value)})"
    if isinstance(value, list):
        return [_truncate_for_log(item, max_chars) for item in value]
    if isinstance(value, dict):
        return {str(k): _truncate_for_log(v, max_chars) for k, v in value.items()}
    return value


def _redact_sensitive_for_log(value: Any) -> Any:
    if isinstance(value, list):
        return [_redact_sensitive_for_log(item) for item in value]
    if not isinstance(value, dict):
        return value

    redacted: dict[str, Any] = {}
    for raw_key, raw_val in value.items():
        key = str(raw_key)
        lowered = key.lower()
        if lowered in {"auth_data", "authdata"} and isinstance(raw_val, dict):
            cookies = raw_val.get("cookies")
            origins = raw_val.get("origins")
            redacted[key] = {
                "redacted": True,
                "cookiesCount": len(cookies) if isinstance(cookies, list) else 0,
                "originsCount": len(origins) if isinstance(origins, list) else 0,
            }
            continue
        if lowered in {"cookies", "origins", "localstorage"}:
            if isinstance(raw_val, list):
                redacted[key] = f"<redacted list, len={len(raw_val)}>"
            else:
                redacted[key] = "<redacted>"
            continue
        redacted[key] = _redact_sensitive_for_log(raw_val)
    return redacted


def log_api_io(route: str, request_body: Any, response_body: Any, status_code: int) -> None:
    if not API_IO_LOG_ENABLED:
        return
    try:
        API_IO_LOG_DIR.mkdir(parents=True, exist_ok=True)
        now = datetime.now(timezone.utc)
        file_path = API_IO_LOG_DIR / f"api-io-{now.strftime('%Y-%m-%d')}.jsonl"
        entry = {
            "time": now.isoformat(),
            "route": route,
            "statusCode": status_code,
            "request": _truncate_for_log(
                _redact_sensitive_for_log(request_body),
                API_IO_LOG_MAX_CHARS,
            ),
            "response": _truncate_for_log(response_body, API_IO_LOG_MAX_CHARS),
        }
        with file_path.open("a", encoding="utf-8") as f:
            f.write(json.dumps(entry, ensure_ascii=False))
            f.write("\n")
    except Exception as error:  # pragma: no cover
        logger.error("failed to write api io log for %s: %s", route, error)


def log_internal_fetch_error(route: str, payload: Dict[str, Any], error: Exception) -> None:
    try:
        logger.error(
            "unhandled fetch exception route=%s error=%s: %s\n%s",
            route,
            type(error).__name__,
            error,
            traceback.format_exc(),
            extra={
                "request": _truncate_for_log(
                    _redact_sensitive_for_log(payload),
                    API_IO_LOG_MAX_CHARS,
                ),
            },
        )
    except Exception as log_error:  # pragma: no cover
        logger.error("failed to emit internal error log for %s: %s", route, log_error)
