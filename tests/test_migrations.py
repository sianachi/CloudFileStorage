import aiosqlite
import pytest

from services.migrations import Migration, apply_migrations


@pytest.mark.asyncio
async def test_seeds_baseline_then_applies(tmp_path):
    db_path = str(tmp_path / "t.db")
    migrations = [
        Migration(1, "add_widgets", ["CREATE TABLE widgets (id INTEGER PRIMARY KEY)"]),
        Migration(2, "add_col", ["ALTER TABLE widgets ADD COLUMN label TEXT"]),
    ]

    version = await apply_migrations(db_path, migrations, baseline=0)
    assert version == 2

    async with aiosqlite.connect(db_path) as db:
        db.row_factory = aiosqlite.Row
        cur = await db.execute("PRAGMA table_info(widgets)")
        cols = {row["name"] for row in await cur.fetchall()}
    assert cols == {"id", "label"}


@pytest.mark.asyncio
async def test_is_idempotent(tmp_path):
    db_path = str(tmp_path / "t.db")
    migrations = [
        Migration(1, "add_widgets", ["CREATE TABLE widgets (id INTEGER PRIMARY KEY)"]),
    ]
    assert await apply_migrations(db_path, migrations, baseline=0) == 1
    # Running again must be a no-op, not an error (table already exists).
    assert await apply_migrations(db_path, migrations, baseline=0) == 1


@pytest.mark.asyncio
async def test_existing_db_seeded_to_baseline_skips_old(tmp_path):
    """A DB that already has the baseline tables must not re-run baseline-era
    migrations — it is seeded straight to the baseline version."""
    db_path = str(tmp_path / "t.db")
    # Simulate a pre-migrations database: the table exists, no schema_version.
    async with aiosqlite.connect(db_path) as db:
        await db.execute("CREATE TABLE legacy (id INTEGER PRIMARY KEY)")
        await db.commit()

    # Migration 1 is "part of the baseline" (version <= baseline) and would
    # collide with the existing table if it ran. It must be skipped.
    migrations = [
        Migration(1, "would_collide", ["CREATE TABLE legacy (id INTEGER PRIMARY KEY)"]),
        Migration(2, "real_change", ["CREATE TABLE fresh (id INTEGER PRIMARY KEY)"]),
    ]
    version = await apply_migrations(db_path, migrations, baseline=1)
    assert version == 2

    async with aiosqlite.connect(db_path) as db:
        db.row_factory = aiosqlite.Row
        cur = await db.execute(
            "SELECT name FROM sqlite_master WHERE type='table' AND name IN ('legacy','fresh')"
        )
        names = {row["name"] for row in await cur.fetchall()}
    assert names == {"legacy", "fresh"}
