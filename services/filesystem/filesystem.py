from models.file import File
from services.filesystem.filesystem_metadata_processor import FilesystemMetadataProcessor


class Filesystem:
    """
    Manages per-user file storage on a physical path.

    Every operation is scoped to an owner_id; rows in metadata are partitioned
    on (owner_id, path), and bytes live under {physical_path}/{owner_id}/...
    """

    def __init__(self, physical_path: str = None):
        self._physical_path = physical_path
        self._processor = FilesystemMetadataProcessor(physical_path)

    async def initialize(self):
        await self._processor.initalizeDatabase(self._physical_path)

    async def add_file(self, file: File, owner_id: int, raw_bytes: bytes | None = None):
        await self._processor.add_file(file, owner_id, raw_bytes)

    async def get_file(self, owner_id: int, path: str):
        return await self._processor.get_file(owner_id, path)

    async def remove_file(self, file: File, owner_id: int):
        await self._processor.remove_file(file, owner_id)

    async def update_file(self, file: File, owner_id: int):
        await self._processor.update_file(file, owner_id)

    async def list_children(self, owner_id: int, parent_path: str):
        return await self._processor.list_children(owner_id, parent_path)

    async def rename(self, owner_id: int, old_path: str, new_name: str):
        return await self._processor.rename(owner_id, old_path, new_name)

    async def bytes_used(self, owner_id: int) -> int:
        return await self._processor.bytes_used(owner_id)

    def resolve_disk_path(self, owner_id: int, path: str) -> str:
        return self._processor.resolve_disk_path(owner_id, path)
