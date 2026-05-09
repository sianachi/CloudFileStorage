import os
from datetime import datetime
from const import Constants

from models.file import File
from services.sqlite_service import SQLiteService


def _dt_to_sql(value: datetime | str) -> str:
    """Store datetimes as ISO text so SQLite does not use deprecated datetime adapters."""
    if isinstance(value, datetime):
        return value.isoformat()
    return value


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
                name TEXT NOT NULL,
                path TEXT PRIMARY KEY,
                size INTEGER NOT NULL,
                creation_date TEXT NOT NULL,
                last_updated TEXT NOT NULL,
                is_directory INTEGER NOT NULL
            )
        """
        )

    def resolver(self, path: str) -> str:
        normalized_path = path.lstrip("/\\")
        return os.path.join(self.__physical_path, normalized_path)

    async def add_file(self, file: File, raw_bytes: bytes = None):
        resolved_path = self.resolver(file.path)

        async with self._connect() as db:
            await db.execute(
                f"INSERT INTO {self.TABLE_NAME} "
                "(name, path, size, creation_date, last_updated, is_directory) "
                "VALUES (?, ?, ?, ?, ?, ?)",
                (
                    file.name,
                    file.path,
                    file.size,
                    _dt_to_sql(file.creation_date),
                    _dt_to_sql(file.last_updated),
                    int(file.is_directory),
                ),
            )
            await db.commit()
        if not file.is_directory and raw_bytes is not None:
            os.makedirs(os.path.dirname(resolved_path), exist_ok=True)
            with open(resolved_path, "wb") as f:
                f.write(raw_bytes)

    async def get_file(self, path: str):
        async with self._connect() as db:
            cursor = await db.execute(
                f"SELECT * FROM {self.TABLE_NAME} WHERE path = ?",
                (path,),
            )
            row = await cursor.fetchone()
            if row is None:
                return None
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

    async def remove_file(self, file: File):
        async with self._connect() as db:
            await db.execute(
                f"DELETE FROM {self.TABLE_NAME} WHERE path = ?",
                (file.path,),
            )
            await db.commit()

        if not file.is_directory:
            try:
                os.remove(self.resolver(file.path))
            except FileNotFoundError:
                pass

    async def update_file(self, file: File):
        async with self._connect() as db:
            await db.execute(
                f"UPDATE {self.TABLE_NAME} SET "
                "name = ?, size = ?, creation_date = ?, last_updated = ?, is_directory = ? "
                "WHERE path = ?",
                (
                    file.name,
                    file.size,
                    _dt_to_sql(file.creation_date),
                    _dt_to_sql(file.last_updated),
                    int(file.is_directory),
                    file.path,
                ),
            )
            await db.commit()

    async def list_files(self, path: str = None):
        async with self._connect() as db:
            if path is None:
                cursor = await db.execute(
                    f"SELECT name, path, size, creation_date, last_updated, is_directory FROM {self.TABLE_NAME}"
                )
            else:
                cursor = await db.execute(
                    f"SELECT name, path, size, creation_date, last_updated, is_directory FROM {self.TABLE_NAME} WHERE path LIKE ?",
                    (path + "%",),
                )
            rows = await cursor.fetchall()
            return [
                File(
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
                for row in rows
            ]
