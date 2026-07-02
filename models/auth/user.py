from datetime import datetime
from dataclasses import dataclass

@dataclass
class User:
    id: int
    username: str
    password_hash: str
    created_at: datetime = datetime.now()
    updated_at: datetime = datetime.now()