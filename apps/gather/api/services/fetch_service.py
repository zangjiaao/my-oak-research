from typing import Any, Dict

from api.services import runtime_service as runtime


async def fetch_data(payload: Dict[str, Any]):
    return await runtime.fetch_data_v1(payload)
