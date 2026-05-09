"""FastAPI dependency callables; keep thin to avoid circular imports with `main`."""

from fastapi import Depends, HTTPException, Request
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from models.auth.user import User
from services.auth.auth_management import AuthManagement
from services.filesystem import Filesystem


_bearer = HTTPBearer(auto_error=False)


def get_filesystem(request: Request) -> Filesystem:
    return request.app.state.filesystem


def get_auth_management(request: Request) -> AuthManagement:
    return request.app.state.auth_management


async def get_current_user(
    credentials: HTTPAuthorizationCredentials | None = Depends(_bearer),
    auth: AuthManagement = Depends(get_auth_management),
) -> User:
    if credentials is None:
        raise HTTPException(status_code=401, detail="Not authenticated")
    result = auth.verify_token(credentials.credentials)
    if not result.valid or result.username is None:
        raise HTTPException(status_code=401, detail=result.message or "Unauthorized")
    user = await auth.get_user(result.username)
    if user is None:
        # Token was valid but the account no longer exists.
        raise HTTPException(status_code=401, detail="Account not found")
    return user
