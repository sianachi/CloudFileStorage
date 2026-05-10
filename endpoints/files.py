import mimetypes
import os
import secrets
import stat
import zipfile
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Iterable, Iterator
from urllib.parse import quote

from fastapi import APIRouter, Depends, File as FastAPIFile, HTTPException, Query, UploadFile
from fastapi.responses import FileResponse, StreamingResponse
from stream_zip import ZIP_64, stream_zip

from dependencies import get_current_user, get_filesystem
from dto.dto import (
    CreateFolderRequest,
    DeleteResponse,
    FileEntry,
    ListResponse,
    QuotaResponse,
    RenameRequest,
    SaveContentRequest,
    ViewTokenRequest,
    ViewTokenResponse,
    ZipEntry,
    ZipListingResponse,
)
from models.auth.user import User
from models.file import File as FileModel
from services.filesystem import Filesystem
from services.filesystem.filesystem_metadata_processor import normalize_path, parent_of


router = APIRouter(tags=["files"])


# View tokens are short-lived, multi-use URL credentials that let HTML media
# tags (<video>, <img>, <iframe>) load file bytes without sending an
# Authorization header. The token is bound to (user_id, path) at mint time
# so it cannot be repurposed against a different file or a different user.
#
# In-memory store is fine for a single-process dev server; a production
# deployment behind multiple workers would need Redis or a DB-backed table.
_VIEW_TOKEN_TTL_SECONDS = 3600  # 1 hour — long enough for a typical video


@dataclass
class _ViewTokenEntry:
    user_id: int
    path: str
    expires_at: datetime


_view_tokens: dict[str, _ViewTokenEntry] = {}


def _purge_expired_tokens(now: datetime) -> None:
    expired = [t for t, e in _view_tokens.items() if e.expires_at <= now]
    for t in expired:
        _view_tokens.pop(t, None)


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
    overwrite: bool = Query(False),
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

    existing = await filesystem.get_file(user.id, full_path)
    if existing is not None:
        if not overwrite:
            raise HTTPException(status_code=409, detail="a file or folder already exists at that path")
        if existing.is_directory:
            # We deliberately refuse this even with overwrite=true — replacing
            # a folder with a file would silently lose every entry inside it.
            raise HTTPException(status_code=409, detail="cannot overwrite a folder with a file")
        await filesystem.remove_file(existing, user.id)

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


@router.put("/files/content", response_model=FileEntry)
async def save_file_content(
    body: SaveContentRequest,
    path: str = Query(...),
    filesystem: Filesystem = Depends(get_filesystem),
    user: User = Depends(get_current_user),
) -> FileEntry:
    """Overwrite an existing file's contents with the supplied UTF-8 text.

    Used by the markdown editor for save. Refuses to create new files
    (the existing upload endpoint owns that flow) and refuses to operate
    on directories.
    """
    normalized = _safe_user_path(path)
    target = await filesystem.get_file(user.id, normalized)
    if target is None:
        raise HTTPException(status_code=404, detail="file not found")
    if target.is_directory:
        raise HTTPException(status_code=409, detail="cannot write to a folder")

    raw = body.content.encode("utf-8")
    # Two-step replace mirrors the overwrite path on the upload route.
    await filesystem.remove_file(target, user.id)
    now = datetime.now(timezone.utc)
    new_file = FileModel(
        name=target.name,
        path=normalized,
        size=len(raw),
        creation_date=target.creation_date,
        last_updated=now,
        is_directory=False,
    )
    await filesystem.add_file(new_file, user.id, raw)
    return _to_entry(new_file)


@router.get("/files/download")
async def download_file(
    path: str = Query(...),
    inline: bool = Query(False),
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

    if inline:
        # Inline = the browser will try to render the bytes (image, PDF, etc.)
        # rather than download. Send the real MIME so it knows how.
        guessed, _ = mimetypes.guess_type(target.name)
        media_type = guessed or "application/octet-stream"
        disposition = f"inline; filename*=UTF-8''{quote(target.name)}"
    else:
        media_type = "application/octet-stream"
        disposition = f"attachment; filename*=UTF-8''{quote(target.name)}"

    return FileResponse(
        path=disk_path,
        filename=target.name,
        media_type=media_type,
        headers={"Content-Disposition": disposition},
    )


@router.post("/files/view-token", response_model=ViewTokenResponse)
async def mint_view_token(
    body: ViewTokenRequest,
    filesystem: Filesystem = Depends(get_filesystem),
    user: User = Depends(get_current_user),
) -> ViewTokenResponse:
    normalized = _safe_user_path(body.path)
    target = await filesystem.get_file(user.id, normalized)
    if target is None or target.is_directory:
        raise HTTPException(status_code=404, detail="file not found")

    now = datetime.now(timezone.utc)
    _purge_expired_tokens(now)
    expires_at = now + timedelta(seconds=_VIEW_TOKEN_TTL_SECONDS)
    token = secrets.token_urlsafe(32)
    _view_tokens[token] = _ViewTokenEntry(
        user_id=user.id,
        path=normalized,
        expires_at=expires_at,
    )
    return ViewTokenResponse(token=token, expires_at=expires_at.isoformat())


@router.get("/files/view")
async def view_with_token(
    token: str = Query(...),
    filesystem: Filesystem = Depends(get_filesystem),
):
    # Deliberately no get_current_user dependency — the token IS the auth.
    # That's the whole point: media tags can include the token in the URL
    # but cannot send Authorization headers.
    entry = _view_tokens.get(token)
    now = datetime.now(timezone.utc)
    if entry is None or entry.expires_at <= now:
        # Lazy cleanup of the expired entry if we found one.
        if entry is not None:
            _view_tokens.pop(token, None)
        raise HTTPException(status_code=404, detail="invalid or expired token")

    target = await filesystem.get_file(entry.user_id, entry.path)
    if target is None or target.is_directory:
        raise HTTPException(status_code=404, detail="file not found")
    disk_path = filesystem.resolve_disk_path(entry.user_id, entry.path)
    if not os.path.isfile(disk_path):
        raise HTTPException(status_code=404, detail="file content missing")

    guessed, _ = mimetypes.guess_type(target.name)
    media_type = guessed or "application/octet-stream"

    # FileResponse handles HTTP Range automatically (206 Partial Content),
    # which is what makes <video> seeking work natively.
    return FileResponse(
        path=disk_path,
        filename=target.name,
        media_type=media_type,
        headers={
            "Content-Disposition": f"inline; filename*=UTF-8''{quote(target.name)}"
        },
    )


def _zip_modified_iso(date_time: tuple[int, int, int, int, int, int]) -> str:
    # ZipInfo.date_time is a 6-tuple. Pre-1980 dates aren't representable in
    # the zip format (the default is 1980-01-01 if the entry has no date).
    try:
        return datetime(*date_time).isoformat()
    except ValueError:
        return ""


@router.get("/files/zip/listing", response_model=ZipListingResponse)
async def list_zip_entries(
    path: str = Query(...),
    filesystem: Filesystem = Depends(get_filesystem),
    user: User = Depends(get_current_user),
) -> ZipListingResponse:
    normalized = _safe_user_path(path)
    target = await filesystem.get_file(user.id, normalized)
    if target is None or target.is_directory:
        raise HTTPException(status_code=404, detail="file not found")
    disk_path = filesystem.resolve_disk_path(user.id, normalized)
    if not os.path.isfile(disk_path):
        raise HTTPException(status_code=404, detail="file content missing")

    # zipfile.ZipFile reads only the central directory at construction —
    # no decompression of entry contents — so this is fast and memory-light
    # even for very large archives.
    try:
        with zipfile.ZipFile(disk_path, "r") as zf:
            entries = [
                ZipEntry(
                    name=info.filename,
                    is_dir=info.is_dir(),
                    size=info.file_size,
                    compressed_size=info.compress_size,
                    modified=_zip_modified_iso(info.date_time),
                )
                for info in zf.infolist()
            ]
    except zipfile.BadZipFile:
        raise HTTPException(status_code=400, detail="not a valid zip archive")

    return ZipListingResponse(path=normalized, entries=entries)


_ZIP_FILE_PERMS = stat.S_IFREG | 0o600
_ZIP_CHUNK_SIZE = 64 * 1024


def _file_chunks(disk_path: str) -> Iterator[bytes]:
    """Yield a file's bytes in fixed chunks; bounded memory per file."""
    with open(disk_path, "rb") as f:
        while True:
            chunk = f.read(_ZIP_CHUNK_SIZE)
            if not chunk:
                return
            yield chunk


def _folder_zip_member_iter(disk_path: str, root_name: str) -> Iterable[tuple]:
    """Walk disk_path and yield stream_zip member tuples for each file."""
    for root, _dirs, files in os.walk(disk_path):
        rel_dir = os.path.relpath(root, disk_path)
        if rel_dir == ".":
            rel_dir = ""
        for filename in files:
            full = os.path.join(root, filename)
            arcname = (
                os.path.join(root_name, rel_dir, filename)
                if rel_dir
                else os.path.join(root_name, filename)
            )
            try:
                modified_at = datetime.fromtimestamp(os.path.getmtime(full), tz=timezone.utc)
            except OSError:
                modified_at = datetime.now(timezone.utc)
            yield (
                arcname,
                modified_at,
                _ZIP_FILE_PERMS,
                ZIP_64,
                _file_chunks(full),
            )


@router.get("/files/folder/download")
async def download_folder(
    path: str = Query(...),
    filesystem: Filesystem = Depends(get_filesystem),
    user: User = Depends(get_current_user),
):
    normalized = _safe_user_path(path)
    target = await filesystem.get_file(user.id, normalized)
    if target is None or not target.is_directory:
        raise HTTPException(status_code=404, detail="folder not found")
    disk_path = filesystem.resolve_disk_path(user.id, normalized)
    if not os.path.isdir(disk_path):
        raise HTTPException(status_code=404, detail="folder content missing")

    download_name = f"{target.name}.zip"
    # stream_zip yields the zip bytes incrementally from the member generator,
    # so RAM stays at O(_ZIP_CHUNK_SIZE) and the browser starts receiving
    # bytes immediately — no full-archive build before transfer begins.
    body = stream_zip(_folder_zip_member_iter(disk_path, target.name))
    return StreamingResponse(
        body,
        media_type="application/zip",
        headers={
            "Content-Disposition": f"attachment; filename*=UTF-8''{quote(download_name)}",
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
