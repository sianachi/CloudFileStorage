from dataclasses import dataclass
from datetime import datetime

@dataclass
class File:
    name: str
    size: int
    path: str
    creation_date: datetime
    last_updated: datetime
    is_directory: bool = False
    # SHA-256 hex digest of the file's bytes; None for directories.
    checksum: str | None = None