from typing import Any, Dict

from fastapi import APIRouter

from core.fetch import fetch_data_v1 as _fetch_data_v1
from schemas import ErrorResponse, FetchApiResponse

router = APIRouter()


@router.post(
    "/v1/fetch",
    response_model=FetchApiResponse,
    response_model_exclude_none=True,
    responses={
        400: {"model": ErrorResponse},
        422: {"model": ErrorResponse},
        500: {"model": ErrorResponse},
    },
)
async def fetch_data_v1(payload: Dict[str, Any]):
    return await _fetch_data_v1(payload)
