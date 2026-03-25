"""LinkedIn intercept handlers."""

import json
from urllib.parse import quote

from fastapi import HTTPException

from core.config import LINKEDIN_INTERCEPT_INTENTS, SCRIPT_REGISTRY
from core.playwright_runner import extract_runtime_options, normalize_playwright_eval_result, run_playwright_script
from libs.script_framework import build_x_intent_script
from schemas import CleanItem, FetchRequest


async def run_linkedin_intent(request: FetchRequest, intent_type: str) -> list[CleanItem]:
    from playwright.async_api import TimeoutError as PlaywrightTimeoutError

    config = request.config if isinstance(request.config, dict) else {}
    playwright_options = config.get("playwright")
    if not isinstance(playwright_options, dict):
        raise HTTPException(status_code=400, detail="config.playwright must be an object")

    args = playwright_options.get("args", {})
    args_obj = args if isinstance(args, dict) else {}
    normalized_intent = (intent_type or "").strip().lower()
    if normalized_intent not in LINKEDIN_INTERCEPT_INTENTS:
        raise HTTPException(status_code=400, detail=f"unsupported linkedin intercept intent: {normalized_intent}")

    query = str(args_obj.get("query", "")).strip()
    if normalized_intent == "search" and not query:
        raise HTTPException(status_code=400, detail="config.playwright.args.query is required for intercept-linkedin-search mode")

    location = str(args_obj.get("location", "")).strip()
    company = str(args_obj.get("company", "")).strip()
    experience_level = str(args_obj.get("experience_level", args_obj.get("experienceLevel", ""))).strip()
    job_type = str(args_obj.get("job_type", args_obj.get("jobType", ""))).strip()
    date_posted = str(args_obj.get("date_posted", args_obj.get("datePosted", ""))).strip()
    remote = str(args_obj.get("remote", "")).strip()
    details = bool(args_obj.get("details", False))
    raw_start = args_obj.get("start", 0)
    try:
        start = int(raw_start)
    except (TypeError, ValueError):
        start = 0
    start = max(0, min(start, 1000))
    raw_limit = args_obj.get("limit", args_obj.get("count", 20))
    try:
        limit = int(raw_limit)
    except (TypeError, ValueError):
        limit = 20
    limit = max(1, min(limit, 100))

    runtime_options = extract_runtime_options(request, config, playwright_options)
    params = [f"keywords={quote(query)}"]
    if location:
        params.append(f"location={quote(location)}")
    target_url = f"https://www.linkedin.com/jobs/search/?{'&'.join(params)}"

    script_to_run = build_x_intent_script(
        SCRIPT_REGISTRY,
        normalized_intent,
        {
            "__QUERY_JSON__": json.dumps(query, ensure_ascii=False),
            "__LOCATION_JSON__": json.dumps(location, ensure_ascii=False),
            "__COMPANY_JSON__": json.dumps(company, ensure_ascii=False),
            "__EXPERIENCE_LEVEL_JSON__": json.dumps(experience_level, ensure_ascii=False),
            "__JOB_TYPE_JSON__": json.dumps(job_type, ensure_ascii=False),
            "__DATE_POSTED_JSON__": json.dumps(date_posted, ensure_ascii=False),
            "__REMOTE_JSON__": json.dumps(remote, ensure_ascii=False),
            "__START__": start,
            "__LIMIT__": limit,
            "__COUNT__": limit,
            "__DETAILS__": "true" if details else "false",
        },
        platform="linkedin",
    )

    try:
        eval_result = await run_playwright_script(
            request,
            runtime_options,
            target_url=target_url,
            script_to_run=script_to_run,
            post_navigation_wait_ms=1500,
        )
    except PlaywrightTimeoutError as error:
        raise HTTPException(status_code=504, detail=f"playwright intercept linkedin timeout: {error}") from error
    except HTTPException:
        raise
    except Exception as error:
        raise HTTPException(status_code=500, detail=f"playwright intercept linkedin {normalized_intent} failed: {error}") from error

    items = normalize_playwright_eval_result(eval_result, request, target_url)
    if not items:
        raise HTTPException(status_code=500, detail=f"playwright intercept linkedin {normalized_intent} finished without output")
    return items
