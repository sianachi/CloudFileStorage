from pydantic import BaseModel, Field, field_validator

from const import Constants
from services.auth.password_policy import validate_password


class FileEntry(BaseModel):
    name: str
    path: str
    size: int
    is_directory: bool
    last_updated: str
    checksum: str | None = None


class VerifyResponse(BaseModel):
    path: str
    algorithm: str = "sha256"
    stored_checksum: str | None
    computed_checksum: str
    ok: bool


class ListResponse(BaseModel):
    path: str
    entries: list[FileEntry]


class SearchResponse(BaseModel):
    query: str
    entries: list[FileEntry]


class CreateFolderRequest(BaseModel):
    path: str = Field(..., min_length=1)


class RenameRequest(BaseModel):
    new_name: str = Field(..., min_length=1)


class MoveRequest(BaseModel):
    source: str = Field(..., min_length=1)
    destination_parent: str = Field(..., min_length=1)


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


class CreateShareRequest(BaseModel):
    path: str = Field(..., min_length=1)
    target_username: str | None = None
    public: bool = False
    role: str = Field("read", pattern="^(read|write)$")
    expires_in_hours: int | None = Field(None, ge=1)


class ShareInfo(BaseModel):
    id: int
    kind: str  # "user" | "link"
    entry_path: str
    is_directory: bool
    role: str
    target_username: str | None = None
    public_token: str | None = None
    created_at: str
    expires_at: str | None = None


class ShareListResponse(BaseModel):
    shares: list[ShareInfo]


class SharedWithMeEntry(BaseModel):
    share_id: int
    owner_username: str
    name: str
    entry_path: str  # path in the owner's namespace (the share root)
    is_directory: bool
    role: str
    expires_at: str | None = None


class SharedWithMeResponse(BaseModel):
    entries: list[SharedWithMeEntry]


class PublicShareInfo(BaseModel):
    name: str
    is_directory: bool
    role: str
    size: int


class VersionEntry(BaseModel):
    version_no: int
    size: int
    checksum: str | None
    created_at: str


class VersionListResponse(BaseModel):
    path: str
    versions: list[VersionEntry]


class TrashEntry(BaseModel):
    name: str
    trash_path: str  # current path within the hidden trash namespace
    original_path: str  # where it will be restored to
    size: int
    is_directory: bool
    deleted_at: str  # ISO timestamp


class TrashListResponse(BaseModel):
    entries: list[TrashEntry]


class EmptyTrashResponse(BaseModel):
    purged: int
