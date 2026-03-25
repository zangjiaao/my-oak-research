"""Common error-response builders."""

from typing import Any, Dict

from fastapi import HTTPException
from fastapi.responses import JSONResponse
from pydantic import ValidationError

from core.io_logging import log_api_io


def build_error_response(
    status_code: int,
    code: str,
    message: str,
    retryable: bool,
) -> JSONResponse:
    return JSONResponse(
        status_code=status_code,
        content={"error": {"code": code, "message": message, "retryable": retryable}},
    )


def build_validation_error_response(
    route: str, payload: Dict[str, Any], error: ValidationError
) -> JSONResponse:
    first_error = error.errors()[0] if error.errors() else {}
    location = ".".join(str(part) for part in first_error.get("loc", []))
    message = first_error.get("msg", "Invalid request payload")
    if location:
        message = f"{location}: {message}"
    response = build_error_response(
        status_code=422,
        code="VALIDATION_ERROR",
        message=message,
        retryable=False,
    )
    log_api_io(route, payload, response.body.decode("utf-8"), 422)
    return response


def to_driver_http_exception(error: Any) -> HTTPException:
    return HTTPException(status_code=400, detail=error.to_detail())


def to_driver_error_response(error: Any) -> JSONResponse:
    detail = error.to_detail()
    return build_error_response(
        status_code=400,
        code=detail["code"],
        message=detail["message"],
        retryable=False,
    )
