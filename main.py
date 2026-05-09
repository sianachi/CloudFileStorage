import os
from contextlib import asynccontextmanager

from fastapi import FastAPI

from endpoints.auth import router as auth_router
from services.auth.auth_management import AuthManagement
from services.filesystem import Filesystem


def _storage_root() -> str:
    return os.getenv("STORAGE_ROOT", os.path.join(os.getcwd(), "virtual-files"))


@asynccontextmanager
async def lifespan(app: FastAPI):
    root = _storage_root()
    os.makedirs(root, exist_ok=True)

    filesystem = Filesystem(root)
    await filesystem.initialize()

    auth_management = AuthManagement(root)
    await auth_management.initalizeDatabase(root)

    app.state.storage_root = root
    app.state.filesystem = filesystem
    app.state.auth_management = auth_management

    yield


def create_app() -> FastAPI:
    application = FastAPI(
        title="Cloud File Storage",
        lifespan=lifespan,
    )
    application.include_router(auth_router)
    return application


app = create_app()
