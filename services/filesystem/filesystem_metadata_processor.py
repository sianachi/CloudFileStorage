import os
import shutil
from datetime import datetime
from const import Constants

from models.file import File
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


def _row_to_file(row) -> File:
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

    def _disk_path(self, owner_id: int, path: str) -> str:
        normalized = normalize_path(path).lstrip("/")
        return os.path.join(self.__physical_path, str(owner_id), normalized)

    async def add_file(self, file: File, owner_id: int, raw_bytes: bytes | None = None):
        normalized = normalize_path(file.path)
        parent = parent_of(normalized)
        disk_path = self._disk_path(owner_id, normalized)

        async with self._connect() as db:
            await db.execute(
                f"INSERT INTO {self.TABLE_NAME} "
                "(owner_id, name, path, parent_path, size, creation_date, last_updated, is_directory) "
                "VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
                (
                    owner_id,
                    file.name,
                    normalized,
                    parent,
                    file.size,
                    _dt_to_sql(file.creation_date),
                    _dt_to_sql(file.last_updated),
                    int(file.is_directory),
                ),
            )
            await db.commit()
        if file.is_directory:
            os.makedirs(disk_path, exist_ok=True)
        elif raw_bytes is not None:
            os.makedirs(os.path.dirname(disk_path), exist_ok=True)
            with open(disk_path, "wb") as f:
                f.write(raw_bytes)

    async def get_file(self, owner_id: int, path: str) -> File | None:
        normalized = normalize_path(path)
        async with self._connect() as db:
            cursor = await db.execute(
                f"SELECT * FROM {self.TABLE_NAME} WHERE owner_id = ? AND path = ?",
                (owner_id, normalized),
            )
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
                "WHERE owner_id = ? AND parent_path = ? "
                "ORDER BY is_directory DESC, name COLLATE NOCASE",
                (owner_id, normalized),
            )
            rows = await cursor.fetchall()
            return [_row_to_file(row) for row in rows]

    async def bytes_used(self, owner_id: int) -> int:
        async with self._connect() as db:
            cursor = await db.execute(
                f"SELECT COALESCE(SUM(size), 0) AS total FROM {self.TABLE_NAME} "
                "WHERE owner_id = ? AND is_directory = 0",
                (owner_id,),
            )
            row = await cursor.fetchone()
            return int(row["total"]) if row else 0

    def resolve_disk_path(self, owner_id: int, path: str) -> str:
        """Public accessor for the on-disk path; used by download streaming."""
        return self._disk_path(owner_id, path)
