from pydantic import BaseModel, Field, field_validator

from const import Constants
from services.auth.password_policy import validate_password


class FileEntry(BaseModel):
    name: str
    path: str
    size: int
    is_directory: bool
    last_updated: str


class ListResponse(BaseModel):
    path: str
    entries: list[FileEntry]


class CreateFolderRequest(BaseModel):
    path: str = Field(..., min_length=1)


class RenameRequest(BaseModel):
    new_name: str = Field(..., min_length=1)


class QuotaResponse(BaseModel):
    bytes_used: int
    bytes_limit: int | None = None


class DeleteResponse(BaseModel):
    success: bool
    message: str


class RegisterUserRequest(BaseModel):
    username: str = Field(..., min_length=1)
    password: str = Field(..., min_length=1, max_length=Constants.MAX_PASSWORD_BYTES)

    @field_validator("password")
    @classmethod
    def _enforce_password_policy(cls, value: str) -> str:
        failures = validate_password(value)
        if failures:
            raise ValueError("; ".join(failures))
        return value


class LoginUserRequest(BaseModel):
    username: str = Field(..., min_length=1)
    password: str = Field(..., min_length=1)


class LoginResponse(BaseModel):
    """Result of an authentication attempt."""

    success: bool
    message: str
    access_token: str | None = None
    refresh_token: str | None = None
    token_type: str | None = None


class RefreshRequest(BaseModel):
    refresh_token: str = Field(..., min_length=1)


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


class ViewTokenRequest(BaseModel):
    path: str = Field(..., min_length=1)


class ViewTokenResponse(BaseModel):
    token: str
    expires_at: str  # ISO timestamp


class ZipEntry(BaseModel):
    name: str  # full path within the archive, e.g. "folder/sub/file.txt"
    is_dir: bool
    size: int  # uncompressed bytes
    compressed_size: int
    modified: str  # ISO timestamp from ZipInfo.date_time


class ZipListingResponse(BaseModel):
    path: str  # the archive's path within the user's storage
    entries: list[ZipEntry]


class SaveContentRequest(BaseModel):
    content: str
