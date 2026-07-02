"""Ordered schema migrations for each SQLite database.

The *baseline* (version 0) is the schema created by the original inline
``CREATE TABLE`` statements in ``AuthManagement`` and
``FilesystemMetadataProcessor``. Every change since is appended here as a
new ``Migration`` with the next integer version. Never edit an applied
migration — add a new one.
"""

from services.migrations import Migration

# Version 0 == the app's original inline tables. Live databases created
# before migrations existed are seeded to this version automatically.
BASELINE_VERSION = 0


# --- users database -------------------------------------------------------
USERS_MIGRATIONS: list[Migration] = [
    # v1: Pithos no longer collects email addresses — accounts are
    # username + password only. Drop the column so no email data is stored.
    Migration(
        version=1,
        name="drop_email",
        statements=["ALTER TABLE users DROP COLUMN email"],
    ),
]


# --- file metadata database ----------------------------------------------
METADATA_MIGRATIONS: list[Migration] = [
    # v1: soft-delete / trash. Deleted entries are relocated into a hidden
    # /.trash/{id} namespace with the original location recorded so they can
    # be restored. deleted_at doubles as the "is trashed" flag.
    Migration(
        version=1,
        name="add_trash_columns",
        statements=[
            "ALTER TABLE metadata ADD COLUMN deleted_at TEXT",
            "ALTER TABLE metadata ADD COLUMN original_path TEXT",
            "CREATE INDEX IF NOT EXISTS idx_metadata_deleted "
            "ON metadata (owner_id, deleted_at)",
        ],
    ),
    # v2: store a SHA-256 of each file's bytes for integrity verification.
    Migration(
        version=2,
        name="add_checksum",
        statements=["ALTER TABLE metadata ADD COLUMN checksum TEXT"],
    ),
    # v3: file version history. Each overwrite snapshots the prior bytes into
    # a hidden .versions store; disk_ref names the blob on disk.
    Migration(
        version=3,
        name="add_file_versions",
        statements=[
            """
            CREATE TABLE IF NOT EXISTS file_versions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                owner_id INTEGER NOT NULL,
                path TEXT NOT NULL,
                version_no INTEGER NOT NULL,
                size INTEGER NOT NULL,
                checksum TEXT,
                disk_ref TEXT NOT NULL,
                created_at TEXT NOT NULL
            )
            """,
            "CREATE INDEX IF NOT EXISTS idx_versions_owner_path "
            "ON file_versions (owner_id, path, version_no)",
        ],
    ),
    # v4: sharing / permissions. A share grants a target user (or, via a
    # public_token, anyone with the link) access to an entry — and, when the
    # entry is a folder, to its whole subtree — with a read or write role.
    Migration(
        version=4,
        name="add_shares",
        statements=[
            """
            CREATE TABLE IF NOT EXISTS shares (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                owner_id INTEGER NOT NULL,
                entry_path TEXT NOT NULL,
                is_directory INTEGER NOT NULL,
                shared_with_user_id INTEGER,
                role TEXT NOT NULL,
                public_token TEXT,
                created_at TEXT NOT NULL,
                expires_at TEXT
            )
            """,
            "CREATE UNIQUE INDEX IF NOT EXISTS idx_shares_token "
            "ON shares (public_token)",
            "CREATE INDEX IF NOT EXISTS idx_shares_with_user "
            "ON shares (shared_with_user_id)",
            "CREATE INDEX IF NOT EXISTS idx_shares_owner "
            "ON shares (owner_id)",
        ],
    ),
]
