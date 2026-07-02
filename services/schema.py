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
]
