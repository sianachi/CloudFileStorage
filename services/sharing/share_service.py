"""Access-control storage for shared entries.

A *share* grants access to one entry owned by one user. Two kinds:

- **user share** — ``shared_with_user_id`` set: a specific account gets access.
- **link share** — ``public_token`` set: anyone with the link gets access.

When the shared entry is a folder, the grant extends to the whole subtree
beneath it. Roles are ``read`` or ``write``; ``write`` implies ``read``.

The shares table lives in the same SQLite file as file metadata (created by
METADATA_MIGRATIONS v4), so this service just reads and writes rows — the
migration runner owns the schema.
"""

import os
import secrets
from datetime import datetime, timezone

from const import Constants
from services.sqlite_service import SQLiteService

VALID_ROLES = ("read", "write")


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


class ShareService(SQLiteService):
    def __init__(self, physical_path: str = None):
        base_path = physical_path or ""
        super().__init__(os.path.join(base_path, Constants.METADATA_TABLE_NAME))

    async def create_user_share(
        self,
        *,
        owner_id: int,
        entry_path: str,
        is_directory: bool,
        target_user_id: int,
        role: str,
        expires_at: str | None,
    ) -> dict:
        async with self._connect() as db:
            cursor = await db.execute(
                "INSERT INTO shares "
                "(owner_id, entry_path, is_directory, shared_with_user_id, role, "
                " public_token, created_at, expires_at) "
                "VALUES (?, ?, ?, ?, ?, NULL, ?, ?)",
                (
                    owner_id,
                    entry_path,
                    int(is_directory),
                    target_user_id,
                    role,
                    _now_iso(),
                    expires_at,
                ),
            )
            await db.commit()
            share_id = cursor.lastrowid
        return await self.get_share(share_id)

    async def create_link_share(
        self,
        *,
        owner_id: int,
        entry_path: str,
        is_directory: bool,
        role: str,
        expires_at: str | None,
    ) -> dict:
        token = secrets.token_urlsafe(24)
        async with self._connect() as db:
            cursor = await db.execute(
                "INSERT INTO shares "
                "(owner_id, entry_path, is_directory, shared_with_user_id, role, "
                " public_token, created_at, expires_at) "
                "VALUES (?, ?, ?, NULL, ?, ?, ?, ?)",
                (
                    owner_id,
                    entry_path,
                    int(is_directory),
                    role,
                    token,
                    _now_iso(),
                    expires_at,
                ),
            )
            await db.commit()
            share_id = cursor.lastrowid
        return await self.get_share(share_id)

    async def get_share(self, share_id: int) -> dict | None:
        async with self._connect() as db:
            cursor = await db.execute("SELECT * FROM shares WHERE id = ?", (share_id,))
            row = await cursor.fetchone()
            return dict(row) if row is not None else None

    async def get_by_token(self, token: str) -> dict | None:
        async with self._connect() as db:
            cursor = await db.execute(
                "SELECT * FROM shares WHERE public_token = ?", (token,)
            )
            row = await cursor.fetchone()
            return dict(row) if row is not None else None

    async def list_owned(self, owner_id: int) -> list[dict]:
        async with self._connect() as db:
            cursor = await db.execute(
                "SELECT * FROM shares WHERE owner_id = ? ORDER BY created_at DESC",
                (owner_id,),
            )
            return [dict(r) for r in await cursor.fetchall()]

    async def list_shared_with(self, user_id: int) -> list[dict]:
        async with self._connect() as db:
            cursor = await db.execute(
                "SELECT * FROM shares WHERE shared_with_user_id = ? "
                "ORDER BY created_at DESC",
                (user_id,),
            )
            return [dict(r) for r in await cursor.fetchall()]

    async def revoke(self, owner_id: int, share_id: int) -> bool:
        """Delete a share the caller owns. Returns False if not theirs."""
        async with self._connect() as db:
            cursor = await db.execute(
                "DELETE FROM shares WHERE id = ? AND owner_id = ?",
                (share_id, owner_id),
            )
            await db.commit()
            return cursor.rowcount > 0

    @staticmethod
    def is_expired(share: dict) -> bool:
        expires_at = share.get("expires_at")
        if not expires_at:
            return False
        try:
            return datetime.fromisoformat(expires_at) <= datetime.now(timezone.utc)
        except ValueError:
            # Unparseable expiry → treat as expired rather than fail open.
            return True
