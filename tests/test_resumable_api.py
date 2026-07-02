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


def test_streamed_small_upload_still_records_checksum(client):
    h = _auth(client, "alice")
    payload = b"streamed bytes"
    r = client.post(
        "/files",
        params={"parent": "/"},
        headers=h,
        files={"upload": ("s.txt", io.BytesIO(payload), "text/plain")},
    )
    assert r.status_code == 200
    assert r.json()["checksum"] == hashlib.sha256(payload).hexdigest()
    assert r.json()["size"] == len(payload)


def test_resumable_upload_in_chunks(client):
    h = _auth(client, "bob")
    data = b"0123456789" * 50  # 500 bytes
    init = client.post(
        "/files/upload/init",
        headers=h,
        json={"parent": "/", "name": "big.bin", "size": len(data)},
    ).json()
    uid = init["upload_id"]
    assert init["received"] == 0

    # Upload in two chunks.
    mid = 200
    r1 = client.put(
        "/files/upload/chunk",
        params={"upload_id": uid, "offset": 0},
        headers=h,
        content=data[:mid],
    )
    assert r1.json()["received"] == mid
    r2 = client.put(
        "/files/upload/chunk",
        params={"upload_id": uid, "offset": mid},
        headers=h,
        content=data[mid:],
    )
    assert r2.json()["received"] == len(data)

    done = client.post(
        "/files/upload/complete", headers=h, json={"upload_id": uid}
    )
    assert done.status_code == 200, done.text
    assert done.json()["checksum"] == hashlib.sha256(data).hexdigest()

    dl = client.get("/files/download", params={"path": "/big.bin"}, headers=h)
    assert dl.content == data


def test_resume_after_checking_status(client):
    h = _auth(client, "carol")
    data = b"abcdefgh" * 10  # 80 bytes
    uid = client.post(
        "/files/upload/init",
        headers=h,
        json={"parent": "/", "name": "r.bin", "size": len(data)},
    ).json()["upload_id"]

    client.put(
        "/files/upload/chunk",
        params={"upload_id": uid, "offset": 0},
        headers=h,
        content=data[:30],
    )
    # Simulate a reconnect: ask how much the server has.
    status = client.get(
        "/files/upload/status", params={"upload_id": uid}, headers=h
    ).json()
    assert status["received"] == 30

    client.put(
        "/files/upload/chunk",
        params={"upload_id": uid, "offset": status["received"]},
        headers=h,
        content=data[30:],
    )
    done = client.post("/files/upload/complete", headers=h, json={"upload_id": uid})
    assert done.status_code == 200
    dl = client.get("/files/download", params={"path": "/r.bin"}, headers=h)
    assert dl.content == data


def test_offset_mismatch_conflicts(client):
    h = _auth(client, "dave")
    uid = client.post(
        "/files/upload/init",
        headers=h,
        json={"parent": "/", "name": "x.bin", "size": 10},
    ).json()["upload_id"]
    client.put(
        "/files/upload/chunk",
        params={"upload_id": uid, "offset": 0},
        headers=h,
        content=b"12345",
    )
    # Wrong offset (should be 5).
    bad = client.put(
        "/files/upload/chunk",
        params={"upload_id": uid, "offset": 0},
        headers=h,
        content=b"67890",
    )
    assert bad.status_code == 409


def test_abort_removes_session(client):
    h = _auth(client, "erin")
    uid = client.post(
        "/files/upload/init",
        headers=h,
        json={"parent": "/", "name": "a.bin", "size": 5},
    ).json()["upload_id"]
    assert client.delete("/files/upload", params={"upload_id": uid}, headers=h).status_code == 200
    # Session is gone.
    assert client.get("/files/upload/status", params={"upload_id": uid}, headers=h).status_code == 404
