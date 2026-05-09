"""FastAPI dependency callables; keep thin to avoid circular imports with `main`."""

from fastapi import Request

from services.auth.auth_management import AuthManagement
from services.filesystem import Filesystem


def get_filesystem(request: Request) -> Filesystem:
    return request.app.state.filesystem


def get_auth_management(request: Request) -> AuthManagement:
    return request.app.state.auth_management
