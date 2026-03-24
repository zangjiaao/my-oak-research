from api.services import runtime_service as runtime


async def root_status():
    return await runtime.root()
