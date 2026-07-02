import hashlib
import io

import pytest
from fastapi.testclient import TestClient

VALID_PASSWORD = "validPass1234"


@pytest.fixture
def client(monkeypatch, tmp_path):
    monkeypatch.setenv("STORAGE_ROOT", str(tmp_path))
    from main import create_app

    app = create_app()
    with TestClient(app) as test_client:
        yield test_client


def _auth(client, username):
    client.post("/auth/register", json={"username": username, "password": VALID_PASSWORD})
    r = client.post("/auth/login", json={"username": username, "password": VALID_PASSWORD})
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


def test_upload_records_sha256(client):
    h = _auth(client, "alice")
    payload = b"integrity matters"
    r = client.post(
        "/files",
        params={"parent": "/"},
        headers=h,
        files={"upload": ("f.bin", io.BytesIO(payload), "application/octet-stream")},
    )
    assert r.status_code == 200
    assert r.json()["checksum"] == hashlib.sha256(payload).hexdigest()


def test_verify_ok_for_intact_file(client):
    h = _auth(client, "bob")
    client.post(
        "/files",
        params={"parent": "/"},
        headers=h,
        files={"upload": ("f.txt", io.BytesIO(b"hello"), "text/plain")},
    )
    r = client.get("/files/verify", params={"path": "/f.txt"}, headers=h)
    assert r.status_code == 200
    body = r.json()
    assert body["ok"] is True
    assert body["stored_checksum"] == body["computed_checksum"]


def test_verify_detects_corruption(client, tmp_path):
    h = _auth(client, "carol")
    client.post(
        "/files",
        params={"parent": "/"},
        headers=h,
        files={"upload": ("data.txt", io.BytesIO(b"original"), "text/plain")},
    )
    # First registered user gets owner_id 1; tamper with the bytes on disk.
    disk = tmp_path / "1" / "data.txt"
    disk.write_bytes(b"tampered!")

    r = client.get("/files/verify", params={"path": "/data.txt"}, headers=h)
    body = r.json()
    assert body["ok"] is False
    assert body["stored_checksum"] != body["computed_checksum"]
