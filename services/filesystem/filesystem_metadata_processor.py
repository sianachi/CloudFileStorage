import hashlib
import os
import secrets
import shutil
from datetime import datetime, timezone
from const import Constants

# Trashed entries are relocated under this synthetic prefix. It is never a
# real metadata row and never a valid user path (see _safe_user_path, which
# rejects the leading-dot ".." but this uses a full "/.trash/<id>" segment
# that the app itself controls), so it can't collide with user content.
TRASH_PREFIX = "/.trash"

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

        old_prefix_len = len(old_normalized)
        async with self._connect() as db:
            if existing.is_directory:
                # Update self.
                await db.execute(
                    f"UPDATE {self.TABLE_NAME} SET path = ?, name = ? "
                    "WHERE owner_id = ? AND path = ?",
                    (new_normalized, new_name, owner_id, old_normalized),
                )
                # Update every descendant: substitute the old prefix with
                # the new one in both `path` and `parent_path`. SUBSTR is
                # 1-indexed, so we skip past `old_prefix_len` characters.
                await db.execute(
                    f"UPDATE {self.TABLE_NAME} SET "
                    "path = ? || SUBSTR(path, ?), "
                    "parent_path = ? || SUBSTR(parent_path, ?) "
                    "WHERE owner_id = ? AND path LIKE ?",
                    (
                        new_normalized,
                        old_prefix_len + 1,
                        new_normalized,
                        old_prefix_len + 1,
                        owner_id,
                        old_normalized + "/%",
                    ),
                )
            else:
                await db.execute(
                    f"UPDATE {self.TABLE_NAME} SET path = ?, name = ? "
                    "WHERE owner_id = ? AND path = ?",
                    (new_normalized, new_name, owner_id, old_normalized),
                )
            await db.commit()

        old_disk = self._disk_path(owner_id, old_normalized)
        new_disk = self._disk_path(owner_id, new_normalized)
        if os.path.exists(old_disk):
            os.makedirs(os.path.dirname(new_disk), exist_ok=True)
            os.rename(old_disk, new_disk)

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

    def resolve_disk_path(self, owner_id: int, path: str) -> str:
        """Public accessor for the on-disk path; used by download streaming."""
        return self._disk_path(owner_id, path)
