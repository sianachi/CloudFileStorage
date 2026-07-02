"""FastAPI dependency callables; keep thin to avoid circular imports with `main`."""

from fastapi import Depends, HTTPException, Request
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from models.auth.user import User
from services.auth.auth_management import AuthManagement
from services.auth.rate_limiter import LoginRateGuard
from services.filesystem import Filesystem


_bearer = HTTPBearer(auto_error=False)


def get_filesystem(request: Request) -> Filesystem:
    return request.app.state.filesystem


def get_auth_management(request: Request) -> AuthManagement:
    return request.app.state.auth_management


def get_login_guard(request: Request) -> LoginRateGuard:
    return request.app.state.login_guard


def client_ip(request: Request) -> str:
    """Best-effort client IP, trusting the first X-Forwarded-For hop.

    Behind the k8s ingress the real client is in X-Forwarded-For; direct
    connections fall back to the socket peer. Good enough for rate limiting;
    do not use for anything security-critical since XFF is spoofable when
    not behind a trusted proxy.
    """
    forwarded = request.headers.get("x-forwarded-for")
    if forwarded:
        first = forwarded.split(",")[0].strip()
        if first:
            return first
    return request.client.host if request.client else "unknown"


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
