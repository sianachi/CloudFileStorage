from contextlib import asynccontextmanager

import aiosqlite


class SQLiteService:
    def __init__(self, db_path: str):
        self._db_path = db_path

    @asynccontextmanager
    async def _connect(self):
        async with aiosqlite.connect(self._db_path) as db:
            db.row_factory = aiosqlite.Row
            yield db

    async def ensure_table(self, create_table_sql: str):
        async with self._connect() as db:
            await db.execute(create_table_sql)
            await db.commit()
