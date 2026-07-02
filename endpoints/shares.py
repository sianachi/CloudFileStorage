"""Sharing and permissions.

Shared access is served by dedicated endpoints rather than by retrofitting an
owner context onto every file route. Each shared request names a share (by id
for authenticated user-shares, by token for public link-shares) plus an
optional subpath within it; the handler resolves that to a path in the
*sharer's* namespace and reuses the ordinary filesystem layer under the
sharer's owner_id. Authorization is checked centrally in the resolver.
"""

import os
from datetime import datetime, timezone
from urllib.parse import quote

from fastapi import (
    APIRouter,
    Depends,
    File as FastAPIFile,
    HTTPException,
    Query,
    UploadFile,
)
from fastapi.responses import FileResponse

from dependencies import (
    get_auth_management,
    get_current_user,
    get_filesystem,
    get_share_service,
)
from dto.dto import (
    CreateShareRequest,
    DeleteResponse,
    FileEntry,
    ListResponse,
    PublicShareInfo,
    SaveContentRequest,
    ShareInfo,
    ShareListResponse,
    SharedWithMeEntry,
    SharedWithMeResponse,
)
from models.auth.user import User
from models.file import File as FileModel
from services.auth.auth_management import AuthManagement
from services.filesystem import Filesystem
from services.filesystem.filesystem_metadata_processor import normalize_path, parent_of
from services.sharing import ShareService

router = APIRouter(tags=["shares"])


def _to_entry(f: FileModel, rel_path: str) -> FileEntry:
    """Serialize a file with a share-relative path so callers never see the
    sharer's absolute paths."""
    return FileEntry(
        name=f.name,
        path=rel_path,
        size=f.size,
        is_directory=f.is_directory,
        last_updated=f.last_updated.isoformat()
        if isinstance(f.last_updated, datetime)
        else str(f.last_updated),
        checksum=f.checksum,
    )


def _share_kind(share: dict) -> str:
    return "link" if share["public_token"] else "user"


async def _share_to_info(share: dict, auth: AuthManagement) -> ShareInfo:
    target_username = None
    if share["shared_with_user_id"] is not None:
        target = await auth.get_user_by_id(share["shared_with_user_id"])
        target_username = target.username if target else None
    return ShareInfo(
        id=share["id"],
        kind=_share_kind(share),
        entry_path=share["entry_path"],
        is_directory=bool(share["is_directory"]),
        role=share["role"],
        target_username=target_username,
        public_token=share["public_token"],
        created_at=share["created_at"],
        expires_at=share["expires_at"],
    )


def _effective_path(share: dict, subpath: str | None) -> str:
    """Resolve a share + subpath to a path in the sharer's namespace, rejecting
    anything that escapes the shared entry."""
    base = normalize_path(share["entry_path"])
    if not share["is_directory"]:
        if subpath and normalize_path(subpath) != "/":
            raise HTTPException(status_code=400, detail="this share is a single file")
        return base

    sub = normalize_path(subpath or "/")
    for segment in sub.split("/"):
        if segment in ("..", "."):
            raise HTTPException(status_code=400, detail="invalid path")
        if "\x00" in segment:
            raise HTTPException(status_code=400, detail="invalid path")
    rel = sub.lstrip("/")
    effective = base if not rel else normalize_path(f"{base}/{rel}")
    if effective != base and not effective.startswith(base + "/"):
        raise HTTPException(status_code=400, detail="path escapes the shared folder")
    return effective


def _rel_path(share: dict, effective: str) -> str:
    """The subpath of `effective` relative to the share root, as '/...'."""
    base = normalize_path(share["entry_path"])
    if effective == base:
        return "/"
    return "/" + effective[len(base):].lstrip("/")


# --- creating / managing shares ------------------------------------------


@router.post("/shares", response_model=ShareInfo)
async def create_share(
    body: CreateShareRequest,
    filesystem: Filesystem = Depends(get_filesystem),
    auth: AuthManagement = Depends(get_auth_management),
    shares: ShareService = Depends(get_share_service),
    user: User = Depends(get_current_user),
) -> ShareInfo:
    path = normalize_path(body.path)
    if path == "/":
        raise HTTPException(status_code=400, detail="cannot share the root")
    entry = await filesystem.get_file(user.id, path)
    if entry is None:
        raise HTTPException(status_code=404, detail="entry not found")

    expires_at = None
    if body.expires_in_hours:
        from datetime import timedelta

        expires_at = (
            datetime.now(timezone.utc) + timedelta(hours=body.expires_in_hours)
        ).isoformat()

    if body.public:
        share = await shares.create_link_share(
            owner_id=user.id,
            entry_path=path,
            is_directory=entry.is_directory,
            role=body.role,
            expires_at=expires_at,
        )
    else:
        if not body.target_username:
            raise HTTPException(
                status_code=400,
                detail="target_username is required for a user share",
            )
        target = await auth.get_user(body.target_username)
        if target is None:
            raise HTTPException(status_code=404, detail="target user not found")
        if target.id == user.id:
            raise HTTPException(status_code=400, detail="cannot share with yourself")
        share = await shares.create_user_share(
            owner_id=user.id,
            entry_path=path,
            is_directory=entry.is_directory,
            target_user_id=target.id,
            role=body.role,
            expires_at=expires_at,
        )
    return await _share_to_info(share, auth)


@router.get("/shares/mine", response_model=ShareListResponse)
async def list_my_shares(
    auth: AuthManagement = Depends(get_auth_management),
    shares: ShareService = Depends(get_share_service),
    user: User = Depends(get_current_user),
) -> ShareListResponse:
    rows = await shares.list_owned(user.id)
    return ShareListResponse(
        shares=[await _share_to_info(r, auth) for r in rows]
    )


@router.delete("/shares", response_model=DeleteResponse)
async def revoke_share(
    id: int = Query(...),
    shares: ShareService = Depends(get_share_service),
    user: User = Depends(get_current_user),
) -> DeleteResponse:
    ok = await shares.revoke(user.id, id)
    if not ok:
        raise HTTPException(status_code=404, detail="share not found")
    return DeleteResponse(success=True, message="share revoked")


# --- consuming shares (authenticated user shares) ------------------------


async def _load_user_share(
    share_id: int, user: User, shares: ShareService
) -> dict:
    share = await shares.get_share(share_id)
    # 404 (not 403) when it isn't ours, so we don't confirm a share exists.
    if (
        share is None
        or share["shared_with_user_id"] != user.id
        or ShareService.is_expired(share)
    ):
        raise HTTPException(status_code=404, detail="share not found")
    return share


def _require_write(share: dict) -> None:
    if share["role"] != "write":
        raise HTTPException(status_code=403, detail="read-only share")


@router.get("/shares/with-me", response_model=SharedWithMeResponse)
async def shared_with_me(
    auth: AuthManagement = Depends(get_auth_management),
    shares: ShareService = Depends(get_share_service),
    user: User = Depends(get_current_user),
) -> SharedWithMeResponse:
    rows = await shares.list_shared_with(user.id)
    entries = []
    for r in rows:
        if ShareService.is_expired(r):
            continue
        owner = await auth.get_user_by_id(r["owner_id"])
        entries.append(
            SharedWithMeEntry(
                share_id=r["id"],
                owner_username=owner.username if owner else "unknown",
                name=r["entry_path"].rsplit("/", 1)[-1],
                entry_path=r["entry_path"],
                is_directory=bool(r["is_directory"]),
                role=r["role"],
                expires_at=r["expires_at"],
            )
        )
    return SharedWithMeResponse(entries=entries)


@router.get("/shares/with-me/list", response_model=ListResponse)
async def list_shared(
    id: int = Query(...),
    subpath: str = Query("/"),
    filesystem: Filesystem = Depends(get_filesystem),
    shares: ShareService = Depends(get_share_service),
    user: User = Depends(get_current_user),
) -> ListResponse:
    share = await _load_user_share(id, user, shares)
    effective = _effective_path(share, subpath)
    owner_id = share["owner_id"]

    target = await filesystem.get_file(owner_id, effective)
    if target is None:
        raise HTTPException(status_code=404, detail="not found")
    if not target.is_directory:
        # A file: return it as a single entry.
        return ListResponse(
            path=_rel_path(share, effective),
            entries=[_to_entry(target, _rel_path(share, effective))],
        )
    children = await filesystem.list_children(owner_id, effective)
    return ListResponse(
        path=_rel_path(share, effective),
        entries=[
            _to_entry(c, _rel_path(share, c.path)) for c in children
        ],
    )


@router.get("/shares/with-me/download")
async def download_shared(
    id: int = Query(...),
    subpath: str = Query("/"),
    filesystem: Filesystem = Depends(get_filesystem),
    shares: ShareService = Depends(get_share_service),
    user: User = Depends(get_current_user),
):
    share = await _load_user_share(id, user, shares)
    effective = _effective_path(share, subpath)
    owner_id = share["owner_id"]

    target = await filesystem.get_file(owner_id, effective)
    if target is None or target.is_directory:
        raise HTTPException(status_code=404, detail="file not found")
    disk_path = filesystem.resolve_disk_path(owner_id, effective)
    if not os.path.isfile(disk_path):
        raise HTTPException(status_code=404, detail="file content missing")
    return FileResponse(
        path=disk_path,
        filename=target.name,
        media_type="application/octet-stream",
        headers={
            "Content-Disposition": f"attachment; filename*=UTF-8''{quote(target.name)}"
        },
    )


@router.put("/shares/with-me/content", response_model=FileEntry)
async def save_shared_content(
    body: SaveContentRequest,
    id: int = Query(...),
    subpath: str = Query("/"),
    filesystem: Filesystem = Depends(get_filesystem),
    shares: ShareService = Depends(get_share_service),
    user: User = Depends(get_current_user),
) -> FileEntry:
    share = await _load_user_share(id, user, shares)
    _require_write(share)
    effective = _effective_path(share, subpath)
    owner_id = share["owner_id"]

    target = await filesystem.get_file(owner_id, effective)
    if target is None:
        raise HTTPException(status_code=404, detail="file not found")
    if target.is_directory:
        raise HTTPException(status_code=409, detail="cannot write to a folder")

    raw = body.content.encode("utf-8")
    await filesystem.snapshot_version(owner_id, effective)
    await filesystem.remove_file(target, owner_id)
    now = datetime.now(timezone.utc)
    new_file = FileModel(
        name=target.name,
        path=effective,
        size=len(raw),
        creation_date=target.creation_date,
        last_updated=now,
        is_directory=False,
    )
    await filesystem.add_file(new_file, owner_id, raw)
    return _to_entry(new_file, _rel_path(share, effective))


@router.post("/shares/with-me/upload", response_model=FileEntry)
async def upload_into_shared_folder(
    id: int = Query(...),
    subpath: str = Query("/"),
    overwrite: bool = Query(False),
    upload: UploadFile = FastAPIFile(...),
    filesystem: Filesystem = Depends(get_filesystem),
    shares: ShareService = Depends(get_share_service),
    user: User = Depends(get_current_user),
) -> FileEntry:
    share = await _load_user_share(id, user, shares)
    _require_write(share)
    if not share["is_directory"]:
        raise HTTPException(status_code=400, detail="can only upload into a folder share")
    parent_effective = _effective_path(share, subpath)
    owner_id = share["owner_id"]

    parent_row = await filesystem.get_file(owner_id, parent_effective)
    if parent_row is None or not parent_row.is_directory:
        raise HTTPException(status_code=404, detail="destination folder not found")

    name = (upload.filename or "").strip()
    if not name or "/" in name or name in (".", ".."):
        raise HTTPException(status_code=400, detail="invalid filename")
    full_path = normalize_path(
        f"/{name}" if parent_effective == "/" else f"{parent_effective}/{name}"
    )

    existing = await filesystem.get_file(owner_id, full_path)
    if existing is not None:
        if not overwrite:
            raise HTTPException(status_code=409, detail="a file already exists there")
        if existing.is_directory:
            raise HTTPException(status_code=409, detail="cannot overwrite a folder")
        await filesystem.snapshot_version(owner_id, full_path)
        await filesystem.remove_file(existing, owner_id)

    raw = await upload.read()
    now = datetime.now(timezone.utc)
    new_file = FileModel(
        name=name,
        path=full_path,
        size=len(raw),
        creation_date=now,
        last_updated=now,
        is_directory=False,
    )
    await filesystem.add_file(new_file, owner_id, raw)
    return _to_entry(new_file, _rel_path(share, full_path))


# --- public link shares (no auth; read-only) -----------------------------


async def _load_link_share(token: str, shares: ShareService) -> dict:
    share = await shares.get_by_token(token)
    if share is None or ShareService.is_expired(share):
        raise HTTPException(status_code=404, detail="invalid or expired link")
    return share


@router.get("/public/{token}", response_model=PublicShareInfo)
async def public_share_info(
    token: str,
    filesystem: Filesystem = Depends(get_filesystem),
    shares: ShareService = Depends(get_share_service),
) -> PublicShareInfo:
    share = await _load_link_share(token, shares)
    entry = await filesystem.get_file(share["owner_id"], share["entry_path"])
    if entry is None:
        raise HTTPException(status_code=404, detail="shared entry no longer exists")
    return PublicShareInfo(
        name=entry.name,
        is_directory=entry.is_directory,
        role="read",  # public links are always read-only
        size=entry.size,
    )


@router.get("/public/{token}/download")
async def public_download(
    token: str,
    subpath: str = Query("/"),
    filesystem: Filesystem = Depends(get_filesystem),
    shares: ShareService = Depends(get_share_service),
):
    share = await _load_link_share(token, shares)
    effective = _effective_path(share, subpath)
    owner_id = share["owner_id"]

    target = await filesystem.get_file(owner_id, effective)
    if target is None or target.is_directory:
        raise HTTPException(status_code=404, detail="file not found")
    disk_path = filesystem.resolve_disk_path(owner_id, effective)
    if not os.path.isfile(disk_path):
        raise HTTPException(status_code=404, detail="file content missing")

    # Public links are unauthenticated and serve user-supplied bytes on our own
    # origin. Never render inline (a malicious HTML file could run script and
    # read localStorage auth tokens). Force a download with a non-sniffable,
    # non-executable type and a locked-down CSP.
    return FileResponse(
        path=disk_path,
        filename=target.name,
        media_type="application/octet-stream",
        headers={
            "Content-Disposition": f"attachment; filename*=UTF-8''{quote(target.name)}",
            "X-Content-Type-Options": "nosniff",
            "Content-Security-Policy": "default-src 'none'; sandbox",
        },
    )
