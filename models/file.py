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