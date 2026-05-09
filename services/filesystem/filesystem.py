from models.file import File
from services.filesystem.filesystem_metadata_processor import FilesystemMetadataProcessor

class Filesystem:
    """
      Manages file storage operations on a physical path

      Handles adding, retrieving, updating, removing, and listing files,
    along with their associated metadata.
    """
    def __init__(self, physical_path: str = None):
        self._physical_path = physical_path
        self._processor = FilesystemMetadataProcessor(physical_path)

    async def initialize(self):
        await self._processor.initalizeDatabase(self._physical_path)

    async def add_file(self, file: File, raw_bytes: bytes = None):
        await self._processor.add_file(file, raw_bytes)

    async def get_file(self, path: str):
        return await self._processor.get_file(path)

    async def remove_file(self, file: File):
        await self._processor.remove_file(file)

    async def update_file(self, file: File):
        await self._processor.update_file(file)

    async def list_files(self, path: str = None):
        return await self._processor.list_files(path)



      
      
