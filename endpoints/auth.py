from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from dependencies import (
    client_ip,
    get_auth_management,
    get_current_user,
    get_login_guard,
)
from dto.dto import (
    LoginResponse,
    LoginUserRequest,
    LogoutResponse,
    MeResponse,
    RefreshRequest,
    RegisterResponse,
    RegisterUserRequest,
)
from models.auth.user import User
from services.auth.auth_management import AuthManagement
from services.auth.rate_limiter import LoginRateGuard

router = APIRouter(
    prefix="/auth",
    tags=["auth"],
)

_bearer = HTTPBearer(auto_error=False)


def _too_many_requests(retry_after: int) -> HTTPException:
    return HTTPException(
        status_code=429,
        detail="Too many attempts. Try again later.",
        headers={"Retry-After": str(retry_after)},
    )


@router.post("/login", response_model=LoginResponse)
async def login(
    request: Request,
    body: LoginUserRequest,
    auth: AuthManagement = Depends(get_auth_management),
    guard: LoginRateGuard = Depends(get_login_guard),
) -> LoginResponse:
    ip = client_ip(request)
    retry_after = guard.retry_after(ip, body.username)
    if retry_after > 0:
        raise _too_many_requests(retry_after)

    result = await auth.login(body)
    if not result.success:
        guard.record_failure(ip, body.username)
        # Uniform 401 regardless of "user not found" vs "bad password" so the
        # endpoint doesn't leak which usernames exist.
        raise HTTPException(status_code=401, detail="Invalid credentials")

    guard.record_success(ip, body.username)
    return result


@router.post("/register", response_model=RegisterResponse)
async def register(
    request: Request,
    body: RegisterUserRequest,
    auth: AuthManagement = Depends(get_auth_management),
    guard: LoginRateGuard = Depends(get_login_guard),
) -> RegisterResponse:
    ip = client_ip(request)
    retry_after = guard.register_retry_after(ip)
    if retry_after > 0:
        raise _too_many_requests(retry_after)
    guard.record_registration_attempt(ip)

    result = await auth.register(body)
    if not result.success:
        raise HTTPException(status_code=409, detail=result.message)
    return result


@router.post("/refresh", response_model=LoginResponse)
async def refresh(
    body: RefreshRequest,
    auth: AuthManagement = Depends(get_auth_management),
) -> LoginResponse:
    result = await auth.refresh(body.refresh_token)
    if not result.success:
        raise HTTPException(status_code=401, detail=result.message or "Invalid refresh token")
    return result


@router.post("/logout", response_model=LogoutResponse)
async def logout(
    credentials: HTTPAuthorizationCredentials | None = Depends(_bearer),
    auth: AuthManagement = Depends(get_auth_management),
) -> LogoutResponse:
    if credentials is None:
        raise HTTPException(status_code=401, detail="Not authenticated")
    return auth.logout(credentials.credentials)


@router.get("/me", response_model=MeResponse)
async def me(user: User = Depends(get_current_user)) -> MeResponse:
    return MeResponse(username=user.username)
