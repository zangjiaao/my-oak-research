from api.services import runtime_service as runtime


async def list_scripts_catalog():
    return await runtime.list_scripts_catalog()
