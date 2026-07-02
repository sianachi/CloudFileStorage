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
USERS_MIGRATIONS: list[Migration] = []


# --- file metadata database ----------------------------------------------
METADATA_MIGRATIONS: list[Migration] = []
