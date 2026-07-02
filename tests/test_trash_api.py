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


def _auth(client: TestClient, username: str) -> dict:
    client.post(
        "/auth/register", json={"username": username, "password": VALID_PASSWORD}
    )
    r = client.post(
        "/auth/login", json={"username": username, "password": VALID_PASSWORD}
    )
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


def _upload(client, headers, name, data=b"data", parent="/"):
    return client.post(
        "/files",
        params={"parent": parent},
        headers=headers,
        files={"upload": (name, io.BytesIO(data), "text/plain")},
    )


def test_delete_moves_to_trash_and_hides_from_listing(client):
    h = _auth(client, "alice")
    _upload(client, h, "a.txt")

    d = client.delete("/files", params={"path": "/a.txt"}, headers=h)
    assert d.status_code == 200
    assert d.json()["message"] == "moved to trash"

    listing = client.get("/files", params={"path": "/"}, headers=h).json()
    assert [e["name"] for e in listing["entries"]] == []

    trash = client.get("/trash", headers=h).json()["entries"]
    assert len(trash) == 1
    assert trash[0]["name"] == "a.txt"
    assert trash[0]["original_path"] == "/a.txt"


def test_delete_excludes_from_quota(client):
    h = _auth(client, "bob")
    _upload(client, h, "big.bin", data=b"x" * 100)
    assert client.get("/quota", headers=h).json()["bytes_used"] == 100

    client.delete("/files", params={"path": "/big.bin"}, headers=h)
    assert client.get("/quota", headers=h).json()["bytes_used"] == 0


def test_restore_returns_file_to_original_location(client):
    h = _auth(client, "carol")
    _upload(client, h, "note.txt", data=b"hi")
    client.delete("/files", params={"path": "/note.txt"}, headers=h)

    trash_path = client.get("/trash", headers=h).json()["entries"][0]["trash_path"]
    r = client.post("/trash/restore", params={"path": trash_path}, headers=h)
    assert r.status_code == 200
    assert r.json()["path"] == "/note.txt"

    listing = client.get("/files", params={"path": "/"}, headers=h).json()
    assert [e["name"] for e in listing["entries"]] == ["note.txt"]
    assert client.get("/trash", headers=h).json()["entries"] == []
    # Bytes survived the round trip.
    dl = client.get("/files/download", params={"path": "/note.txt"}, headers=h)
    assert dl.content == b"hi"


def test_restore_conflicts_when_original_path_taken(client):
    h = _auth(client, "dave")
    _upload(client, h, "dup.txt", data=b"1")
    client.delete("/files", params={"path": "/dup.txt"}, headers=h)
    # Recreate a file at the same path.
    _upload(client, h, "dup.txt", data=b"2")

    trash_path = client.get("/trash", headers=h).json()["entries"][0]["trash_path"]
    r = client.post("/trash/restore", params={"path": trash_path}, headers=h)
    assert r.status_code == 409


def test_folder_delete_and_restore_cascades(client):
    h = _auth(client, "erin")
    client.post("/folders", json={"path": "/docs"}, headers=h)
    _upload(client, h, "inner.txt", data=b"z", parent="/docs")

    client.delete("/files", params={"path": "/docs"}, headers=h)
    assert client.get("/files", params={"path": "/"}, headers=h).json()["entries"] == []

    trash_path = client.get("/trash", headers=h).json()["entries"][0]["trash_path"]
    client.post("/trash/restore", params={"path": trash_path}, headers=h)

    docs = client.get("/files", params={"path": "/docs"}, headers=h).json()
    assert [e["name"] for e in docs["entries"]] == ["inner.txt"]


def test_purge_permanently_removes(client):
    h = _auth(client, "frank")
    _upload(client, h, "gone.txt")
    client.delete("/files", params={"path": "/gone.txt"}, headers=h)
    trash_path = client.get("/trash", headers=h).json()["entries"][0]["trash_path"]

    p = client.delete("/trash", params={"path": trash_path}, headers=h)
    assert p.status_code == 200
    assert client.get("/trash", headers=h).json()["entries"] == []
    # Purging again is a 404 — it's gone.
    assert client.delete("/trash", params={"path": trash_path}, headers=h).status_code == 404


def test_empty_trash(client):
    h = _auth(client, "grace")
    for n in ("a.txt", "b.txt"):
        _upload(client, h, n)
        client.delete("/files", params={"path": f"/{n}"}, headers=h)
    assert len(client.get("/trash", headers=h).json()["entries"]) == 2

    r = client.delete("/trash/all", headers=h)
    assert r.json()["purged"] == 2
    assert client.get("/trash", headers=h).json()["entries"] == []


def test_restore_rejects_non_trash_path(client):
    h = _auth(client, "heidi")
    _upload(client, h, "x.txt")
    r = client.post("/trash/restore", params={"path": "/x.txt"}, headers=h)
    assert r.status_code == 400
