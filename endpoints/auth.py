from fastapi import APIRouter, Depends, HTTPException
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from dependencies import get_auth_management
from dto.dto import (
    LoginResponse,
    LoginUserRequest,
    LogoutResponse,
    MeResponse,
    RegisterResponse,
    RegisterUserRequest,
)
from services.auth.auth_management import AuthManagement

router = APIRouter(
    prefix="/auth",
    tags=["auth"],
)

_bearer = HTTPBearer(auto_error=False)


@router.post("/login", response_model=LoginResponse)
async def login(
    body: LoginUserRequest,
    auth: AuthManagement = Depends(get_auth_management),
) -> LoginResponse:
    result = await auth.login(body)
    if not result.success:
        raise HTTPException(
            status_code=401,
            detail="Invalid credentials",
        )
    return result


@router.post("/register", response_model=RegisterResponse)
async def register(
    body: RegisterUserRequest,
    auth: AuthManagement = Depends(get_auth_management),
) -> RegisterResponse:
    result = await auth.register(body)
    if not result.success:
        raise HTTPException(status_code=409, detail=result.message)
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
async def me(
    credentials: HTTPAuthorizationCredentials | None = Depends(_bearer),
    auth: AuthManagement = Depends(get_auth_management),
) -> MeResponse:
    if credentials is None:
        raise HTTPException(status_code=401, detail="Not authenticated")
    result = auth.verify_token(credentials.credentials)
    if not result.valid or result.username is None:
        raise HTTPException(
            status_code=401,
            detail=result.message or "Unauthorized",
        )
    return MeResponse(username=result.username)
