import asyncio
import sys
from pathlib import Path

from fastapi.testclient import TestClient

ROOT_DIR = Path(__file__).resolve().parents[1]
if str(ROOT_DIR) not in sys.path:
    sys.path.insert(0, str(ROOT_DIR))

import main
from poc.agent_browser_responsebody_poc import (
    CaptureAttemptResult,
    CaptureFailureReason,
    PocRunConfig,
    build_report_markdown,
    capture_response_body,
    summarize_attempts,
    write_report,
)


class FakeCDPSession:
    def __init__(self, *, body_by_request_id=None, hang_get_body=False):
        self.body_by_request_id = body_by_request_id or {}
        self.hang_get_body = hang_get_body
        self.listeners = {}
        self.enabled = False

    def on(self, event, callback):
        self.listeners[event] = callback

    async def send(self, method, params=None):
        if method == "Network.enable":
            self.enabled = True
            return {}
        if method == "Network.getResponseBody":
            if self.hang_get_body:
                await asyncio.sleep(0.2)
                return {}
            request_id = params["requestId"]
            return self.body_by_request_id[request_id]
        raise AssertionError(f"Unexpected method: {method}")

    def emit_response(self, request_id: str, url: str):
        callback = self.listeners.get("Network.responseReceived")
        if callback:
            callback({"requestId": request_id, "response": {"url": url}})

    async def detach(self):
        return None


def test_agent_browser_responsebody_capture():
    async def _run():
        session = FakeCDPSession(
            body_by_request_id={
                "req-1": {"body": '{"ok": true, "items": [1, 2]}', "base64Encoded": False}
            }
        )

        async def trigger_request():
            await asyncio.sleep(0.01)
            session.emit_response("req-1", "https://example.com/api/feed")

        return await capture_response_body(
            session,
            url_pattern="/api/feed",
            timeout_ms=120,
            trigger_request=trigger_request,
        )

    result = asyncio.run(_run())

    assert result.ok is True
    assert result.failure_reason is None
    assert result.matched_url == "https://example.com/api/feed"
    assert result.parsed_body["ok"] is True
    assert result.parsed_body["items"] == [1, 2]


def test_agent_browser_responsebody_timeout():
    async def _run_unmatched():
        session = FakeCDPSession(
            body_by_request_id={
                "req-x": {"body": '{"ok": true}', "base64Encoded": False}
            }
        )

        async def trigger_request():
            await asyncio.sleep(0.01)
            session.emit_response("req-x", "https://example.com/api/other")

        return await capture_response_body(
            session,
            url_pattern="/api/feed",
            timeout_ms=100,
            trigger_request=trigger_request,
        )

    async def _run_get_body_timeout():
        session = FakeCDPSession(hang_get_body=True)

        async def trigger_request():
            await asyncio.sleep(0.01)
            session.emit_response("req-timeout", "https://example.com/api/feed")

        return await capture_response_body(
            session,
            url_pattern="/api/feed",
            timeout_ms=60,
            trigger_request=trigger_request,
        )

    unmatched = asyncio.run(_run_unmatched())
    timeout = asyncio.run(_run_get_body_timeout())

    assert unmatched.ok is False
    assert unmatched.failure_reason == CaptureFailureReason.NO_MATCH

    assert timeout.ok is False
    assert timeout.failure_reason == CaptureFailureReason.TIMEOUT
    assert timeout.error_message == "Network.getResponseBody timeout"


def test_poc_does_not_change_default_driver():
    client = TestClient(main.app)

    response = client.post(
        "/fetch",
        json={
            "platform": "contract-test-platform",
            "source_id": "legacy_source_456",
            "config": {},
        },
    )

    assert main.driver_registry.default_driver == "playwright"
    assert response.status_code == 200
    payload = response.json()
    assert isinstance(payload, list)
    assert payload
    assert payload[0]["driver"] == "python-gather"
    assert payload[0]["driver"] != "agent-browser"


def test_gth003_report_output_path(tmp_path):
    attempts = [
        CaptureAttemptResult(ok=True, elapsed_ms=31, url_pattern="/api/feed"),
        CaptureAttemptResult(
            ok=False,
            elapsed_ms=75,
            url_pattern="/api/feed",
            failure_reason=CaptureFailureReason.NO_MATCH,
            error_message="No response matched URL pattern within timeout",
        ),
    ]
    summary = summarize_attempts(attempts)
    report_path = tmp_path / "specs" / "reports" / "GTH-003-report.md"
    config = PocRunConfig(
        profile_dir=tmp_path / "profile",
        target_url="https://example.com",
        url_pattern="/api/feed",
        samples=2,
        report_path=report_path,
    )

    content = build_report_markdown(config, summary)
    written_path = write_report(report_path, content)

    assert written_path == report_path
    assert written_path.exists()
    assert written_path.stat().st_size > 0

