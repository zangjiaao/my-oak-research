from __future__ import annotations

import shlex
import subprocess
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any


@dataclass(slots=True)
class AgentBrowserScriptError(Exception):
    reason: str
    message: str
    step_index: int | None = None
    command: str | None = None

    def __str__(self) -> str:
        return self.message


@dataclass(slots=True)
class AgentBrowserStepResult:
    step_index: int
    command: str
    attempt: int
    stdout: str
    stderr: str


@dataclass(slots=True)
class AgentBrowserScriptResult:
    step_results: list[AgentBrowserStepResult]
    captures: dict[str, list[str]]


def _read_int(raw_value: Any, *, field_name: str, minimum: int = 0) -> int:
    try:
        value = int(raw_value)
    except (TypeError, ValueError) as error:
        raise AgentBrowserScriptError(
            reason="invalid_config",
            message=f"{field_name} must be an integer",
        ) from error
    if value < minimum:
        raise AgentBrowserScriptError(
            reason="invalid_config",
            message=f"{field_name} must be >= {minimum}",
        )
    return value


def _extract_script_steps(config: dict[str, Any]) -> list[dict[str, Any]]:
    container = config.get("agentBrowser")
    if container is None:
        container = config
    if not isinstance(container, dict):
        raise AgentBrowserScriptError(
            reason="invalid_config",
            message="config.agentBrowser must be an object",
        )
    steps = container.get("script")
    if not isinstance(steps, list) or not steps:
        raise AgentBrowserScriptError(
            reason="invalid_config",
            message="config.agentBrowser.script must be a non-empty array",
        )
    return steps


def _extract_runtime_options(config: dict[str, Any]) -> dict[str, Any]:
    container = config.get("agentBrowser")
    if container is None:
        container = config
    if not isinstance(container, dict):
        raise AgentBrowserScriptError(
            reason="invalid_config",
            message="config.agentBrowser must be an object",
        )
    return container


def execute_agent_browser_script(config: dict[str, Any]) -> AgentBrowserScriptResult:
    steps = _extract_script_steps(config)
    options = _extract_runtime_options(config)

    command_timeout_ms = _read_int(options.get("commandTimeoutMs", 30000), field_name="commandTimeoutMs", minimum=1)
    close_on_complete = bool(options.get("closeOnComplete", True))

    command_prefix = ["agent-browser"]
    if bool(options.get("headed", False)):
        command_prefix.append("--headed")

    profile = options.get("profile")
    if profile:
        command_prefix.extend(["--profile", str(profile)])

    session_name = options.get("sessionName")
    if session_name:
        command_prefix.extend(["--session-name", str(session_name)])

    state_file = options.get("stateFile")
    if state_file:
        state_path = Path(str(state_file))
        if not state_path.exists():
            raise AgentBrowserScriptError(
                reason="invalid_config",
                message=f"stateFile does not exist: {state_file}",
            )
        command_prefix.extend(["--state", str(state_path)])

    step_results: list[AgentBrowserStepResult] = []
    captures: dict[str, list[str]] = {}

    try:
        for step_index, step in enumerate(steps, start=1):
            if not isinstance(step, dict):
                raise AgentBrowserScriptError(
                    reason="invalid_config",
                    message=f"script[{step_index - 1}] must be an object",
                    step_index=step_index,
                )

            command = step.get("command")
            if not isinstance(command, str) or not command.strip():
                raise AgentBrowserScriptError(
                    reason="invalid_config",
                    message=f"script[{step_index - 1}].command is required",
                    step_index=step_index,
                )

            repeat = _read_int(step.get("repeat", 1), field_name=f"script[{step_index - 1}].repeat", minimum=1)
            interval_ms = _read_int(
                step.get("intervalMs", 0),
                field_name=f"script[{step_index - 1}].intervalMs",
                minimum=0,
            )
            capture_as = step.get("captureAs")
            if capture_as is not None and (not isinstance(capture_as, str) or not capture_as.strip()):
                raise AgentBrowserScriptError(
                    reason="invalid_config",
                    message=f"script[{step_index - 1}].captureAs must be a non-empty string",
                    step_index=step_index,
                )

            command_parts = shlex.split(command)
            for attempt in range(1, repeat + 1):
                args = command_prefix + command_parts
                try:
                    completed = subprocess.run(
                        args,
                        capture_output=True,
                        text=True,
                        timeout=command_timeout_ms / 1000,
                        check=False,
                    )
                except FileNotFoundError as error:
                    raise AgentBrowserScriptError(
                        reason="binary_not_found",
                        message="agent-browser command not found in PATH",
                        step_index=step_index,
                        command=command,
                    ) from error
                except subprocess.TimeoutExpired as error:
                    raise AgentBrowserScriptError(
                        reason="command_timeout",
                        message=f"Command timed out after {command_timeout_ms}ms",
                        step_index=step_index,
                        command=command,
                    ) from error

                stdout = completed.stdout or ""
                stderr = completed.stderr or ""
                if completed.returncode != 0:
                    detail = stderr.strip() or stdout.strip() or f"exit code {completed.returncode}"
                    raise AgentBrowserScriptError(
                        reason="command_failed",
                        message=f"agent-browser command failed: {detail}",
                        step_index=step_index,
                        command=command,
                    )

                step_results.append(
                    AgentBrowserStepResult(
                        step_index=step_index,
                        command=command,
                        attempt=attempt,
                        stdout=stdout,
                        stderr=stderr,
                    )
                )
                if capture_as:
                    captures.setdefault(capture_as, []).append(stdout.strip())

                if interval_ms > 0 and attempt < repeat:
                    time.sleep(interval_ms / 1000)
    finally:
        if close_on_complete:
            try:
                subprocess.run(
                    command_prefix + ["close"],
                    capture_output=True,
                    text=True,
                    timeout=10,
                    check=False,
                )
            except Exception:
                pass

    return AgentBrowserScriptResult(step_results=step_results, captures=captures)

