"""Tiny forward-only schema migration runner for the SQLite databases.

Pithos keeps two separate SQLite files — one for users, one for file
metadata — so each gets its own ordered migration list and its own
`schema_version` bookkeeping row.

Design notes
------------
- Migrations are forward-only. There is no `down` path; a mistake is fixed
  by adding a new migration, never by editing an applied one.
- The tables the app shipped with (the original inline ``CREATE TABLE``
  statements) are treated as the *baseline*. A database that already exists
  is assumed to be at ``baseline`` even though it has no ``schema_version``
  row yet, so we seed it there before applying anything newer. That keeps
  existing data (the Raspberry Pi's live disk) safe without a hand-migration.
- Each migration runs in its own transaction and is recorded atomically, so
  a crash mid-run leaves the DB at a clean, known version.
"""

from dataclasses import dataclass, field

import aiosqlite


@dataclass(frozen=True)
class Migration:
    """A single ordered schema change.

    ``statements`` run in order inside one transaction. Keep each migration
    idempotent-friendly (``IF NOT EXISTS`` where the engine allows) so a
    partially-applied database can be re-run without exploding.
    """

    version: int
    name: str
    statements: list[str] = field(default_factory=list)


async def _current_version(db: aiosqlite.Connection) -> int:
    await db.execute(
        "CREATE TABLE IF NOT EXISTS schema_version ("
        "  version INTEGER NOT NULL,"
        "  applied_at TEXT NOT NULL DEFAULT (datetime('now'))"
        ")"
    )
    cursor = await db.execute("SELECT COALESCE(MAX(version), -1) AS v FROM schema_version")
    row = await cursor.fetchone()
    return int(row["v"]) if row is not None else -1


async def apply_migrations(
    db_path: str,
    migrations: list[Migration],
    *,
    baseline: int = 0,
) -> int:
    """Bring ``db_path`` up to the highest version in ``migrations``.

    ``baseline`` is the version represented by the tables that already exist
    from the app's original inline schema. A brand-new database and a
    pre-migrations database both get seeded to ``baseline`` first, then any
    migration with ``version > baseline`` is applied in order.

    Returns the version the database is at after running.
    """
    ordered = sorted(migrations, key=lambda m: m.version)
    async with aiosqlite.connect(db_path) as db:
        db.row_factory = aiosqlite.Row
        # Foreign keys are per-connection in SQLite; enable so any FK we add
        # is actually enforced during migration.
        await db.execute("PRAGMA foreign_keys = ON")

        current = await _current_version(db)
        if current < baseline:
            await db.execute(
                "INSERT INTO schema_version (version) VALUES (?)", (baseline,)
            )
            await db.commit()
            current = baseline

        for migration in ordered:
            if migration.version <= current:
                continue
            try:
                for statement in migration.statements:
                    await db.execute(statement)
                await db.execute(
                    "INSERT INTO schema_version (version) VALUES (?)",
                    (migration.version,),
                )
                await db.commit()
            except Exception:
                await db.rollback()
                raise
            current = migration.version

        return current
