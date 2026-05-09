from datetime import datetime

import pytest

from models.file import File
from services.filesystem import Filesystem


@pytest.mark.asyncio
async def test_add_and_get_file(tmp_path):
    root = str(tmp_path)
    filesystem = Filesystem(root)
    await filesystem.initialize()

    owner_id = 1
    test_file = File(
        name="document.pdf",
        path="/document.pdf",
        size=2048,
        creation_date=datetime.now(),
        last_updated=datetime.now(),
    )

    await filesystem.add_file(test_file, owner_id, raw_bytes=b"hello world")

    retrieved = await filesystem.get_file(owner_id, "/document.pdf")
    assert retrieved is not None
    assert retrieved.name == "document.pdf"
    assert retrieved.size == 2048
    assert retrieved.path == "/document.pdf"


@pytest.mark.asyncio
async def test_files_isolated_per_owner(tmp_path):
    root = str(tmp_path)
    filesystem = Filesystem(root)
    await filesystem.initialize()

    same_path = "/notes.txt"
    now = datetime.now()
    await filesystem.add_file(
        File(name="notes.txt", path=same_path, size=5, creation_date=now, last_updated=now),
        owner_id=1,
        raw_bytes=b"alice",
    )
    await filesystem.add_file(
        File(name="notes.txt", path=same_path, size=3, creation_date=now, last_updated=now),
        owner_id=2,
        raw_bytes=b"bob",
    )

    a = await filesystem.get_file(1, same_path)
    b = await filesystem.get_file(2, same_path)
    assert a is not None and a.size == 5
    assert b is not None and b.size == 3
