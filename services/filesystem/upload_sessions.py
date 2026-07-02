"""In-memory session tracking for resumable chunked uploads.

A client that wants to upload a large file (or survive a dropped connection)
opens a session, appends byte ranges to a temp ``.part`` file, and finalizes
when done. If the connection drops it can query how many bytes the server
already has and resume from there.

State is in-memory, so it is per-process — fine for the single-worker
deployment Pithos targets. A multi-worker deployment would need a shared
store and sticky routing (or object storage with native multipart uploads).
"""

import os
import secrets
from dataclasses import dataclass


@dataclass
class UploadSession:
    upload_id: str
    owner_id: int
    parent: str
    name: str
    declared_size: int
    tmp_path: str

    @property
    def received(self) -> int:
        try:
            return os.path.getsize(self.tmp_path)
        except FileNotFoundError:
            return 0


class UploadSessionManager:
    def __init__(self, storage_root: str):
        self._root = storage_root
        self._sessions: dict[str, UploadSession] = {}

    def _tmp_path(self, owner_id: int, upload_id: str) -> str:
        return os.path.join(
            self._root, str(owner_id), ".uploads", f"{upload_id}.part"
        )

    def create(
        self, owner_id: int, parent: str, name: str, declared_size: int
    ) -> UploadSession:
        upload_id = secrets.token_urlsafe(16)
        tmp_path = self._tmp_path(owner_id, upload_id)
        os.makedirs(os.path.dirname(tmp_path), exist_ok=True)
        # Create the empty part file so `received` reports 0 immediately.
        with open(tmp_path, "wb"):
            pass
        session = UploadSession(
            upload_id=upload_id,
            owner_id=owner_id,
            parent=parent,
            name=name,
            declared_size=declared_size,
            tmp_path=tmp_path,
        )
        self._sessions[upload_id] = session
        return session

    def get(self, upload_id: str, owner_id: int) -> UploadSession | None:
        session = self._sessions.get(upload_id)
        if session is None or session.owner_id != owner_id:
            return None
        return session

    def append(self, session: UploadSession, offset: int, data: bytes) -> int:
        """Append ``data`` at ``offset``. The offset must equal the bytes
        already received (no gaps, no overwrites) — this is what makes resume
        deterministic. Returns the new received size."""
        current = session.received
        if offset != current:
            raise ValueError(f"expected offset {current}, got {offset}")
        with open(session.tmp_path, "ab") as f:
            f.write(data)
        return session.received

    def discard(self, session: UploadSession) -> None:
        self._sessions.pop(session.upload_id, None)
        try:
            os.remove(session.tmp_path)
        except FileNotFoundError:
            pass

    def finalize_path(self, session: UploadSession) -> str:
        """Remove the session bookkeeping and return the temp path so the
        caller can adopt its bytes as the final file."""
        self._sessions.pop(session.upload_id, None)
        return session.tmp_path
