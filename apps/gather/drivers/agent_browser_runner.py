from __future__ import annotations

import shlex
import subprocess
import threading
import time
import re
from uuid import uuid4
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
    instance_id: str
    tab_id: str
    instance_active: bool
    ttl_seconds: int
    expires_at_epoch: float


@dataclass(slots=True)
class AgentBrowserInstanceState:
    instance_id: str
    tab_id: str
    command_prefix: list[str]
    command_prefix_with_state: list[str]
    state_applied: bool
    owner_id: str | None
    session_key: str | None
    ttl_seconds: int
    created_at: float
    last_used_at: float


_INSTANCE_LOCK = threading.Lock()
_INSTANCES: dict[str, AgentBrowserInstanceState] = {}
_REF_SUFFIX_PATTERN = re.compile(r"\s*\[ref=[^\]]+\]:\s*$")
_REF_INLINE_PATTERN = re.compile(r"\s*\[ref=[^\]]+\]")


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


def _extract_script_steps(
    config: dict[str, Any],
    *,
    allow_empty: bool = False,
    allow_missing: bool = False,
) -> list[dict[str, Any]]:
    container = config.get("agentBrowser")
    if container is None:
        container = config
    if not isinstance(container, dict):
        raise AgentBrowserScriptError(
            reason="invalid_config",
            message="config.agentBrowser must be an object",
        )
    steps = container.get("script")
    if steps is None and allow_missing:
        return []
    if not isinstance(steps, list):
        raise AgentBrowserScriptError(
            reason="invalid_config",
            message="config.agentBrowser.script must be a non-empty array",
        )
    if not steps and not allow_empty:
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


def _build_command_prefixes(options: dict[str, Any]) -> tuple[list[str], list[str]]:
    command_prefix = ["agent-browser"]
    if bool(options.get("headed", False)):
        command_prefix.append("--headed")

    profile = options.get("profile")
    if profile:
        command_prefix.extend(["--profile", str(profile)])

    session_name = options.get("sessionName")
    if session_name:
        command_prefix.extend(["--session-name", str(session_name)])

    state_path: Path | None = None
    state_file = options.get("stateFile")
    if state_file:
        state_path = Path(str(state_file))
        if not state_path.exists():
            raise AgentBrowserScriptError(
                reason="invalid_config",
                message=f"stateFile does not exist: {state_file}",
            )

    command_prefix_with_state = (
        command_prefix + ["--state", str(state_path)]
        if state_path
        else command_prefix
    )
    return command_prefix, command_prefix_with_state


def _safe_close_daemon(verbose: bool) -> None:
    _emit_log(verbose, "close daemon")
    try:
        subprocess.run(
            ["agent-browser", "close"],
            capture_output=True,
            text=True,
            timeout=10,
            check=False,
        )
    except Exception as error:
        _emit_log(verbose, f"close daemon skipped: {error}")


def _normalize_optional_str(raw_value: Any, field_name: str) -> str | None:
    if raw_value is None:
        return None
    if not isinstance(raw_value, str) or not raw_value.strip():
        raise AgentBrowserScriptError(
            reason="invalid_config",
            message=f"{field_name} must be a non-empty string",
        )
    return raw_value.strip()


def _extract_loop_config(options: dict[str, Any]) -> dict[str, Any] | None:
    raw_loop = options.get("loop")
    if raw_loop is None:
        return None
    if not isinstance(raw_loop, dict):
        raise AgentBrowserScriptError(
            reason="invalid_config",
            message="loop must be an object",
        )
    raw_steps = raw_loop.get("steps")
    if not isinstance(raw_steps, list) or not raw_steps:
        raise AgentBrowserScriptError(
            reason="invalid_config",
            message="loop.steps must be a non-empty array",
        )
    max_iterations = _read_int(raw_loop.get("maxIterations", 1), field_name="loop.maxIterations", minimum=1)
    interval_ms = _read_int(raw_loop.get("intervalMs", 0), field_name="loop.intervalMs", minimum=0)
    break_when = raw_loop.get("breakWhen")
    if break_when is not None:
        if not isinstance(break_when, dict):
            raise AgentBrowserScriptError(
                reason="invalid_config",
                message="loop.breakWhen must be an object",
            )
        capture_key = break_when.get("captureKey")
        text_includes = break_when.get("textIncludes")
        if capture_key is not None and (not isinstance(capture_key, str) or not capture_key.strip()):
            raise AgentBrowserScriptError(
                reason="invalid_config",
                message="loop.breakWhen.captureKey must be a non-empty string",
            )
        text_includes_values: list[str] | None = None
        if text_includes is not None:
            if isinstance(text_includes, str):
                if not text_includes:
                    raise AgentBrowserScriptError(
                        reason="invalid_config",
                        message="loop.breakWhen.textIncludes must be a non-empty string or array",
                    )
                text_includes_values = [text_includes]
            elif isinstance(text_includes, list) and text_includes:
                values: list[str] = []
                for value in text_includes:
                    if not isinstance(value, str) or not value:
                        raise AgentBrowserScriptError(
                            reason="invalid_config",
                            message=(
                                "loop.breakWhen.textIncludes list must contain non-empty strings"
                            ),
                        )
                    values.append(value)
                text_includes_values = values
            else:
                raise AgentBrowserScriptError(
                    reason="invalid_config",
                    message="loop.breakWhen.textIncludes must be a non-empty string or array",
                )
        if (capture_key is None) != (text_includes is None):
            raise AgentBrowserScriptError(
                reason="invalid_config",
                message="loop.breakWhen requires both captureKey and textIncludes",
            )
        if break_when is not None and text_includes_values is not None:
            break_when = {
                **break_when,
                "_text_includes_values": text_includes_values,
            }
    return {
        "steps": raw_steps,
        "max_iterations": max_iterations,
        "interval_ms": interval_ms,
        "break_when": break_when,
    }


def _extract_capture_filter_config(options: dict[str, Any]) -> dict[str, Any]:
    raw_filter = options.get("captureFilter")
    if raw_filter is None:
        return {
            "enabled": False,
            "dedupe": False,
            "min_chars": 0,
            "per_line": False,
            "keys": None,
        }
    if not isinstance(raw_filter, dict):
        raise AgentBrowserScriptError(
            reason="invalid_config",
            message="captureFilter must be an object",
        )

    dedupe = bool(raw_filter.get("dedupe", False))
    per_line = bool(raw_filter.get("perLine", False))
    min_chars = _read_int(raw_filter.get("minChars", 0), field_name="captureFilter.minChars", minimum=0)
    normalize_ref_tags = bool(raw_filter.get("normalizeRefTags", raw_filter.get("normalizeRefSuffix", False)))
    def _read_string_list(raw_value: Any, field_name: str) -> list[str] | None:
        if raw_value is None:
            return None
        if not isinstance(raw_value, list) or not raw_value:
            raise AgentBrowserScriptError(
                reason="invalid_config",
                message=f"{field_name} must be a non-empty string array",
            )
        values: list[str] = []
        for value in raw_value:
            if not isinstance(value, str) or not value.strip():
                raise AgentBrowserScriptError(
                    reason="invalid_config",
                    message=f"{field_name} must contain non-empty strings",
                )
            values.append(value.strip())
        return values

    raw_keys = raw_filter.get("keys")
    keys: set[str] | None = None
    if raw_keys is not None:
        normalized_keys: set[str] = set(_read_string_list(raw_keys, "captureFilter.keys"))
        keys = normalized_keys

    starts_with = _read_string_list(raw_filter.get("startsWith") or raw_filter.get("star_with"), "captureFilter.startsWith")
    excludes = _read_string_list(raw_filter.get("excludes") or raw_filter.get("ext"), "captureFilter.excludes")
    if starts_with and excludes:
        raise AgentBrowserScriptError(
            reason="invalid_config",
            message="captureFilter.startsWith and captureFilter.excludes are mutually exclusive",
        )

    return {
        "enabled": True,
        "dedupe": dedupe,
        "min_chars": min_chars,
        "per_line": per_line,
        "keys": keys,
        "starts_with": starts_with,
        "excludes": excludes,
        "normalize_ref_tags": normalize_ref_tags,
    }


def _should_break_loop(captures: dict[str, list[str]], break_when: dict[str, Any] | None) -> bool:
    if not break_when:
        return False
    capture_key = break_when.get("captureKey")
    text_includes_values = break_when.get("_text_includes_values")
    if not capture_key or not text_includes_values:
        return False
    values = captures.get(capture_key, [])
    if not values:
        return False
    latest = values[-1]
    return any(keyword in latest for keyword in text_includes_values)


def _append_capture_values(
    captures: dict[str, list[str]],
    capture_key: str,
    stdout: str,
    capture_filter: dict[str, Any],
) -> None:
    if not capture_filter["enabled"]:
        captures.setdefault(capture_key, []).append(stdout)
        return

    keys = capture_filter["keys"]
    if keys is not None and capture_key not in keys:
        captures.setdefault(capture_key, []).append(stdout)
        return

    raw_items = stdout.splitlines() if capture_filter["per_line"] else [stdout]
    min_chars = capture_filter["min_chars"]
    dedupe = capture_filter["dedupe"]
    starts_with = capture_filter["starts_with"]
    excludes = capture_filter["excludes"]
    normalize_ref_tags = capture_filter["normalize_ref_tags"]
    existing = captures.setdefault(capture_key, [])
    dedupe_seen: set[str] = set()

    def _normalize_for_dedupe(raw: str) -> str:
        if not normalize_ref_tags:
            return raw
        normalized = _REF_INLINE_PATTERN.sub("", raw)
        normalized = _REF_SUFFIX_PATTERN.sub("", normalized)
        return " ".join(normalized.split())

    if dedupe:
        for value in existing:
            normalized_value = _normalize_for_dedupe(value)
            dedupe_seen.add(normalized_value)

    for item in raw_items:
        value = item.strip()
        if not value:
            continue
        if len(value) < min_chars:
            continue
        if starts_with and not any(value.startswith(prefix) for prefix in starts_with):
            continue
        if excludes and any(value.startswith(prefix) for prefix in excludes):
            continue
        dedupe_key = _normalize_for_dedupe(value)
        if dedupe and dedupe_key in dedupe_seen:
            continue
        existing.append(value)
        if dedupe:
            dedupe_seen.add(dedupe_key)


def _execute_steps_batch(
    *,
    steps: list[dict[str, Any]],
    instance: AgentBrowserInstanceState,
    captures: dict[str, list[str]],
    debug_steps: list[dict[str, Any]],
    step_results: list[AgentBrowserStepResult],
    capture_filter: dict[str, Any],
    command_timeout_ms: int,
    verbose: bool,
    batch_label: str,
) -> bool:
    should_close_by_step = False
    for step_index, step in enumerate(steps, start=1):
        if not isinstance(step, dict):
            raise AgentBrowserScriptError(
                reason="invalid_config",
                message=f"{batch_label}.steps[{step_index - 1}] must be an object",
                step_index=step_index,
            )

        command = step.get("command")
        if not isinstance(command, str) or not command.strip():
            raise AgentBrowserScriptError(
                reason="invalid_config",
                message=f"{batch_label}.steps[{step_index - 1}].command is required",
                step_index=step_index,
            )

        repeat = _read_int(step.get("repeat", 1), field_name=f"{batch_label}.steps[{step_index - 1}].repeat", minimum=1)
        interval_ms = _read_int(
            step.get("intervalMs", 0),
            field_name=f"{batch_label}.steps[{step_index - 1}].intervalMs",
            minimum=0,
        )
        capture_as = step.get("captureAs")
        if capture_as is not None and (not isinstance(capture_as, str) or not capture_as.strip()):
            raise AgentBrowserScriptError(
                reason="invalid_config",
                message=f"{batch_label}.steps[{step_index - 1}].captureAs must be a non-empty string",
                step_index=step_index,
            )

        command_parts = shlex.split(command)
        for attempt in range(1, repeat + 1):
            is_close_command = bool(command_parts) and command_parts[0] == "close"
            if is_close_command:
                args = ["agent-browser", "close"]
                should_close_by_step = True
            else:
                active_prefix = (
                    instance.command_prefix_with_state
                    if (instance.command_prefix_with_state != instance.command_prefix and not instance.state_applied)
                    else instance.command_prefix
                )
                args = active_prefix + command_parts
                if instance.command_prefix_with_state != instance.command_prefix and not instance.state_applied:
                    instance.state_applied = True

            started_at = time.monotonic()
            _emit_log(
                verbose,
                f"{batch_label} step={step_index}/{len(steps)} attempt={attempt}/{repeat} command={command}",
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
                "batch": batch_label,
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
                f"{batch_label} step={step_index} attempt={attempt} exit={completed.returncode} elapsed={elapsed_ms}ms",
            )
            if completed.returncode != 0:
                detail = stderr.strip() or stdout.strip() or f"exit code {completed.returncode}"
                _emit_log(
                    verbose,
                    f"{batch_label} step failed step={step_index} command={command} detail={_truncate_text(detail)}",
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
                _append_capture_values(
                    captures,
                    capture_as,
                    stdout,
                    capture_filter,
                )

            if interval_ms > 0 and attempt < repeat:
                _emit_log(verbose, f"{batch_label} sleep interval {interval_ms}ms before next repeat")
                time.sleep(interval_ms / 1000)
    return should_close_by_step


def _create_instance(options: dict[str, Any], *, verbose: bool) -> AgentBrowserInstanceState:
    command_prefix, command_prefix_with_state = _build_command_prefixes(options)
    owner_id = _normalize_optional_str(options.get("ownerId"), "ownerId")
    session_key = _normalize_optional_str(options.get("sessionKey"), "sessionKey")
    ttl_seconds = _read_int(options.get("instanceTtlSeconds", 900), field_name="instanceTtlSeconds", minimum=1)
    instance = AgentBrowserInstanceState(
        instance_id=f"ab-{uuid4().hex[:10]}",
        tab_id=f"tab-{uuid4().hex[:8]}",
        command_prefix=command_prefix,
        command_prefix_with_state=command_prefix_with_state,
        state_applied=False,
        owner_id=owner_id,
        session_key=session_key,
        ttl_seconds=ttl_seconds,
        created_at=time.time(),
        last_used_at=time.time(),
    )
    _emit_log(
        verbose,
        f"created instance instanceId={instance.instance_id} tabId={instance.tab_id}",
    )
    return instance


def _resolve_instance(options: dict[str, Any], *, verbose: bool) -> tuple[AgentBrowserInstanceState, bool]:
    instance_id = options.get("instanceId")
    request_owner_id = _normalize_optional_str(options.get("ownerId"), "ownerId")
    request_session_key = _normalize_optional_str(options.get("sessionKey"), "sessionKey")
    if instance_id:
        with _INSTANCE_LOCK:
            instance = _INSTANCES.get(str(instance_id))
        if not instance:
            raise AgentBrowserScriptError(
                reason="invalid_config",
                message=f"instanceId not found or already closed: {instance_id}",
            )
        now = time.time()
        idle_seconds = now - instance.last_used_at
        if idle_seconds > instance.ttl_seconds:
            with _INSTANCE_LOCK:
                _INSTANCES.pop(instance.instance_id, None)
            _safe_close_daemon(verbose)
            raise AgentBrowserScriptError(
                reason="instance_expired",
                message=(
                    f"instanceId expired after {int(idle_seconds)}s idle "
                    f"(ttl={instance.ttl_seconds}s): {instance_id}"
                ),
            )
        if instance.owner_id and request_owner_id != instance.owner_id:
            raise AgentBrowserScriptError(
                reason="forbidden_instance_owner",
                message="instanceId owner mismatch",
            )
        if instance.session_key and request_session_key != instance.session_key:
            raise AgentBrowserScriptError(
                reason="forbidden_instance_session",
                message="instanceId session mismatch",
            )
        instance.last_used_at = time.time()
        _emit_log(verbose, f"reuse instance instanceId={instance.instance_id} tabId={instance.tab_id}")
        return instance, False

    instance = _create_instance(options, verbose=verbose)
    with _INSTANCE_LOCK:
        _INSTANCES[instance.instance_id] = instance
    return instance, True


def execute_agent_browser_script(config: dict[str, Any]) -> AgentBrowserScriptResult:
    options = _extract_runtime_options(config)
    heartbeat = bool(options.get("heartbeat", False))
    if heartbeat and not options.get("instanceId"):
        raise AgentBrowserScriptError(
            reason="invalid_config",
            message="heartbeat requires instanceId",
        )
    loop_config = _extract_loop_config(options)
    capture_filter = _extract_capture_filter_config(options)
    steps = _extract_script_steps(
        config,
        allow_empty=heartbeat or loop_config is not None,
        allow_missing=heartbeat or loop_config is not None,
    )

    command_timeout_ms = _read_int(options.get("commandTimeoutMs", 30000), field_name="commandTimeoutMs", minimum=1)
    close_on_complete = bool(options.get("closeOnComplete", False))
    verbose = bool(options.get("verbose", True))
    instance, created_new_instance = _resolve_instance(options, verbose=verbose)
    state_file = options.get("stateFile")
    should_close_by_step = False

    step_results: list[AgentBrowserStepResult] = []
    captures: dict[str, list[str]] = {}
    debug_steps: list[dict[str, Any]] = []

    _emit_log(
        verbose,
        f"start script instanceId={instance.instance_id} tabId={instance.tab_id} "
        f"steps={len(steps)} heartbeat={heartbeat} state={state_file or '-'}",
    )

    if created_new_instance:
        _emit_log(verbose, "preflight close daemon")
        _safe_close_daemon(verbose)

    if heartbeat and not steps:
        _emit_log(verbose, "heartbeat only request acknowledged")
        with _INSTANCE_LOCK:
            is_active = instance.instance_id in _INSTANCES
        return AgentBrowserScriptResult(
            step_results=[],
            captures={},
            instance_id=instance.instance_id,
            tab_id=instance.tab_id,
            instance_active=is_active,
            ttl_seconds=instance.ttl_seconds,
            expires_at_epoch=instance.last_used_at + instance.ttl_seconds,
        )

    try:
        if steps:
            should_close_by_step = _execute_steps_batch(
                steps=steps,
                instance=instance,
                captures=captures,
                debug_steps=debug_steps,
                step_results=step_results,
                capture_filter=capture_filter,
                command_timeout_ms=command_timeout_ms,
                verbose=verbose,
                batch_label="script",
            )

        if loop_config:
            loop_broken = False
            for iteration in range(1, loop_config["max_iterations"] + 1):
                _emit_log(
                    verbose,
                    f"loop iteration={iteration}/{loop_config['max_iterations']}",
                )
                if _execute_steps_batch(
                    steps=loop_config["steps"],
                    instance=instance,
                    captures=captures,
                    debug_steps=debug_steps,
                    step_results=step_results,
                    capture_filter=capture_filter,
                    command_timeout_ms=command_timeout_ms,
                    verbose=verbose,
                    batch_label=f"loop[{iteration}]",
                ):
                    should_close_by_step = True
                if _should_break_loop(captures, loop_config["break_when"]):
                    loop_broken = True
                    _emit_log(verbose, f"loop break triggered at iteration={iteration}")
                    break
                if loop_config["interval_ms"] > 0 and iteration < loop_config["max_iterations"]:
                    _emit_log(verbose, f"loop sleep interval {loop_config['interval_ms']}ms")
                    time.sleep(loop_config["interval_ms"] / 1000)
            if not loop_broken and loop_config["break_when"]:
                _emit_log(verbose, "loop reached maxIterations without matching breakWhen condition")
    finally:
        instance.last_used_at = time.time()
        should_close_instance = close_on_complete or should_close_by_step
        if should_close_instance:
            try:
                _emit_log(verbose, "close daemon on complete")
                _safe_close_daemon(verbose)
            except Exception:
                pass
            with _INSTANCE_LOCK:
                _INSTANCES.pop(instance.instance_id, None)

    _emit_log(verbose, f"script completed steps_executed={len(step_results)}")
    with _INSTANCE_LOCK:
        is_active = instance.instance_id in _INSTANCES
    return AgentBrowserScriptResult(
        step_results=step_results,
        captures=captures,
        instance_id=instance.instance_id,
        tab_id=instance.tab_id,
        instance_active=is_active,
        ttl_seconds=instance.ttl_seconds,
        expires_at_epoch=instance.last_used_at + instance.ttl_seconds,
    )


def heartbeat_agent_browser_instance(config: dict[str, Any]) -> AgentBrowserScriptResult:
    options = _extract_runtime_options(config)
    verbose = bool(options.get("verbose", True))
    instance, _ = _resolve_instance(options, verbose=verbose)
    with _INSTANCE_LOCK:
        is_active = instance.instance_id in _INSTANCES
    return AgentBrowserScriptResult(
        step_results=[],
        captures={},
        instance_id=instance.instance_id,
        tab_id=instance.tab_id,
        instance_active=is_active,
        ttl_seconds=instance.ttl_seconds,
        expires_at_epoch=instance.last_used_at + instance.ttl_seconds,
    )
