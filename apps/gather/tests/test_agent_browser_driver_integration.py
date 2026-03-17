import sys
from pathlib import Path

from fastapi.testclient import TestClient

ROOT_DIR = Path(__file__).resolve().parents[1]
if str(ROOT_DIR) not in sys.path:
    sys.path.insert(0, str(ROOT_DIR))

import main
from drivers.agent_browser_runner import (
    AgentBrowserScriptError,
    AgentBrowserScriptResult,
    AgentBrowserStepResult,
)


def test_v2_fetch_agent_browser_driver_returns_captures(monkeypatch):
    captured_config = {}

    def fake_execute_agent_browser_script(_config):
        captured_config.update(_config)
        return AgentBrowserScriptResult(
            step_results=[
                AgentBrowserStepResult(
                    step_index=1,
                    command="open https://example.com",
                    attempt=1,
                    stdout="opened",
                    stderr="",
                )
            ],
            captures={"messages": ["hello world", "hello again"]},
            instance_id="ab-demo123",
            tab_id="tab-main01",
            instance_active=True,
            ttl_seconds=900,
            expires_at_epoch=1700000000.0,
        )

    monkeypatch.setattr(main, "execute_agent_browser_script", fake_execute_agent_browser_script)

    client = TestClient(main.app)
    response = client.post(
        "/v2/fetch",
        json={
            "platform": "telegram",
            "sourceId": "source-telegram-1",
            "keywords": [],
            "driver": {
                "name": "agent-browser",
                "option": {
                    "script": [{"command": "open https://web.telegram.org/a/"}],
                    "filters": {
                        "capture": {
                            "keys": ["messages"],
                        }
                    },
                },
            },
            "output": {"field": ["text", "markdown", "url"]},
        },
    )

    assert response.status_code == 200
    payload = response.json()
    assert isinstance(payload, list)
    assert payload
    assert payload[0]["driver"] == "agent-browser"
    assert payload[0]["recordType"] == "capture"
    assert "hello world" in payload[0]["recordContent"]["text"]
    assert payload[0]["instanceId"] == "ab-demo123"
    assert payload[0]["tabId"] == "tab-main01"
    assert payload[0]["instanceActive"] is True
    assert captured_config["agentBrowser"]["captureFilter"]["keys"] == ["messages"]


def test_v2_fetch_agent_browser_driver_surfaces_config_error(monkeypatch):
    def fake_execute_agent_browser_script(_config):
        raise AgentBrowserScriptError(
            reason="invalid_config",
            message="config.agentBrowser.script must be a non-empty array",
        )

    monkeypatch.setattr(main, "execute_agent_browser_script", fake_execute_agent_browser_script)

    client = TestClient(main.app)
    response = client.post(
        "/v2/fetch",
        json={
            "platform": "telegram",
            "sourceId": "source-telegram-2",
            "keywords": [],
            "driver": {"name": "agent-browser", "option": {}},
            "output": {"field": ["text", "markdown"]},
        },
    )

    assert response.status_code == 400
    payload = response.json()
    assert payload["error"]["code"] == "FETCH_BAD_REQUEST"
    assert payload["error"]["retryable"] is False
    assert "non-empty array" in payload["error"]["message"]


def test_v2_fetch_agent_browser_driver_maps_owner_mismatch_to_403(monkeypatch):
    def fake_execute_agent_browser_script(_config):
        raise AgentBrowserScriptError(
            reason="forbidden_instance_owner",
            message="instanceId owner mismatch",
        )

    monkeypatch.setattr(main, "execute_agent_browser_script", fake_execute_agent_browser_script)

    client = TestClient(main.app)
    response = client.post(
        "/v2/fetch",
        json={
            "platform": "telegram",
            "sourceId": "source-telegram-3",
            "keywords": [],
            "driver": {
                "name": "agent-browser",
                "option": {"instanceId": "ab-test", "ownerId": "user-b", "script": []},
            },
            "output": {"field": ["text", "markdown"]},
        },
    )

    assert response.status_code == 403
    payload = response.json()
    assert payload["error"]["code"] == "FETCH_BAD_REQUEST"
    assert payload["error"]["retryable"] is False


def test_v2_fetch_agent_browser_driver_options_maps_auth_and_filters(monkeypatch):
    captured_config = {}

    def fake_execute_agent_browser_script(_config):
        captured_config.update(_config)
        return AgentBrowserScriptResult(
            step_results=[],
            captures={"messages": ["alpha"]},
            instance_id="ab-demo123",
            tab_id="tab-main01",
            instance_active=True,
            ttl_seconds=900,
            expires_at_epoch=1700000000.0,
        )

    monkeypatch.setattr(main, "execute_agent_browser_script", fake_execute_agent_browser_script)

    client = TestClient(main.app)
    response = client.post(
        "/v2/fetch",
        json={
            "platform": "telegram",
            "sourceId": "source-telegram-4",
            "keywords": ["alpha"],
            "driver": {
                "name": "agent-browser",
                "option": {
                    "sessionKey": "source-telegram-4",
                    "auth": {"stateFile": ".auth/demo.json"},
                    "script": [{"command": "open https://web.telegram.org/a/"}],
                },
                "filter": {"minChars": 8},
            },
            "output": {"field": ["text", "markdown", "url"]},
        },
    )

    assert response.status_code == 200
    assert "sessionKey" not in captured_config["agentBrowser"]
    assert captured_config["agentBrowser"]["stateFile"] == ".auth/demo.json"
    assert captured_config["filters"]["keyword"]["keywords"] == ["alpha"]
    assert captured_config["filters"]["keyword"]["minChars"] == 8


def test_agent_browser_heartbeat_endpoint(monkeypatch):
    def fake_heartbeat(_config):
        return AgentBrowserScriptResult(
            step_results=[],
            captures={},
            instance_id="ab-heartbeat1",
            tab_id="tab-heart01",
            instance_active=True,
            ttl_seconds=900,
            expires_at_epoch=1700000100.0,
        )

    monkeypatch.setattr(main, "heartbeat_agent_browser_instance", fake_heartbeat)

    client = TestClient(main.app)
    response = client.post(
        "/v2/agent-browser/heartbeat",
        json={
            "platform": "x",
            "sourceId": "source-heartbeat-1",
            "instanceId": "ab-heartbeat1",
            "ownerId": "user-a",
        },
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["instanceId"] == "ab-heartbeat1"
    assert payload["tabId"] == "tab-heart01"
    assert payload["instanceActive"] is True
    assert payload["ttlSeconds"] == 900


def test_agent_browser_heartbeat_endpoint_maps_expired_to_410(monkeypatch):
    def fake_heartbeat(_config):
        raise AgentBrowserScriptError(reason="instance_expired", message="expired")

    monkeypatch.setattr(main, "heartbeat_agent_browser_instance", fake_heartbeat)

    client = TestClient(main.app)
    response = client.post(
        "/v2/agent-browser/heartbeat",
        json={
            "platform": "x",
            "sourceId": "source-heartbeat-2",
            "instanceId": "ab-expired",
            "ownerId": "user-a",
        },
    )

    assert response.status_code == 410
    payload = response.json()
    assert payload["error"]["code"] == "HEARTBEAT_BAD_REQUEST"
    assert payload["error"]["retryable"] is False
