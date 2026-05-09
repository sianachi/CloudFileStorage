from pydantic import BaseModel, Field


class RegisterUserRequest(BaseModel):
    username: str = Field(..., min_length=1)
    password: str = Field(..., min_length=1)
    email: str = Field(..., min_length=3)


class LoginUserRequest(BaseModel):
    username: str = Field(..., min_length=1)
    password: str = Field(..., min_length=1)


class LoginResponse(BaseModel):
    """Result of an authentication attempt."""

    success: bool
    message: str
    access_token: str | None = None
    token_type: str | None = None


class RegisterResponse(BaseModel):
    """Result of a registration attempt."""

    success: bool
    message: str
    username: str | None = None


class LogoutResponse(BaseModel):
    success: bool
    message: str


class TokenVerificationResult(BaseModel):
    """Outcome of validating an access token."""

    valid: bool
    message: str | None = None
    username: str | None = None


class MeResponse(BaseModel):
    username: str
