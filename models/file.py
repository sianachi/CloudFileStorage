from dataclasses import dataclass
from datetime import datetime

@dataclass
class File:
    name: str
    size: int
    path: str
    is_directory: bool = False
    creation_date: datetime
    last_updated: datetime