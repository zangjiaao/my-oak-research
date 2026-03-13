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
    return_code: int | None = None
    stdout: str | None = None
    stderr: str | None = None
    debug_context: dict[str, Any] | None = None

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


def _emit_log(enabled: bool, message: str) -> None:
    if enabled:
        print(f"[agent-browser-runner] {message}")


def _truncate_text(value: str, max_length: int = 3000) -> str:
    if len(value) <= max_length:
        return value
    return f"{value[:max_length]}..."


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
    verbose = bool(options.get("verbose", True))

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
    debug_steps: list[dict[str, Any]] = []

    _emit_log(
        verbose,
        f"start script steps={len(steps)} headed={bool(options.get('headed', False))} "
        f"profile={profile or '-'} session={session_name or '-'} state={state_file or '-'}",
    )

    try:
        _emit_log(verbose, "preflight close daemon")
        subprocess.run(
            ["agent-browser", "close"],
            capture_output=True,
            text=True,
            timeout=10,
            check=False,
        )
    except Exception as error:
        _emit_log(verbose, f"preflight close skipped: {error}")

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
                is_close_command = bool(command_parts) and command_parts[0] == "close"
                args = ["agent-browser", "close"] if is_close_command else command_prefix + command_parts
                started_at = time.monotonic()
                _emit_log(
                    verbose,
                    f"step={step_index}/{len(steps)} attempt={attempt}/{repeat} command={command}",
                )
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
                        debug_context={"steps": debug_steps},
                    ) from error
                except subprocess.TimeoutExpired as error:
                    raise AgentBrowserScriptError(
                        reason="command_timeout",
                        message=f"Command timed out after {command_timeout_ms}ms",
                        step_index=step_index,
                        command=command,
                        debug_context={"steps": debug_steps},
                    ) from error

                stdout = completed.stdout or ""
                stderr = completed.stderr or ""
                elapsed_ms = int((time.monotonic() - started_at) * 1000)
                debug_step = {
                    "step_index": step_index,
                    "attempt": attempt,
                    "command": command,
                    "elapsed_ms": elapsed_ms,
                    "return_code": completed.returncode,
                    "stdout": _truncate_text(stdout.strip()),
                    "stderr": _truncate_text(stderr.strip()),
                }
                debug_steps.append(debug_step)
                _emit_log(
                    verbose,
                    f"step={step_index} attempt={attempt} exit={completed.returncode} elapsed={elapsed_ms}ms",
                )
                if completed.returncode != 0:
                    detail = stderr.strip() or stdout.strip() or f"exit code {completed.returncode}"
                    _emit_log(
                        verbose,
                        f"step failed step={step_index} command={command} detail={_truncate_text(detail)}",
                    )
                    raise AgentBrowserScriptError(
                        reason="command_failed",
                        message=f"agent-browser command failed: {detail}",
                        step_index=step_index,
                        command=command,
                        return_code=completed.returncode,
                        stdout=_truncate_text(stdout.strip()),
                        stderr=_truncate_text(stderr.strip()),
                        debug_context={"steps": debug_steps},
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
                    _emit_log(verbose, f"sleep interval {interval_ms}ms before next repeat")
                    time.sleep(interval_ms / 1000)
    finally:
        if close_on_complete:
            try:
                _emit_log(verbose, "close daemon on complete")
                subprocess.run(
                    ["agent-browser", "close"],
                    capture_output=True,
                    text=True,
                    timeout=10,
                    check=False,
                )
            except Exception:
                pass

    _emit_log(verbose, f"script completed steps_executed={len(step_results)}")
    return AgentBrowserScriptResult(step_results=step_results, captures=captures)
