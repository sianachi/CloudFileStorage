import os
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from endpoints.auth import router as auth_router
from endpoints.files import router as files_router
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


def _cors_origins() -> list[str]:
    raw = os.getenv("CORS_ORIGINS", "")
    return [o.strip() for o in raw.split(",") if o.strip()]


def create_app() -> FastAPI:
    application = FastAPI(
        title="Pithos",
        lifespan=lifespan,
    )
    origins = _cors_origins()
    if origins:
        application.add_middleware(
            CORSMiddleware,
            allow_origins=origins,
            allow_credentials=False,
            allow_methods=["*"],
            allow_headers=["*"],
        )
    application.include_router(auth_router)
    application.include_router(files_router)
    return application


app = create_app()
