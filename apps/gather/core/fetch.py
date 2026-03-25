"""Fetch orchestration: dispatch requests and produce V1 responses."""

from typing import Any, Dict

from fastapi import HTTPException
from pydantic import BaseModel, ValidationError

from core.config import EXPOSE_INTERNAL_ERROR
from core.errors import (
    build_error_response,
    build_validation_error_response,
    to_driver_error_response,
    to_driver_http_exception,
)
from core.intercept import dispatch_intercept
from core.io_logging import log_api_io, log_internal_fetch_error
from core.normalize import (
    apply_output_fields,
    normalize_clean_items,
    normalize_fetch_request,
)
from core.playwright_runner import run_eval_script
from drivers.playwright_driver import PlaywrightDriver
from drivers.registry import DriverNotFoundError, DriverRegistry
from drivers.xhttp_driver import XHttpDriver
from libs.auth_verify import playwright_verify_auth
from libs.fetch_processing import apply_keyword_hard_filter
from schemas import (
    CleanItem,
    FetchApiRequest,
    FetchApiResponse,
    FetchRequest,
    VerifyAuthRequest,
)
from core.config import AUTH_DIR


# ---------------------------------------------------------------------------
# Playwright fetch dispatcher
# ---------------------------------------------------------------------------

async def _playwright_fetch_data(request: FetchRequest) -> list[CleanItem]:
    platform = request.platform.lower()
    config = request.config
    playwright_options = config.get("playwright")
    if isinstance(playwright_options, dict):
        mode = str(playwright_options.get("mode", "")).lower()

        result = await dispatch_intercept(platform, mode, request)
        if result is not None:
            return result

        if mode in {"eval-js", "evaljs", "eval"}:
            return await run_eval_script(request)

    raise HTTPException(
        status_code=400,
        detail=(
            f"playwright legacy clients have been removed for platform '{platform}'. "
            "Set config.playwright.mode='eval-js' or an intercept-* mode."
        ),
    )


async def _playwright_verify_auth(request: VerifyAuthRequest):
    return await playwright_verify_auth(request, auth_dir=AUTH_DIR)


# ---------------------------------------------------------------------------
# Driver registry
# ---------------------------------------------------------------------------

driver_registry = DriverRegistry(default_driver="playwright")
driver_registry.register("xhttp", XHttpDriver())
driver_registry.register(
    "playwright",
    PlaywrightDriver(
        verify_auth_handler=_playwright_verify_auth,
        fetch_handler=_playwright_fetch_data,
    ),
)


# ---------------------------------------------------------------------------
# Execute a normalized fetch request
# ---------------------------------------------------------------------------

async def _execute_fetch_request(
    request: FetchRequest, driver_name: str
) -> list[CleanItem]:
    raw_results = await driver_registry.fetch(request, driver_name=driver_name)
    results = normalize_clean_items(raw_results)
    results = apply_output_fields(results, request.output_fields, request.output_field_map)
    results = apply_keyword_hard_filter(request, results)
    if isinstance(request.output_type, str) and request.output_type.strip():
        for item in results:
            item.recordType = request.output_type.strip()
    if driver_name:
        for item in results:
            item.driver = driver_name
    return results


# ---------------------------------------------------------------------------
# Public API entry points
# ---------------------------------------------------------------------------

async def verify_auth(request: VerifyAuthRequest):
    try:
        result = await driver_registry.verify_auth(request)
        log_api_io(
            "/v1/verify-auth",
            request.model_dump(mode="json", by_alias=True),
            result.model_dump(mode="json") if isinstance(result, BaseModel) else result,
            200,
        )
        return result
    except DriverNotFoundError as error:
        log_api_io(
            "/v1/verify-auth",
            request.model_dump(mode="json", by_alias=True),
            error.to_detail(),
            400,
        )
        raise to_driver_http_exception(error)


async def fetch_data_v1(payload: Dict[str, Any]):
    try:
        request = FetchApiRequest.model_validate(payload)
    except ValidationError as e:
        return build_validation_error_response("/v1/fetch", payload, e)

    try:
        normalized_request, driver_name, meta = normalize_fetch_request(request)
        items = await _execute_fetch_request(normalized_request, driver_name)
        response_payload = FetchApiResponse(items=items, meta=meta)
        log_api_io(
            "/v1/fetch",
            payload,
            response_payload.model_dump(mode="json", by_alias=True, exclude_none=True),
            200,
        )
        return response_payload
    except DriverNotFoundError as error:
        response = to_driver_error_response(error)
        log_api_io("/v1/fetch", payload, response.body.decode("utf-8"), 400)
        return response
    except HTTPException as e:
        status_code = e.status_code
        if isinstance(e.detail, dict):
            message = str(e.detail.get("message", e.detail))
        else:
            message = str(e.detail) if e.detail else "Request failed"
        code = "FETCH_BAD_REQUEST" if status_code < 500 else "FETCH_INTERNAL_ERROR"
        retryable = status_code >= 500
        response = build_error_response(
            status_code=status_code, code=code, message=message, retryable=retryable,
        )
        log_api_io("/v1/fetch", payload, response.body.decode("utf-8"), status_code)
        return response
    except Exception as error:
        log_internal_fetch_error("/v1/fetch", payload, error)
        response = build_error_response(
            status_code=500,
            code="FETCH_INTERNAL_ERROR",
            message=(
                f"Internal server error: {type(error).__name__}: {error}"
                if EXPOSE_INTERNAL_ERROR
                else "Internal server error"
            ),
            retryable=True,
        )
        log_api_io("/v1/fetch", payload, response.body.decode("utf-8"), 500)
        return response
