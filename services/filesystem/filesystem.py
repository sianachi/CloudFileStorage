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

    async def add_file_stream(self, file: File, owner_id: int, src):
        return await self._processor.add_file_stream(file, owner_id, src)

    async def add_file_from_disk(self, file: File, owner_id: int, src_disk_path: str):
        return await self._processor.add_file_from_disk(file, owner_id, src_disk_path)

    async def get_file(self, owner_id: int, path: str):
        return await self._processor.get_file(owner_id, path)

    async def remove_file(self, file: File, owner_id: int):
        await self._processor.remove_file(file, owner_id)

    async def soft_delete(self, file: File, owner_id: int):
        await self._processor.soft_delete(file, owner_id)

    async def list_trash(self, owner_id: int):
        return await self._processor.list_trash(owner_id)

    async def restore(self, owner_id: int, trash_path: str):
        return await self._processor.restore(owner_id, trash_path)

    async def purge(self, owner_id: int, trash_path: str):
        return await self._processor.purge(owner_id, trash_path)

    async def empty_trash(self, owner_id: int):
        return await self._processor.empty_trash(owner_id)

    async def snapshot_version(self, owner_id: int, path: str):
        await self._processor.snapshot_version(owner_id, path)

    async def list_versions(self, owner_id: int, path: str):
        return await self._processor.list_versions(owner_id, path)

    async def version_disk_path(self, owner_id: int, path: str, version_no: int):
        return await self._processor.version_disk_path(owner_id, path, version_no)

    async def restore_version(self, owner_id: int, path: str, version_no: int):
        return await self._processor.restore_version(owner_id, path, version_no)

    async def update_file(self, file: File, owner_id: int):
        await self._processor.update_file(file, owner_id)

    async def list_children(self, owner_id: int, parent_path: str):
        return await self._processor.list_children(owner_id, parent_path)

    async def search(self, owner_id: int, query: str, limit: int = 100):
        return await self._processor.search(owner_id, query, limit)

    async def set_favorite(self, owner_id: int, path: str, favorite: bool):
        return await self._processor.set_favorite(owner_id, path, favorite)

    async def list_favorites(self, owner_id: int):
        return await self._processor.list_favorites(owner_id)

    async def list_recent(self, owner_id: int, limit: int = 50):
        return await self._processor.list_recent(owner_id, limit)

    async def rename(self, owner_id: int, old_path: str, new_name: str):
        return await self._processor.rename(owner_id, old_path, new_name)

    async def move(self, owner_id: int, source: str, destination_parent: str):
        return await self._processor.move(owner_id, source, destination_parent)

    async def bytes_used(self, owner_id: int) -> int:
        return await self._processor.bytes_used(owner_id)

    def resolve_disk_path(self, owner_id: int, path: str) -> str:
        return self._processor.resolve_disk_path(owner_id, path)
