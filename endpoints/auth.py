from fastapi import APIRouter, Depends, HTTPException
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from dependencies import get_auth_management, get_current_user
from dto.dto import (
    LoginResponse,
    LoginUserRequest,
    LogoutResponse,
    MeResponse,
    RegisterResponse,
    RegisterUserRequest,
)
from models.auth.user import User
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
async def me(user: User = Depends(get_current_user)) -> MeResponse:
    return MeResponse(username=user.username)
