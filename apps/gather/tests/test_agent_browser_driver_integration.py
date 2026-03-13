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
    def fake_execute_agent_browser_script(_config):
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
        )

    monkeypatch.setattr(main, "execute_agent_browser_script", fake_execute_agent_browser_script)

    client = TestClient(main.app)
    response = client.post(
        "/v2/fetch",
        json={
            "platform": "telegram",
            "sourceId": "source-telegram-1",
            "driver": "agent-browser",
            "config": {
                "agentBrowser": {
                    "script": [{"command": "open https://web.telegram.org/a/"}],
                }
            },
        },
    )

    assert response.status_code == 200
    payload = response.json()
    assert isinstance(payload, list)
    assert payload
    assert payload[0]["driver"] == "agent-browser"
    assert payload[0]["title"] == "agent-browser capture: messages"
    assert "hello world" in payload[0]["text"]
    assert payload[0]["instanceId"] == "ab-demo123"
    assert payload[0]["tabId"] == "tab-main01"
    assert payload[0]["instanceActive"] is True


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
            "driver": "agent-browser",
            "config": {"agentBrowser": {}},
        },
    )

    assert response.status_code == 400
    payload = response.json()
    assert payload["error"]["code"] == "FETCH_BAD_REQUEST"
    assert payload["error"]["retryable"] is False
    assert "non-empty array" in payload["error"]["message"]
