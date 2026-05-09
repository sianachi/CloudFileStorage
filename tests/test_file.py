from datetime import datetime

import pytest

from models.file import File
from services.filesystem import Filesystem


@pytest.mark.asyncio
async def test_add_and_get_file(tmp_path):
    root = str(tmp_path)
    filesystem = Filesystem(root)
    await filesystem.initialize()

    logical_path = "document.pdf"
    test_file = File(
        name="document.pdf",
        path=logical_path,
        size=2048,
        creation_date=datetime.now(),
        last_updated=datetime.now(),
    )

    await filesystem.add_file(test_file, raw_bytes=b"hello world")

    retrieved = await filesystem.get_file(logical_path)
    assert retrieved is not None
    assert retrieved.name == "document.pdf"
    assert retrieved.size == 2048
    assert retrieved.path == logical_path
