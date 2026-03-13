import subprocess
import sys
from pathlib import Path

import pytest

ROOT_DIR = Path(__file__).resolve().parents[1]
if str(ROOT_DIR) not in sys.path:
    sys.path.insert(0, str(ROOT_DIR))

from drivers.agent_browser_runner import (
    AgentBrowserScriptError,
    execute_agent_browser_script,
    heartbeat_agent_browser_instance,
)


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
                "ownerId": "user-a",
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


def test_execute_agent_browser_script_rejects_owner_mismatch(monkeypatch):
    def fake_run(args, capture_output, text, timeout, check):  # noqa: ARG001
        return subprocess.CompletedProcess(args, 0, stdout="ok", stderr="")

    monkeypatch.setattr("drivers.agent_browser_runner.subprocess.run", fake_run)

    first = execute_agent_browser_script(
        {
            "agentBrowser": {
                "ownerId": "user-a",
                "script": [{"command": "open https://example.com"}],
            }
        }
    )

    with pytest.raises(AgentBrowserScriptError) as error:
        execute_agent_browser_script(
            {
                "agentBrowser": {
                    "instanceId": first.instance_id,
                    "ownerId": "user-b",
                    "script": [{"command": "snapshot -i"}],
                }
            }
        )

    assert error.value.reason == "forbidden_instance_owner"


def test_execute_agent_browser_script_supports_heartbeat_without_steps(monkeypatch):
    calls = []

    def fake_run(args, capture_output, text, timeout, check):  # noqa: ARG001
        calls.append(args)
        return subprocess.CompletedProcess(args, 0, stdout="ok", stderr="")

    monkeypatch.setattr("drivers.agent_browser_runner.subprocess.run", fake_run)

    first = execute_agent_browser_script(
        {
            "agentBrowser": {
                "ownerId": "user-a",
                "script": [{"command": "open https://example.com"}],
            }
        }
    )

    heartbeat = execute_agent_browser_script(
        {
            "agentBrowser": {
                "instanceId": first.instance_id,
                "ownerId": "user-a",
                "heartbeat": True,
                "script": [],
            }
        }
    )

    assert heartbeat.instance_id == first.instance_id
    assert heartbeat.instance_active is True
    assert heartbeat.step_results == []
    assert heartbeat.captures == {}
    assert calls == [["agent-browser", "close"], ["agent-browser", "open", "https://example.com"]]


def test_heartbeat_agent_browser_instance_returns_instance_state(monkeypatch):
    def fake_run(args, capture_output, text, timeout, check):  # noqa: ARG001
        return subprocess.CompletedProcess(args, 0, stdout="ok", stderr="")

    monkeypatch.setattr("drivers.agent_browser_runner.subprocess.run", fake_run)

    created = execute_agent_browser_script(
        {"agentBrowser": {"ownerId": "user-a", "script": [{"command": "open https://example.com"}]}}
    )

    heartbeat = heartbeat_agent_browser_instance(
        {"agentBrowser": {"instanceId": created.instance_id, "ownerId": "user-a"}}
    )

    assert heartbeat.instance_id == created.instance_id
    assert heartbeat.instance_active is True
    assert heartbeat.ttl_seconds == created.ttl_seconds


def test_execute_agent_browser_script_loop_breaks_on_capture_condition(monkeypatch):
    calls = []
    snapshot_outputs = iter(["no target", "found TARGET element"])

    def fake_run(args, capture_output, text, timeout, check):  # noqa: ARG001
        calls.append(args)
        if args[1] == "snapshot":
            return subprocess.CompletedProcess(args, 0, stdout=next(snapshot_outputs), stderr="")
        if args[-1] == "close":
            return subprocess.CompletedProcess(args, 0, stdout="", stderr="")
        return subprocess.CompletedProcess(args, 0, stdout="ok", stderr="")

    monkeypatch.setattr("drivers.agent_browser_runner.subprocess.run", fake_run)

    result = execute_agent_browser_script(
        {
            "agentBrowser": {
                "script": [{"command": "open https://example.com"}],
                "loop": {
                    "maxIterations": 5,
                    "steps": [
                        {"command": "scroll down 800"},
                        {"command": "snapshot", "captureAs": "page"},
                    ],
                    "breakWhen": {
                        "captureKey": "page",
                        "textIncludes": "TARGET",
                    },
                },
            }
        }
    )

    assert result.instance_active is True
    assert result.captures["page"] == ["no target", "found TARGET element"]
    executed = [" ".join(call[1:]) for call in calls if len(call) >= 2 and call[1] != "close"]
    assert executed == [
        "open https://example.com",
        "scroll down 800",
        "snapshot",
        "scroll down 800",
        "snapshot",
    ]


def test_execute_agent_browser_script_loop_breaks_on_capture_condition_with_multiple_keywords(monkeypatch):
    calls = []
    snapshot_outputs = iter(["no target", "contains SECONDARY keyword"])

    def fake_run(args, capture_output, text, timeout, check):  # noqa: ARG001
        calls.append(args)
        if args[1] == "snapshot":
            return subprocess.CompletedProcess(args, 0, stdout=next(snapshot_outputs), stderr="")
        if args[-1] == "close":
            return subprocess.CompletedProcess(args, 0, stdout="", stderr="")
        return subprocess.CompletedProcess(args, 0, stdout="ok", stderr="")

    monkeypatch.setattr("drivers.agent_browser_runner.subprocess.run", fake_run)

    result = execute_agent_browser_script(
        {
            "agentBrowser": {
                "script": [{"command": "open https://example.com"}],
                "loop": {
                    "maxIterations": 5,
                    "steps": [{"command": "snapshot", "captureAs": "page"}],
                    "breakWhen": {
                        "captureKey": "page",
                        "textIncludes": ["PRIMARY", "SECONDARY"],
                    },
                },
            }
        }
    )

    assert result.captures["page"] == ["no target", "contains SECONDARY keyword"]
    executed = [" ".join(call[1:]) for call in calls if len(call) >= 2 and call[1] != "close"]
    assert executed == [
        "open https://example.com",
        "snapshot",
        "snapshot",
    ]


def test_execute_agent_browser_script_capture_filter_supports_min_chars_and_dedupe(monkeypatch):
    calls = []
    snapshot_outputs = iter(
        [
            "@e1 short\n@e2 this is a very long content line",
            "@e2 this is a very long content line\n@e3 another meaningful content line",
        ]
    )

    def fake_run(args, capture_output, text, timeout, check):  # noqa: ARG001
        calls.append(args)
        if args[-1] == "close":
            return subprocess.CompletedProcess(args, 0, stdout="", stderr="")
        if args[1] == "snapshot":
            return subprocess.CompletedProcess(args, 0, stdout=next(snapshot_outputs), stderr="")
        return subprocess.CompletedProcess(args, 0, stdout="ok", stderr="")

    monkeypatch.setattr("drivers.agent_browser_runner.subprocess.run", fake_run)

    result = execute_agent_browser_script(
        {
            "agentBrowser": {
                "script": [{"command": "open https://example.com"}],
                "loop": {
                    "maxIterations": 2,
                    "steps": [{"command": "snapshot", "captureAs": "page_snapshot"}],
                },
                "captureFilter": {
                    "keys": ["page_snapshot"],
                    "perLine": True,
                    "minChars": 20,
                    "dedupe": True,
                },
            }
        }
    )

    assert result.captures["page_snapshot"] == [
        "@e2 this is a very long content line",
        "@e3 another meaningful content line",
    ]
    executed = [" ".join(call[1:]) for call in calls if len(call) >= 2 and call[1] != "close"]
    assert executed == [
        "open https://example.com",
        "snapshot",
        "snapshot",
    ]


def test_execute_agent_browser_script_capture_filter_supports_starts_with(monkeypatch):
    snapshot_outputs = iter(
        [
            "- article headline one\n- text body one\n- link ignore me",
        ]
    )

    def fake_run(args, capture_output, text, timeout, check):  # noqa: ARG001
        if args[-1] == "close":
            return subprocess.CompletedProcess(args, 0, stdout="", stderr="")
        if args[1] == "snapshot":
            return subprocess.CompletedProcess(args, 0, stdout=next(snapshot_outputs), stderr="")
        return subprocess.CompletedProcess(args, 0, stdout="ok", stderr="")

    monkeypatch.setattr("drivers.agent_browser_runner.subprocess.run", fake_run)

    result = execute_agent_browser_script(
        {
            "agentBrowser": {
                "script": [{"command": "snapshot", "captureAs": "page_snapshot"}],
                "captureFilter": {
                    "keys": ["page_snapshot"],
                    "perLine": True,
                    "startsWith": ["- article", "- text"],
                },
            }
        }
    )

    assert result.captures["page_snapshot"] == ["- article headline one", "- text body one"]


def test_execute_agent_browser_script_capture_filter_supports_excludes(monkeypatch):
    snapshot_outputs = iter(
        [
            "- article headline one\n- text body one\n- link ignore me",
        ]
    )

    def fake_run(args, capture_output, text, timeout, check):  # noqa: ARG001
        if args[-1] == "close":
            return subprocess.CompletedProcess(args, 0, stdout="", stderr="")
        if args[1] == "snapshot":
            return subprocess.CompletedProcess(args, 0, stdout=next(snapshot_outputs), stderr="")
        return subprocess.CompletedProcess(args, 0, stdout="ok", stderr="")

    monkeypatch.setattr("drivers.agent_browser_runner.subprocess.run", fake_run)

    result = execute_agent_browser_script(
        {
            "agentBrowser": {
                "script": [{"command": "snapshot", "captureAs": "page_snapshot"}],
                "captureFilter": {
                    "keys": ["page_snapshot"],
                    "perLine": True,
                    "ext": ["- link "],
                },
            }
        }
    )

    assert result.captures["page_snapshot"] == ["- article headline one", "- text body one"]


def test_execute_agent_browser_script_capture_filter_rejects_starts_with_and_excludes_together():
    with pytest.raises(AgentBrowserScriptError) as error:
        execute_agent_browser_script(
            {
                "agentBrowser": {
                    "script": [{"command": "snapshot", "captureAs": "page_snapshot"}],
                    "captureFilter": {
                        "startsWith": ["- article"],
                        "excludes": ["- link "],
                    },
                }
            }
        )

    assert error.value.reason == "invalid_config"
    assert "mutually exclusive" in error.value.message


def test_execute_agent_browser_script_capture_filter_dedupes_with_normalized_ref_suffix(monkeypatch):
    snapshot_outputs = iter(
        [
            '- article "same content" [ref=e120]:\n- article "same content" [ref=e121]:',
        ]
    )

    def fake_run(args, capture_output, text, timeout, check):  # noqa: ARG001
        if args[-1] == "close":
            return subprocess.CompletedProcess(args, 0, stdout="", stderr="")
        if args[1] == "snapshot":
            return subprocess.CompletedProcess(args, 0, stdout=next(snapshot_outputs), stderr="")
        return subprocess.CompletedProcess(args, 0, stdout="ok", stderr="")

    monkeypatch.setattr("drivers.agent_browser_runner.subprocess.run", fake_run)

    result = execute_agent_browser_script(
        {
            "agentBrowser": {
                "script": [{"command": "snapshot", "captureAs": "page_snapshot"}],
                "captureFilter": {
                    "keys": ["page_snapshot"],
                    "perLine": True,
                    "dedupe": True,
                    "normalizeRefTags": True,
                },
            }
        }
    )

    assert result.captures["page_snapshot"] == ['- article "same content" [ref=e120]:']


def test_execute_agent_browser_script_capture_filter_dedupes_with_inline_ref_tags(monkeypatch):
    snapshot_outputs = iter(
        [
            '- article "alpha [ref=e93]beta same"',
            '- article "alpha [ref=e74]beta same"',
        ]
    )

    def fake_run(args, capture_output, text, timeout, check):  # noqa: ARG001
        if args[-1] == "close":
            return subprocess.CompletedProcess(args, 0, stdout="", stderr="")
        if args[1] == "snapshot":
            return subprocess.CompletedProcess(args, 0, stdout=next(snapshot_outputs), stderr="")
        return subprocess.CompletedProcess(args, 0, stdout="ok", stderr="")

    monkeypatch.setattr("drivers.agent_browser_runner.subprocess.run", fake_run)

    result = execute_agent_browser_script(
        {
            "agentBrowser": {
                "script": [{"command": "snapshot", "captureAs": "page_snapshot"}],
                "loop": {"maxIterations": 2, "steps": [{"command": "snapshot", "captureAs": "page_snapshot"}]},
                "captureFilter": {
                    "keys": ["page_snapshot"],
                    "perLine": True,
                    "dedupe": True,
                    "normalizeRefTags": True,
                },
            }
        }
    )

    assert result.captures["page_snapshot"] == ['- article "alpha [ref=e93]beta same"']


def test_execute_agent_browser_script_capture_filter_normalize_ref_suffix_alias_works(monkeypatch):
    snapshot_outputs = iter(
        [
            '- article "same content [ref=e120]"',
            '- article "same content [ref=e121]"',
        ]
    )

    def fake_run(args, capture_output, text, timeout, check):  # noqa: ARG001
        if args[-1] == "close":
            return subprocess.CompletedProcess(args, 0, stdout="", stderr="")
        if args[1] == "snapshot":
            return subprocess.CompletedProcess(args, 0, stdout=next(snapshot_outputs), stderr="")
        return subprocess.CompletedProcess(args, 0, stdout="ok", stderr="")

    monkeypatch.setattr("drivers.agent_browser_runner.subprocess.run", fake_run)

    result = execute_agent_browser_script(
        {
            "agentBrowser": {
                "script": [{"command": "snapshot", "captureAs": "page_snapshot"}],
                "loop": {"maxIterations": 2, "steps": [{"command": "snapshot", "captureAs": "page_snapshot"}]},
                "captureFilter": {
                    "keys": ["page_snapshot"],
                    "perLine": True,
                    "dedupe": True,
                    "normalizeRefSuffix": True,
                },
            }
        }
    )

    assert result.captures["page_snapshot"] == ['- article "same content [ref=e120]"']
