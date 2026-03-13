import subprocess
import sys
from pathlib import Path

import pytest

ROOT_DIR = Path(__file__).resolve().parents[1]
if str(ROOT_DIR) not in sys.path:
    sys.path.insert(0, str(ROOT_DIR))

from drivers.agent_browser_runner import AgentBrowserScriptError, execute_agent_browser_script


def test_execute_agent_browser_script_supports_repeat_and_capture(monkeypatch, tmp_path):
    calls = []
    sleep_calls = []
    state_file = tmp_path / "auth-state.json"
    state_file.write_text("{}", encoding="utf-8")

    def fake_run(args, capture_output, text, timeout, check):  # noqa: ARG001
        calls.append(args)
        if args[-1] == "close":
            return subprocess.CompletedProcess(args, 0, stdout="", stderr="")
        stdout = f"ran:{' '.join(args[-2:])}"
        return subprocess.CompletedProcess(args, 0, stdout=stdout, stderr="")

    monkeypatch.setattr("drivers.agent_browser_runner.subprocess.run", fake_run)
    monkeypatch.setattr("drivers.agent_browser_runner.time.sleep", lambda seconds: sleep_calls.append(seconds))

    result = execute_agent_browser_script(
        {
            "agentBrowser": {
                "headed": True,
                "profile": ".auth/demo-profile",
                "sessionName": "demo-session",
                "stateFile": str(state_file),
                "script": [
                    {"command": "open https://example.com"},
                    {"command": "click @e1", "repeat": 2, "intervalMs": 5, "captureAs": "poll_click"},
                ],
            }
        }
    )

    assert len(result.step_results) == 3
    assert result.captures["poll_click"] == ["ran:click @e1", "ran:click @e1"]
    assert any(call[-1] == "close" for call in calls)
    assert sleep_calls == [0.005]
    assert calls[0] == ["agent-browser", "close"]
    assert calls[1][:8] == [
        "agent-browser",
        "--headed",
        "--profile",
        ".auth/demo-profile",
        "--session-name",
        "demo-session",
        "--state",
        str(state_file),
    ]
    assert "--state" not in calls[2]
    assert result.instance_id.startswith("ab-")
    assert result.tab_id.startswith("tab-")
    assert result.instance_active is True


def test_execute_agent_browser_script_reuses_instance_and_close_by_command(monkeypatch):
    calls = []

    def fake_run(args, capture_output, text, timeout, check):  # noqa: ARG001
        calls.append(args)
        return subprocess.CompletedProcess(args, 0, stdout="ok", stderr="")

    monkeypatch.setattr("drivers.agent_browser_runner.subprocess.run", fake_run)

    first = execute_agent_browser_script(
        {
            "agentBrowser": {
                "script": [{"command": "open https://example.com"}],
            }
        }
    )

    second = execute_agent_browser_script(
        {
            "agentBrowser": {
                "instanceId": first.instance_id,
                "script": [{"command": "snapshot -i"}, {"command": "close"}],
            }
        }
    )

    assert second.instance_id == first.instance_id
    assert second.instance_active is False
    assert calls[0] == ["agent-browser", "close"]  # first request preflight
    assert calls[-1] == ["agent-browser", "close"]  # explicit close step


def test_execute_agent_browser_script_raises_for_missing_binary(monkeypatch):
    def fake_run(*args, **kwargs):  # noqa: ARG001
        raise FileNotFoundError("missing")

    monkeypatch.setattr("drivers.agent_browser_runner.subprocess.run", fake_run)

    with pytest.raises(AgentBrowserScriptError) as error:
        execute_agent_browser_script({"script": [{"command": "open https://example.com"}]})

    assert error.value.reason == "binary_not_found"
