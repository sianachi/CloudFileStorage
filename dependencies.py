"""FastAPI dependency callables; keep thin to avoid circular imports with `main`."""

import os

from fastapi import Depends, HTTPException, Request
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from models.auth.user import User
from services.auth.auth_management import AuthManagement
from services.auth.rate_limiter import LoginRateGuard
from services.filesystem import Filesystem
from services.filesystem.upload_sessions import UploadSessionManager
from services.sharing import ShareService


_bearer = HTTPBearer(auto_error=False)


def get_filesystem(request: Request) -> Filesystem:
    return request.app.state.filesystem


def get_auth_management(request: Request) -> AuthManagement:
    return request.app.state.auth_management


def get_login_guard(request: Request) -> LoginRateGuard:
    return request.app.state.login_guard


def get_share_service(request: Request) -> ShareService:
    return request.app.state.share_service


def get_upload_sessions(request: Request) -> UploadSessionManager:
    return request.app.state.upload_sessions


def _trusted_proxies() -> set[str]:
    """Peer IPs whose X-Forwarded-For header we trust (e.g. the k8s ingress).

    Configured via TRUSTED_PROXIES (comma-separated). Empty by default so the
    safe behaviour — ignore XFF entirely — holds unless an operator opts in.
    """
    raw = os.getenv("TRUSTED_PROXIES", "")
    return {p.strip() for p in raw.split(",") if p.strip()}


def client_ip(request: Request) -> str:
    """Client IP used for rate limiting.

    X-Forwarded-For is client-controllable, so honoring it blindly would let an
    attacker mint a fresh rate-limit bucket per forged IP. We therefore trust
    XFF only when the immediate socket peer is a configured trusted proxy, and
    even then take the right-most entry (the hop the trusted proxy itself
    added) rather than the attacker-controlled left-most one. Otherwise we use
    the unspoofable socket peer.
    """
    peer = request.client.host if request.client else "unknown"
    if peer in _trusted_proxies():
        forwarded = request.headers.get("x-forwarded-for")
        if forwarded:
            hops = [h.strip() for h in forwarded.split(",") if h.strip()]
            if hops:
                return hops[-1]
    return peer


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
