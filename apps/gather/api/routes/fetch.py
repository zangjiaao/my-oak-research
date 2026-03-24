from typing import Any, Dict

from fastapi import APIRouter

from api.services import fetch_service
from schemas import ErrorResponse, FetchV3Response

router = APIRouter()


@router.post(
    "/v1/fetch",
    response_model=FetchV3Response,
    response_model_exclude_none=True,
    responses={
        400: {"model": ErrorResponse},
        422: {"model": ErrorResponse},
        500: {"model": ErrorResponse},
    },
)
async def fetch_data_v1(payload: Dict[str, Any]):
    from api import app as app_module

    app_module.sync_runtime_state()
    return await fetch_service.fetch_data(payload)
