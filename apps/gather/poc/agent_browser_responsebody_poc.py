from __future__ import annotations

import argparse
import asyncio
import base64
import json
from dataclasses import dataclass
from datetime import datetime, timezone
from enum import StrEnum
from pathlib import Path
from typing import Any, Awaitable, Callable, Protocol


REPO_ROOT = Path(__file__).resolve().parents[3]
DEFAULT_REPORT_PATH = REPO_ROOT / "specs/reports/GTH-003-report.md"


class CaptureFailureReason(StrEnum):
    TIMEOUT = "timeout"
    NO_MATCH = "no_match"
    CDP_ERROR = "cdp_error"
    EMPTY_BODY = "empty_body"
    PARSE_ERROR = "parse_error"


@dataclass(slots=True)
class CaptureAttemptResult:
    ok: bool
    elapsed_ms: int
    url_pattern: str
    matched_url: str | None = None
    request_id: str | None = None
    body_text: str | None = None
    parsed_body: Any | None = None
    failure_reason: CaptureFailureReason | None = None
    error_message: str | None = None


@dataclass(slots=True)
class PocRunConfig:
    target_url: str
    url_pattern: str
    profile_dir: Path | None = None
    auth_state_file: Path | None = None
    samples: int = 5
    timeout_ms: int = 8000
    expect_json: bool = True
    headless: bool = True
    report_path: Path = DEFAULT_REPORT_PATH


@dataclass(slots=True)
class PocSummary:
    attempts: list[CaptureAttemptResult]
    total_samples: int
    success_samples: int
    success_rate: float
    failure_reasons: dict[str, int]


class CDPSessionLike(Protocol):
    async def send(self, method: str, params: dict[str, Any] | None = None) -> Any: ...

    def on(self, event: str, callback: Callable[[dict[str, Any]], Any]) -> None: ...

    async def detach(self) -> None: ...


TriggerRequest = Callable[[], Awaitable[None]]


def summarize_attempts(attempts: list[CaptureAttemptResult]) -> PocSummary:
    total_samples = len(attempts)
    success_samples = sum(1 for attempt in attempts if attempt.ok)
    success_rate = (success_samples / total_samples) if total_samples else 0.0
    failure_reasons: dict[str, int] = {}
    for attempt in attempts:
        if attempt.failure_reason:
            failure_reasons[attempt.failure_reason.value] = (
                failure_reasons.get(attempt.failure_reason.value, 0) + 1
            )
    return PocSummary(
        attempts=attempts,
        total_samples=total_samples,
        success_samples=success_samples,
        success_rate=success_rate,
        failure_reasons=failure_reasons,
    )


def _decode_response_body(payload: dict[str, Any]) -> str:
    body = str(payload.get("body", ""))
    if payload.get("base64Encoded"):
        return base64.b64decode(body).decode("utf-8")
    return body


def _elapsed_ms(start_time: float) -> int:
    now = asyncio.get_running_loop().time()
    return int((now - start_time) * 1000)


async def capture_response_body(
    cdp_session: CDPSessionLike,
    *,
    url_pattern: str,
    timeout_ms: int,
    trigger_request: TriggerRequest | None = None,
    expect_json: bool = True,
) -> CaptureAttemptResult:
    started_at = asyncio.get_running_loop().time()
    queue: asyncio.Queue[tuple[str, str]] = asyncio.Queue(maxsize=1)
    observed_responses = 0

    def on_response_received(event: dict[str, Any]) -> None:
        nonlocal observed_responses
        observed_responses += 1
        response = event.get("response") or {}
        url = str(response.get("url", ""))
        if url_pattern not in url:
            return
        request_id = event.get("requestId")
        if not request_id:
            return
        if queue.empty():
            queue.put_nowait((str(request_id), url))

    cdp_session.on("Network.responseReceived", on_response_received)
    await cdp_session.send("Network.enable")

    trigger_task: asyncio.Task[None] | None = None
    if trigger_request:
        trigger_task = asyncio.create_task(trigger_request())

    timeout_seconds = timeout_ms / 1000
    try:
        request_id, matched_url = await asyncio.wait_for(queue.get(), timeout=timeout_seconds)
    except asyncio.TimeoutError:
        if trigger_task and not trigger_task.done():
            trigger_task.cancel()
            await asyncio.gather(trigger_task, return_exceptions=True)
        reason = CaptureFailureReason.NO_MATCH if observed_responses > 0 else CaptureFailureReason.TIMEOUT
        message = (
            "No response matched URL pattern within timeout"
            if reason is CaptureFailureReason.NO_MATCH
            else "Timed out waiting for Network.responseReceived event"
        )
        return CaptureAttemptResult(
            ok=False,
            elapsed_ms=_elapsed_ms(started_at),
            url_pattern=url_pattern,
            failure_reason=reason,
            error_message=message,
        )

    if trigger_task:
        await asyncio.gather(trigger_task, return_exceptions=True)

    try:
        payload = await asyncio.wait_for(
            cdp_session.send("Network.getResponseBody", {"requestId": request_id}),
            timeout=timeout_seconds,
        )
    except asyncio.TimeoutError:
        return CaptureAttemptResult(
            ok=False,
            elapsed_ms=_elapsed_ms(started_at),
            url_pattern=url_pattern,
            matched_url=matched_url,
            request_id=request_id,
            failure_reason=CaptureFailureReason.TIMEOUT,
            error_message="Network.getResponseBody timeout",
        )
    except Exception as error:
        return CaptureAttemptResult(
            ok=False,
            elapsed_ms=_elapsed_ms(started_at),
            url_pattern=url_pattern,
            matched_url=matched_url,
            request_id=request_id,
            failure_reason=CaptureFailureReason.CDP_ERROR,
            error_message=str(error),
        )

    try:
        body_text = _decode_response_body(payload)
    except Exception as error:
        return CaptureAttemptResult(
            ok=False,
            elapsed_ms=_elapsed_ms(started_at),
            url_pattern=url_pattern,
            matched_url=matched_url,
            request_id=request_id,
            failure_reason=CaptureFailureReason.CDP_ERROR,
            error_message=f"Failed to decode response body: {error}",
        )

    if not body_text:
        return CaptureAttemptResult(
            ok=False,
            elapsed_ms=_elapsed_ms(started_at),
            url_pattern=url_pattern,
            matched_url=matched_url,
            request_id=request_id,
            failure_reason=CaptureFailureReason.EMPTY_BODY,
            error_message="Network.getResponseBody returned empty body",
        )

    if not expect_json:
        return CaptureAttemptResult(
            ok=True,
            elapsed_ms=_elapsed_ms(started_at),
            url_pattern=url_pattern,
            matched_url=matched_url,
            request_id=request_id,
            body_text=body_text,
            parsed_body=body_text,
        )

    try:
        parsed_body = json.loads(body_text)
    except json.JSONDecodeError as error:
        return CaptureAttemptResult(
            ok=False,
            elapsed_ms=_elapsed_ms(started_at),
            url_pattern=url_pattern,
            matched_url=matched_url,
            request_id=request_id,
            body_text=body_text,
            failure_reason=CaptureFailureReason.PARSE_ERROR,
            error_message=f"Failed to parse response body as JSON: {error.msg}",
        )

    return CaptureAttemptResult(
        ok=True,
        elapsed_ms=_elapsed_ms(started_at),
        url_pattern=url_pattern,
        matched_url=matched_url,
        request_id=request_id,
        body_text=body_text,
        parsed_body=parsed_body,
    )


async def run_poc(config: PocRunConfig) -> PocSummary:
    from playwright.async_api import async_playwright

    attempts: list[CaptureAttemptResult] = []
    async with async_playwright() as playwright:
        browser = None
        if config.profile_dir:
            context = await playwright.chromium.launch_persistent_context(
                user_data_dir=str(config.profile_dir),
                headless=config.headless,
            )
        else:
            if not config.auth_state_file:
                raise ValueError("Either profile_dir or auth_state_file must be provided")
            browser = await playwright.chromium.launch(headless=config.headless)
            context = await browser.new_context(storage_state=str(config.auth_state_file))
        try:
            page = context.pages[0] if context.pages else await context.new_page()
            for _ in range(config.samples):
                cdp_session = await context.new_cdp_session(page)
                try:
                    attempt = await capture_response_body(
                        cdp_session,
                        url_pattern=config.url_pattern,
                        timeout_ms=config.timeout_ms,
                        expect_json=config.expect_json,
                        trigger_request=lambda: page.goto(
                            config.target_url,
                            wait_until="networkidle",
                        ),
                    )
                    attempts.append(attempt)
                finally:
                    await cdp_session.detach()
        finally:
            await context.close()
            if browser:
                await browser.close()
    return summarize_attempts(attempts)


def _build_repro_command(config: PocRunConfig) -> str:
    auth_arg = (
        f"--profile-dir '{config.profile_dir}'"
        if config.profile_dir
        else f"--auth-state-file '{config.auth_state_file}'"
    )
    return (
        "cd apps/gather\n"
        "uv run python -m poc.agent_browser_responsebody_poc "
        f"{auth_arg} "
        f"--target-url '{config.target_url}' "
        f"--url-pattern '{config.url_pattern}' "
        f"--samples {config.samples} "
        f"--timeout-ms {config.timeout_ms}"
    )


def _go_no_go(summary: PocSummary) -> tuple[str, str]:
    if summary.success_rate >= 0.8:
        return ("Go", "成功率达到 80% 及以上，可进入下一阶段小范围集成验证。")
    return ("No-Go", "成功率低于 80%，建议继续优化匹配规则和超时策略后再评估。")


def build_report_markdown(config: PocRunConfig, summary: PocSummary) -> str:
    decision, rationale = _go_no_go(summary)
    failure_lines = "\n".join(
        f"- `{reason}`: {count}" for reason, count in sorted(summary.failure_reasons.items())
    )
    if not failure_lines:
        failure_lines = "- 无失败样本"
    run_time = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S UTC")
    return f"""# GTH-003 Agent Browser ResponseBody PoC Report

## 1. Scope

- Task: `GTH-003-agent-browser-responsebody-poc`
- Runtime: `agent-browser + CDP (Network.getResponseBody)`
- Generated at: {run_time}

## 2. Reproducible Command

```bash
{_build_repro_command(config)}
```

## 3. Sample Statistics

- Total samples: **{summary.total_samples}**
- Success samples: **{summary.success_samples}**
- Success rate: **{summary.success_rate:.2%}**

## 4. Failure Classification

{failure_lines}

## 5. Go/No-Go Recommendation

- Decision: **{decision}**
- Rationale: {rationale}
- Keep default gather driver unchanged (`playwright` remains default for `/fetch`).
"""


def write_report(report_path: Path, content: str) -> Path:
    report_path.parent.mkdir(parents=True, exist_ok=True)
    report_path.write_text(content, encoding="utf-8")
    return report_path


async def run_and_write_report(config: PocRunConfig) -> tuple[PocSummary, Path]:
    summary = await run_poc(config)
    report_content = build_report_markdown(config, summary)
    report_path = write_report(config.report_path, report_content)
    return summary, report_path


def _build_arg_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Run GTH-003 agent-browser CDP response body PoC and generate markdown report."
    )
    parser.add_argument("--profile-dir", type=Path)
    parser.add_argument("--auth-state-file", type=Path)
    parser.add_argument("--target-url", required=True)
    parser.add_argument("--url-pattern", required=True)
    parser.add_argument("--samples", type=int, default=5)
    parser.add_argument("--timeout-ms", type=int, default=8000)
    parser.add_argument("--report-path", type=Path, default=DEFAULT_REPORT_PATH)
    parser.add_argument("--headful", action="store_true", default=False)
    parser.add_argument("--allow-non-json", action="store_true", default=False)
    return parser


def parse_args(argv: list[str] | None = None) -> PocRunConfig:
    parser = _build_arg_parser()
    args = parser.parse_args(argv)
    has_profile = args.profile_dir is not None
    has_auth_state = args.auth_state_file is not None
    if has_profile == has_auth_state:
        parser.error("Specify exactly one of --profile-dir or --auth-state-file")
    if args.auth_state_file and not args.auth_state_file.exists():
        parser.error(f"Auth state file not found: {args.auth_state_file}")
    return PocRunConfig(
        profile_dir=args.profile_dir,
        auth_state_file=args.auth_state_file,
        target_url=args.target_url,
        url_pattern=args.url_pattern,
        samples=args.samples,
        timeout_ms=args.timeout_ms,
        expect_json=not args.allow_non_json,
        headless=not args.headful,
        report_path=args.report_path,
    )


async def _main_async(argv: list[str] | None = None) -> int:
    config = parse_args(argv)
    summary, report_path = await run_and_write_report(config)
    print(
        json.dumps(
            {
                "total_samples": summary.total_samples,
                "success_samples": summary.success_samples,
                "success_rate": summary.success_rate,
                "failure_reasons": summary.failure_reasons,
                "report_path": str(report_path),
            },
            ensure_ascii=False,
        )
    )
    return 0


def main(argv: list[str] | None = None) -> int:
    return asyncio.run(_main_async(argv))


if __name__ == "__main__":
    raise SystemExit(main())
