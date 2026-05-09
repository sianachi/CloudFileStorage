import os
from datetime import datetime, timezone
from urllib.parse import quote

from fastapi import APIRouter, Depends, File as FastAPIFile, HTTPException, Query, UploadFile
from fastapi.responses import FileResponse

from dependencies import get_current_user, get_filesystem
from dto.dto import (
    CreateFolderRequest,
    DeleteResponse,
    FileEntry,
    ListResponse,
    QuotaResponse,
    RenameRequest,
)
from models.auth.user import User
from models.file import File as FileModel
from services.filesystem import Filesystem
from services.filesystem.filesystem_metadata_processor import normalize_path, parent_of


router = APIRouter(tags=["files"])


def _safe_user_path(raw: str) -> str:
    """Normalize an incoming path and reject traversal attempts."""
    if raw is None:
        raise HTTPException(status_code=400, detail="path is required")
    p = raw.strip()
    if not p:
        raise HTTPException(status_code=400, detail="path is required")
    normalized = normalize_path(p)
    # Reject any segment containing traversal markers or null bytes.
    for segment in normalized.split("/"):
        if segment in ("..", "."):
            raise HTTPException(status_code=400, detail="invalid path")
        if "\x00" in segment:
            raise HTTPException(status_code=400, detail="invalid path")
    return normalized


def _to_entry(f: FileModel) -> FileEntry:
    return FileEntry(
        name=f.name,
        path=f.path,
        size=f.size,
        is_directory=f.is_directory,
        last_updated=f.last_updated.isoformat() if isinstance(f.last_updated, datetime) else str(f.last_updated),
    )


async def _ensure_parent_exists(filesystem: Filesystem, owner_id: int, path: str) -> None:
    parent = parent_of(path)
    if parent in ("", "/"):
        return
    existing = await filesystem.get_file(owner_id, parent)
    if existing is None or not existing.is_directory:
        raise HTTPException(status_code=404, detail=f"parent folder does not exist: {parent}")


@router.get("/files", response_model=ListResponse)
async def list_files(
    path: str = Query("/"),
    filesystem: Filesystem = Depends(get_filesystem),
    user: User = Depends(get_current_user),
) -> ListResponse:
    normalized = _safe_user_path(path) if path != "/" else "/"
    if normalized != "/":
        # Confirm the folder exists and is a directory.
        target = await filesystem.get_file(user.id, normalized)
        if target is None or not target.is_directory:
            raise HTTPException(status_code=404, detail="folder not found")
    children = await filesystem.list_children(user.id, normalized)
    return ListResponse(path=normalized, entries=[_to_entry(c) for c in children])


@router.post("/files", response_model=FileEntry)
async def upload_file(
    parent: str = Query("/"),
    upload: UploadFile = FastAPIFile(...),
    filesystem: Filesystem = Depends(get_filesystem),
    user: User = Depends(get_current_user),
) -> FileEntry:
    parent_path = _safe_user_path(parent) if parent != "/" else "/"
    if parent_path != "/":
        target = await filesystem.get_file(user.id, parent_path)
        if target is None or not target.is_directory:
            raise HTTPException(status_code=404, detail="parent folder does not exist")

    name = (upload.filename or "").strip()
    if not name or "/" in name or name in (".", ".."):
        raise HTTPException(status_code=400, detail="invalid filename")

    full_path = "/" + name if parent_path == "/" else f"{parent_path}/{name}"
    full_path = _safe_user_path(full_path)

    if await filesystem.get_file(user.id, full_path) is not None:
        raise HTTPException(status_code=409, detail="a file or folder already exists at that path")

    # NOTE: read whole upload into memory — fine for small files; revisit
    # for streaming if uploads grow past tens of MB.
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
    await filesystem.add_file(new_file, user.id, raw)
    return _to_entry(new_file)


@router.get("/files/download")
async def download_file(
    path: str = Query(...),
    filesystem: Filesystem = Depends(get_filesystem),
    user: User = Depends(get_current_user),
):
    normalized = _safe_user_path(path)
    target = await filesystem.get_file(user.id, normalized)
    if target is None or target.is_directory:
        raise HTTPException(status_code=404, detail="file not found")
    disk_path = filesystem.resolve_disk_path(user.id, normalized)
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


@router.patch("/files", response_model=FileEntry)
async def rename_entry(
    body: RenameRequest,
    path: str = Query(...),
    filesystem: Filesystem = Depends(get_filesystem),
    user: User = Depends(get_current_user),
) -> FileEntry:
    normalized = _safe_user_path(path)
    new_name = body.new_name.strip()
    if not new_name or "/" in new_name or new_name in (".", ".."):
        raise HTTPException(status_code=400, detail="invalid name")
    try:
        result = await filesystem.rename(user.id, normalized, new_name)
    except FileExistsError:
        raise HTTPException(status_code=409, detail="a file or folder already exists with that name")
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    if result is None:
        raise HTTPException(status_code=404, detail="not found")
    return _to_entry(result)


@router.delete("/files", response_model=DeleteResponse)
async def delete_entry(
    path: str = Query(...),
    filesystem: Filesystem = Depends(get_filesystem),
    user: User = Depends(get_current_user),
) -> DeleteResponse:
    normalized = _safe_user_path(path)
    target = await filesystem.get_file(user.id, normalized)
    if target is None:
        raise HTTPException(status_code=404, detail="not found")
    await filesystem.remove_file(target, user.id)
    return DeleteResponse(success=True, message="deleted")


@router.post("/folders", response_model=FileEntry)
async def create_folder(
    body: CreateFolderRequest,
    filesystem: Filesystem = Depends(get_filesystem),
    user: User = Depends(get_current_user),
) -> FileEntry:
    normalized = _safe_user_path(body.path)
    if normalized == "/":
        raise HTTPException(status_code=400, detail="cannot create root")

    if await filesystem.get_file(user.id, normalized) is not None:
        raise HTTPException(status_code=409, detail="a file or folder already exists at that path")
    await _ensure_parent_exists(filesystem, user.id, normalized)

    name = normalized.rsplit("/", 1)[-1]
    now = datetime.now(timezone.utc)
    folder = FileModel(
        name=name,
        path=normalized,
        size=0,
        creation_date=now,
        last_updated=now,
        is_directory=True,
    )
    await filesystem.add_file(folder, user.id, None)
    return _to_entry(folder)


@router.get("/quota", response_model=QuotaResponse)
async def get_quota(
    filesystem: Filesystem = Depends(get_filesystem),
    user: User = Depends(get_current_user),
) -> QuotaResponse:
    used = await filesystem.bytes_used(user.id)
    return QuotaResponse(bytes_used=used, bytes_limit=None)
