import hashlib
import os
import secrets
import shutil
from datetime import datetime, timezone

from starlette.concurrency import run_in_threadpool

from const import Constants

# Trashed entries are relocated under this synthetic prefix. It is never a
# real metadata row and never a valid user path (see _safe_user_path, which
# rejects the leading-dot ".." but this uses a full "/.trash/<id>" segment
# that the app itself controls), so it can't collide with user content.
TRASH_PREFIX = "/.trash"

# Prior versions of overwritten files are stored as opaque blobs here, keyed
# by a random disk_ref. Never a real metadata row.
VERSIONS_PREFIX = "/.versions"

from models.file import File
from services.migrations import apply_migrations
from services.schema import BASELINE_VERSION, METADATA_MIGRATIONS
from services.sqlite_service import SQLiteService


def _dt_to_sql(value: datetime | str) -> str:
    """Store datetimes as ISO text so SQLite does not use deprecated datetime adapters."""
    if isinstance(value, datetime):
        return value.isoformat()
    return value


def normalize_path(path: str) -> str:
    """Canonical user-relative path: leading /, no trailing / (root stays '/')."""
    if not path:
        return "/"
    p = path.strip()
    if not p.startswith("/"):
        p = "/" + p
    if len(p) > 1:
        p = p.rstrip("/")
    return p


def parent_of(path: str) -> str:
    """Parent of a normalized path. Parent of '/' is '' (sentinel for root's parent)."""
    p = normalize_path(path)
    if p == "/":
        return ""
    parent = p.rsplit("/", 1)[0]
    return parent if parent else "/"


def _safe_remove(path: str) -> None:
    try:
        os.remove(path)
    except FileNotFoundError:
        pass


def _sha256_bytes(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def sha256_file(disk_path: str, chunk_size: int = 1024 * 1024) -> str:
    """SHA-256 of a file on disk, read in chunks to bound memory."""
    h = hashlib.sha256()
    with open(disk_path, "rb") as f:
        for chunk in iter(lambda: f.read(chunk_size), b""):
            h.update(chunk)
    return h.hexdigest()


def _row_to_file(row) -> File:
    keys = row.keys()
    return File(
        name=row["name"],
        size=row["size"],
        path=row["path"],
        is_directory=bool(row["is_directory"]),
        creation_date=datetime.fromisoformat(row["creation_date"])
        if isinstance(row["creation_date"], str)
        else row["creation_date"],
        last_updated=datetime.fromisoformat(row["last_updated"])
        if isinstance(row["last_updated"], str)
        else row["last_updated"],
        checksum=row["checksum"] if "checksum" in keys else None,
        is_favorite=bool(row["is_favorite"]) if "is_favorite" in keys else False,
    )


class FilesystemMetadataProcessor(SQLiteService):
    def __init__(self, physical_path: str = None):
        base_path = physical_path or ""
        super().__init__(os.path.join(base_path, Constants.METADATA_TABLE_NAME))
        self.TABLE_NAME: str = Constants.METADATA_TABLE_NAME
        self.__physical_path = physical_path

    async def initalizeDatabase(self, physical_path: str = None):
        self.__physical_path = physical_path
        self._db_path = os.path.join(self.__physical_path, self.TABLE_NAME)
        await self.ensure_table(
            f"""
            CREATE TABLE IF NOT EXISTS {self.TABLE_NAME} (
                owner_id INTEGER NOT NULL,
                name TEXT NOT NULL,
                path TEXT NOT NULL,
                parent_path TEXT NOT NULL,
                size INTEGER NOT NULL,
                creation_date TEXT NOT NULL,
                last_updated TEXT NOT NULL,
                is_directory INTEGER NOT NULL,
                PRIMARY KEY (owner_id, path)
            )
            """
        )
        await apply_migrations(
            self._db_path, METADATA_MIGRATIONS, baseline=BASELINE_VERSION
        )

    def _disk_path(self, owner_id: int, path: str) -> str:
        normalized = normalize_path(path).lstrip("/")
        return os.path.join(self.__physical_path, str(owner_id), normalized)

    async def add_file(self, file: File, owner_id: int, raw_bytes: bytes | None = None):
        normalized = normalize_path(file.path)
        parent = parent_of(normalized)
        disk_path = self._disk_path(owner_id, normalized)

        # Fingerprint file bytes on write so integrity can be verified later.
        checksum = (
            _sha256_bytes(raw_bytes)
            if raw_bytes is not None and not file.is_directory
            else file.checksum
        )
        # Reflect the computed digest back on the caller's object so the
        # response it builds carries the checksum without a re-read.
        file.checksum = checksum

        async with self._connect() as db:
            await db.execute(
                f"INSERT INTO {self.TABLE_NAME} "
                "(owner_id, name, path, parent_path, size, creation_date, last_updated, is_directory, checksum) "
                "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
                (
                    owner_id,
                    file.name,
                    normalized,
                    parent,
                    file.size,
                    _dt_to_sql(file.creation_date),
                    _dt_to_sql(file.last_updated),
                    int(file.is_directory),
                    checksum,
                ),
            )
            await db.commit()
        if file.is_directory:
            os.makedirs(disk_path, exist_ok=True)
        elif raw_bytes is not None:
            os.makedirs(os.path.dirname(disk_path), exist_ok=True)
            with open(disk_path, "wb") as f:
                f.write(raw_bytes)

    async def _insert_row(self, db, file: File, owner_id: int, checksum: str | None):
        normalized = normalize_path(file.path)
        await db.execute(
            f"INSERT INTO {self.TABLE_NAME} "
            "(owner_id, name, path, parent_path, size, creation_date, last_updated, is_directory, checksum) "
            "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
            (
                owner_id,
                file.name,
                normalized,
                parent_of(normalized),
                file.size,
                _dt_to_sql(file.creation_date),
                _dt_to_sql(file.last_updated),
                int(file.is_directory),
                checksum,
            ),
        )

    @staticmethod
    def _stream_to_disk(src, tmp_path: str, chunk_size: int = 1024 * 1024):
        """Copy a file-like `src` to `tmp_path` in chunks, returning
        (bytes_written, sha256_hex). Runs off the event loop."""
        h = hashlib.sha256()
        total = 0
        with open(tmp_path, "wb") as out:
            while True:
                data = src.read(chunk_size)
                if not data:
                    break
                out.write(data)
                h.update(data)
                total += len(data)
        return total, h.hexdigest()

    async def add_file_stream(self, file: File, owner_id: int, src) -> File:
        """Write an uploaded file by streaming `src` to disk in bounded memory,
        with partial-write rollback. Sets file.size and file.checksum.

        Order is: stream to a .part temp, atomically move into place, then
        insert metadata (rolling back the bytes if the insert fails) — so we
        never leave a metadata row pointing at missing bytes.
        """
        normalized = normalize_path(file.path)
        disk_path = self._disk_path(owner_id, normalized)
        os.makedirs(os.path.dirname(disk_path), exist_ok=True)
        tmp_path = f"{disk_path}.part-{secrets.token_hex(6)}"
        try:
            if hasattr(src, "seek"):
                src.seek(0)
            size, checksum = await run_in_threadpool(
                self._stream_to_disk, src, tmp_path
            )
            os.replace(tmp_path, disk_path)
        except Exception:
            _safe_remove(tmp_path)
            raise

        try:
            file.size = size
            async with self._connect() as db:
                await self._insert_row(db, file, owner_id, checksum)
                await db.commit()
        except Exception:
            _safe_remove(disk_path)
            raise
        file.checksum = checksum
        return file

    async def add_file_from_disk(
        self, file: File, owner_id: int, src_disk_path: str
    ) -> File:
        """Finalize a resumable upload: adopt an already-assembled file on disk
        as the entry's bytes (checksum + size computed here), then insert
        metadata. Used by the chunked upload protocol."""
        normalized = normalize_path(file.path)
        disk_path = self._disk_path(owner_id, normalized)
        size = os.path.getsize(src_disk_path)
        checksum = await run_in_threadpool(sha256_file, src_disk_path)
        os.makedirs(os.path.dirname(disk_path), exist_ok=True)
        os.replace(src_disk_path, disk_path)
        try:
            file.size = size
            async with self._connect() as db:
                await self._insert_row(db, file, owner_id, checksum)
                await db.commit()
        except Exception:
            _safe_remove(disk_path)
            raise
        file.checksum = checksum
        return file

    async def get_file(
        self, owner_id: int, path: str, include_deleted: bool = False
    ) -> File | None:
        normalized = normalize_path(path)
        query = f"SELECT * FROM {self.TABLE_NAME} WHERE owner_id = ? AND path = ?"
        if not include_deleted:
            query += " AND deleted_at IS NULL"
        async with self._connect() as db:
            cursor = await db.execute(query, (owner_id, normalized))
            row = await cursor.fetchone()
            if row is None:
                return None
            return _row_to_file(row)

    async def remove_file(self, file: File, owner_id: int):
        normalized = normalize_path(file.path)
        async with self._connect() as db:
            # Folder deletes cascade: drop the folder row + every descendant.
            await db.execute(
                f"DELETE FROM {self.TABLE_NAME} "
                "WHERE owner_id = ? AND (path = ? OR path LIKE ?)",
                (owner_id, normalized, f"{normalized}/%"),
            )
            await db.commit()

        disk_path = self._disk_path(owner_id, normalized)
        if file.is_directory:
            shutil.rmtree(disk_path, ignore_errors=True)
        else:
            try:
                os.remove(disk_path)
            except FileNotFoundError:
                pass

    async def update_file(self, file: File, owner_id: int):
        normalized = normalize_path(file.path)
        async with self._connect() as db:
            await db.execute(
                f"UPDATE {self.TABLE_NAME} SET "
                "name = ?, size = ?, creation_date = ?, last_updated = ?, is_directory = ? "
                "WHERE owner_id = ? AND path = ?",
                (
                    file.name,
                    file.size,
                    _dt_to_sql(file.creation_date),
                    _dt_to_sql(file.last_updated),
                    int(file.is_directory),
                    owner_id,
                    normalized,
                ),
            )
            await db.commit()

    async def rename(
        self, owner_id: int, old_path: str, new_name: str
    ) -> File | None:
        """Rename an entry within its current folder. Folder renames cascade
        to every descendant in a single transaction."""
        old_normalized = normalize_path(old_path)
        if old_normalized == "/":
            raise ValueError("cannot rename root")
        if not new_name or "/" in new_name or new_name in (".", "..") or "\x00" in new_name:
            raise ValueError("invalid name")

        existing = await self.get_file(owner_id, old_normalized)
        if existing is None:
            return None

        parent = parent_of(old_normalized)
        new_normalized = (
            "/" + new_name if parent in ("", "/") else f"{parent}/{new_name}"
        )

        if new_normalized == old_normalized:
            return existing

        collision = await self.get_file(owner_id, new_normalized)
        if collision is not None:
            raise FileExistsError(new_normalized)

        async with self._connect() as db:
            await self._relocate_subtree(
                db, owner_id, old_normalized, new_normalized, existing.is_directory
            )
            await db.commit()

        return await self.get_file(owner_id, new_normalized)

    async def list_children(self, owner_id: int, parent_path: str) -> list[File]:
        """Direct children of parent_path for owner — folders first, then files, both alphabetical."""
        normalized = normalize_path(parent_path)
        async with self._connect() as db:
            cursor = await db.execute(
                f"SELECT * FROM {self.TABLE_NAME} "
                "WHERE owner_id = ? AND parent_path = ? AND deleted_at IS NULL "
                "ORDER BY is_directory DESC, name COLLATE NOCASE",
                (owner_id, normalized),
            )
            rows = await cursor.fetchall()
            return [_row_to_file(row) for row in rows]

    async def search(
        self, owner_id: int, query: str, limit: int = 100
    ) -> list[File]:
        """Case-insensitive substring match on entry names for one owner.

        Trashed entries are excluded (deleted_at IS NULL). LIKE metacharacters
        in the query are escaped so a user searching for "50%" or "a_b" gets a
        literal match rather than wildcard behaviour.
        """
        term = query.strip()
        if not term:
            return []
        escaped = term.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
        pattern = f"%{escaped}%"
        async with self._connect() as db:
            cursor = await db.execute(
                f"SELECT * FROM {self.TABLE_NAME} "
                "WHERE owner_id = ? AND deleted_at IS NULL "
                "AND name LIKE ? ESCAPE '\\' "
                "ORDER BY is_directory DESC, name COLLATE NOCASE "
                "LIMIT ?",
                (owner_id, pattern, limit),
            )
            rows = await cursor.fetchall()
            return [_row_to_file(row) for row in rows]

    async def set_favorite(
        self, owner_id: int, path: str, favorite: bool
    ) -> File | None:
        normalized = normalize_path(path)
        existing = await self.get_file(owner_id, normalized)
        if existing is None:
            return None
        async with self._connect() as db:
            await db.execute(
                f"UPDATE {self.TABLE_NAME} SET is_favorite = ? "
                "WHERE owner_id = ? AND path = ?",
                (int(favorite), owner_id, normalized),
            )
            await db.commit()
        return await self.get_file(owner_id, normalized)

    async def list_favorites(self, owner_id: int) -> list[File]:
        async with self._connect() as db:
            cursor = await db.execute(
                f"SELECT * FROM {self.TABLE_NAME} "
                "WHERE owner_id = ? AND is_favorite = 1 AND deleted_at IS NULL "
                "ORDER BY is_directory DESC, name COLLATE NOCASE",
                (owner_id,),
            )
            return [_row_to_file(r) for r in await cursor.fetchall()]

    async def list_recent(self, owner_id: int, limit: int = 50) -> list[File]:
        """Recently modified files (not folders), newest first."""
        async with self._connect() as db:
            cursor = await db.execute(
                f"SELECT * FROM {self.TABLE_NAME} "
                "WHERE owner_id = ? AND is_directory = 0 AND deleted_at IS NULL "
                "ORDER BY last_updated DESC LIMIT ?",
                (owner_id, limit),
            )
            return [_row_to_file(r) for r in await cursor.fetchall()]

    async def bytes_used(self, owner_id: int) -> int:
        async with self._connect() as db:
            cursor = await db.execute(
                f"SELECT COALESCE(SUM(size), 0) AS total FROM {self.TABLE_NAME} "
                "WHERE owner_id = ? AND is_directory = 0 AND deleted_at IS NULL",
                (owner_id,),
            )
            row = await cursor.fetchone()
            return int(row["total"]) if row else 0

    async def _relocate_subtree(
        self, db, owner_id: int, old_path: str, new_path: str, is_directory: bool
    ) -> None:
        """Move an entry (and, for a folder, all descendants) from old_path to
        new_path within the metadata table, then move its bytes on disk.

        Shared by rename (leaf name change), move (new parent), trash, and
        restore — all of which are prefix rewrites on the subtree.
        """
        new_name = new_path.rsplit("/", 1)[-1]
        new_parent = parent_of(new_path)
        await db.execute(
            f"UPDATE {self.TABLE_NAME} SET path = ?, name = ?, parent_path = ? "
            "WHERE owner_id = ? AND path = ?",
            (new_path, new_name, new_parent, owner_id, old_path),
        )
        # Version history follows the file: keep file_versions.path in sync so
        # a renamed/moved/trashed file keeps its history.
        await db.execute(
            "UPDATE file_versions SET path = ? WHERE owner_id = ? AND path = ?",
            (new_path, owner_id, old_path),
        )
        if is_directory:
            old_prefix_len = len(old_path)
            await db.execute(
                f"UPDATE {self.TABLE_NAME} SET "
                "path = ? || SUBSTR(path, ?), "
                "parent_path = ? || SUBSTR(parent_path, ?) "
                "WHERE owner_id = ? AND path LIKE ?",
                (
                    new_path,
                    old_prefix_len + 1,
                    new_path,
                    old_prefix_len + 1,
                    owner_id,
                    old_path + "/%",
                ),
            )
            await db.execute(
                "UPDATE file_versions SET path = ? || SUBSTR(path, ?) "
                "WHERE owner_id = ? AND path LIKE ?",
                (new_path, old_prefix_len + 1, owner_id, old_path + "/%"),
            )
        old_disk = self._disk_path(owner_id, old_path)
        new_disk = self._disk_path(owner_id, new_path)
        if os.path.exists(old_disk):
            os.makedirs(os.path.dirname(new_disk), exist_ok=True)
            os.rename(old_disk, new_disk)

    async def move(
        self, owner_id: int, source: str, destination_parent: str
    ) -> File | None:
        """Move an entry into another folder, keeping its name.

        Returns the moved File, None if the source doesn't exist, or raises
        ValueError (illegal move), FileNotFoundError (missing destination) or
        FileExistsError (name taken at the destination).
        """
        src = normalize_path(source)
        if src == "/":
            raise ValueError("cannot move root")

        existing = await self.get_file(owner_id, src)
        if existing is None:
            return None

        dest_parent = normalize_path(destination_parent)
        if dest_parent != "/":
            parent_row = await self.get_file(owner_id, dest_parent)
            if parent_row is None or not parent_row.is_directory:
                raise FileNotFoundError(dest_parent)

        new_path = (
            f"/{existing.name}"
            if dest_parent == "/"
            else f"{dest_parent}/{existing.name}"
        )
        if new_path == src:
            return existing  # already there — no-op

        # A folder cannot be moved into itself or any of its own descendants.
        if existing.is_directory and (
            dest_parent == src or dest_parent.startswith(src + "/")
        ):
            raise ValueError("cannot move a folder into itself")

        if await self.get_file(owner_id, new_path) is not None:
            raise FileExistsError(new_path)

        async with self._connect() as db:
            await self._relocate_subtree(
                db, owner_id, src, new_path, existing.is_directory
            )
            await db.commit()
        return await self.get_file(owner_id, new_path)

    async def soft_delete(self, file: File, owner_id: int) -> None:
        """Move an entry into the user's trash instead of destroying it.

        The subtree is relocated under /.trash/{id}, deleted_at is stamped on
        every affected row (so it drops out of listings and quota), and the
        original location is recorded on the root for restore.
        """
        original = normalize_path(file.path)
        trash_id = secrets.token_hex(8)
        trash_root = f"{TRASH_PREFIX}/{trash_id}"
        new_path = f"{trash_root}/{file.name}"
        now = datetime.now(timezone.utc).isoformat()

        async with self._connect() as db:
            await self._relocate_subtree(
                db, owner_id, original, new_path, file.is_directory
            )
            # Stamp the whole moved subtree as deleted.
            await db.execute(
                f"UPDATE {self.TABLE_NAME} SET deleted_at = ? "
                "WHERE owner_id = ? AND (path = ? OR path LIKE ?)",
                (now, owner_id, new_path, f"{new_path}/%"),
            )
            # Record where it came from — only on the root of the trashed tree.
            await db.execute(
                f"UPDATE {self.TABLE_NAME} SET original_path = ? "
                "WHERE owner_id = ? AND path = ?",
                (original, owner_id, new_path),
            )
            await db.commit()

    async def list_trash(self, owner_id: int) -> list[dict]:
        """The roots of each trashed subtree (not their descendants)."""
        async with self._connect() as db:
            cursor = await db.execute(
                f"SELECT * FROM {self.TABLE_NAME} "
                "WHERE owner_id = ? AND deleted_at IS NOT NULL "
                "AND original_path IS NOT NULL "
                "ORDER BY deleted_at DESC",
                (owner_id,),
            )
            rows = await cursor.fetchall()
            return [dict(row) for row in rows]

    async def _trash_root(self, owner_id: int, trash_path: str) -> dict | None:
        normalized = normalize_path(trash_path)
        async with self._connect() as db:
            cursor = await db.execute(
                f"SELECT * FROM {self.TABLE_NAME} "
                "WHERE owner_id = ? AND path = ? AND deleted_at IS NOT NULL "
                "AND original_path IS NOT NULL",
                (owner_id, normalized),
            )
            row = await cursor.fetchone()
            return dict(row) if row is not None else None

    async def restore(self, owner_id: int, trash_path: str) -> File | None:
        """Move a trashed entry back to its original location.

        Returns the restored File, None if the trash entry doesn't exist, or
        raises FileExistsError / FileNotFoundError if the destination is taken
        or its parent folder no longer exists.
        """
        root = await self._trash_root(owner_id, trash_path)
        if root is None:
            return None

        target = normalize_path(root["original_path"])
        is_directory = bool(root["is_directory"])

        # Destination must be free and its parent must still exist.
        if await self.get_file(owner_id, target) is not None:
            raise FileExistsError(target)
        parent = parent_of(target)
        if parent not in ("", "/"):
            parent_row = await self.get_file(owner_id, parent)
            if parent_row is None or not parent_row.is_directory:
                raise FileNotFoundError(parent)

        async with self._connect() as db:
            await self._relocate_subtree(
                db, owner_id, normalize_path(trash_path), target, is_directory
            )
            await db.execute(
                f"UPDATE {self.TABLE_NAME} SET deleted_at = NULL, original_path = NULL "
                "WHERE owner_id = ? AND (path = ? OR path LIKE ?)",
                (owner_id, target, f"{target}/%"),
            )
            await db.commit()
        return await self.get_file(owner_id, target)

    async def purge(self, owner_id: int, trash_path: str) -> bool:
        """Permanently delete a single trashed entry and its bytes."""
        root = await self._trash_root(owner_id, trash_path)
        if root is None:
            return False
        normalized = normalize_path(trash_path)
        await self._delete_versions(owner_id, normalized)
        async with self._connect() as db:
            await db.execute(
                f"DELETE FROM {self.TABLE_NAME} "
                "WHERE owner_id = ? AND (path = ? OR path LIKE ?)",
                (owner_id, normalized, f"{normalized}/%"),
            )
            await db.commit()
        disk_path = self._disk_path(owner_id, normalized)
        if bool(root["is_directory"]):
            shutil.rmtree(disk_path, ignore_errors=True)
        else:
            try:
                os.remove(disk_path)
            except FileNotFoundError:
                pass
        return True

    async def empty_trash(self, owner_id: int) -> int:
        """Permanently delete every trashed entry for the user. Returns the
        number of trash roots removed."""
        roots = await self.list_trash(owner_id)
        for root in roots:
            await self.purge(owner_id, root["path"])
        return len(roots)

    # --- version history --------------------------------------------------

    def _version_disk_path(self, owner_id: int, disk_ref: str) -> str:
        return self._disk_path(owner_id, f"{VERSIONS_PREFIX}/{disk_ref}")

    async def snapshot_version(self, owner_id: int, path: str) -> None:
        """Copy a file's *current* bytes into version history before it is
        overwritten. No-op if the path is missing, a directory, or has no
        bytes on disk yet."""
        normalized = normalize_path(path)
        current = await self.get_file(owner_id, normalized)
        if current is None or current.is_directory:
            return
        src_disk = self._disk_path(owner_id, normalized)
        if not os.path.isfile(src_disk):
            return

        disk_ref = secrets.token_hex(16)
        dest_disk = self._version_disk_path(owner_id, disk_ref)
        os.makedirs(os.path.dirname(dest_disk), exist_ok=True)
        shutil.copy2(src_disk, dest_disk)

        checksum = current.checksum or sha256_file(src_disk)
        now = datetime.now(timezone.utc).isoformat()
        async with self._connect() as db:
            cursor = await db.execute(
                "SELECT COALESCE(MAX(version_no), 0) AS m FROM file_versions "
                "WHERE owner_id = ? AND path = ?",
                (owner_id, normalized),
            )
            row = await cursor.fetchone()
            next_no = int(row["m"]) + 1
            await db.execute(
                "INSERT INTO file_versions "
                "(owner_id, path, version_no, size, checksum, disk_ref, created_at) "
                "VALUES (?, ?, ?, ?, ?, ?, ?)",
                (owner_id, normalized, next_no, current.size, checksum, disk_ref, now),
            )
            await db.commit()

    async def list_versions(self, owner_id: int, path: str) -> list[dict]:
        normalized = normalize_path(path)
        async with self._connect() as db:
            cursor = await db.execute(
                "SELECT version_no, size, checksum, created_at FROM file_versions "
                "WHERE owner_id = ? AND path = ? ORDER BY version_no DESC",
                (owner_id, normalized),
            )
            return [dict(r) for r in await cursor.fetchall()]

    async def _version_row(
        self, owner_id: int, path: str, version_no: int
    ) -> dict | None:
        normalized = normalize_path(path)
        async with self._connect() as db:
            cursor = await db.execute(
                "SELECT * FROM file_versions "
                "WHERE owner_id = ? AND path = ? AND version_no = ?",
                (owner_id, normalized, version_no),
            )
            row = await cursor.fetchone()
            return dict(row) if row is not None else None

    async def version_disk_path(
        self, owner_id: int, path: str, version_no: int
    ) -> str | None:
        """On-disk path of a specific version's blob, for download."""
        row = await self._version_row(owner_id, path, version_no)
        if row is None:
            return None
        disk = self._version_disk_path(owner_id, row["disk_ref"])
        return disk if os.path.isfile(disk) else None

    async def restore_version(
        self, owner_id: int, path: str, version_no: int
    ) -> File | None:
        """Roll a file's contents back to an earlier version.

        The current bytes are snapshotted first (so the roll-back is itself
        reversible), then the chosen version's bytes become current and the
        metadata size/checksum/last_updated are updated.
        """
        normalized = normalize_path(path)
        current = await self.get_file(owner_id, normalized)
        if current is None or current.is_directory:
            return None
        row = await self._version_row(owner_id, normalized, version_no)
        if row is None:
            return None
        ver_disk = self._version_disk_path(owner_id, row["disk_ref"])
        if not os.path.isfile(ver_disk):
            return None

        # Preserve the current bytes as a new version before overwriting.
        await self.snapshot_version(owner_id, normalized)

        cur_disk = self._disk_path(owner_id, normalized)
        os.makedirs(os.path.dirname(cur_disk), exist_ok=True)
        shutil.copy2(ver_disk, cur_disk)

        now = datetime.now(timezone.utc).isoformat()
        async with self._connect() as db:
            await db.execute(
                f"UPDATE {self.TABLE_NAME} SET size = ?, checksum = ?, last_updated = ? "
                "WHERE owner_id = ? AND path = ?",
                (row["size"], row["checksum"], now, owner_id, normalized),
            )
            await db.commit()
        return await self.get_file(owner_id, normalized)

    async def _delete_versions(self, owner_id: int, path: str) -> None:
        """Remove all version rows and blobs for a path (and, if a folder,
        its descendants). Used when content is permanently purged."""
        normalized = normalize_path(path)
        async with self._connect() as db:
            cursor = await db.execute(
                "SELECT disk_ref FROM file_versions "
                "WHERE owner_id = ? AND (path = ? OR path LIKE ?)",
                (owner_id, normalized, f"{normalized}/%"),
            )
            refs = [r["disk_ref"] for r in await cursor.fetchall()]
            await db.execute(
                "DELETE FROM file_versions "
                "WHERE owner_id = ? AND (path = ? OR path LIKE ?)",
                (owner_id, normalized, f"{normalized}/%"),
            )
            await db.commit()
        for ref in refs:
            try:
                os.remove(self._version_disk_path(owner_id, ref))
            except FileNotFoundError:
                pass

    def resolve_disk_path(self, owner_id: int, path: str) -> str:
        """Public accessor for the on-disk path; used by download streaming."""
        return self._disk_path(owner_id, path)
