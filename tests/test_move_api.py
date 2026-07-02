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


def _upload(client, headers, name, data=b"data", parent="/"):
    return client.post(
        "/files",
        params={"parent": parent},
        headers=headers,
        files={"upload": (name, io.BytesIO(data), "text/plain")},
    )


def _move(client, headers, source, dest):
    return client.post(
        "/files/move",
        json={"source": source, "destination_parent": dest},
        headers=headers,
    )


def test_move_file_into_folder(client):
    h = _auth(client, "alice")
    _upload(client, h, "a.txt", data=b"hi")
    client.post("/folders", json={"path": "/docs"}, headers=h)

    r = _move(client, h, "/a.txt", "/docs")
    assert r.status_code == 200, r.text
    assert r.json()["path"] == "/docs/a.txt"

    root = client.get("/files", params={"path": "/"}, headers=h).json()
    assert "a.txt" not in [e["name"] for e in root["entries"]]
    docs = client.get("/files", params={"path": "/docs"}, headers=h).json()
    assert [e["name"] for e in docs["entries"]] == ["a.txt"]
    # Bytes followed.
    dl = client.get("/files/download", params={"path": "/docs/a.txt"}, headers=h)
    assert dl.content == b"hi"


def test_move_folder_cascades(client):
    h = _auth(client, "bob")
    client.post("/folders", json={"path": "/src"}, headers=h)
    _upload(client, h, "inner.txt", data=b"z", parent="/src")
    client.post("/folders", json={"path": "/dest"}, headers=h)

    r = _move(client, h, "/src", "/dest")
    assert r.status_code == 200
    moved = client.get("/files", params={"path": "/dest/src"}, headers=h).json()
    assert [e["name"] for e in moved["entries"]] == ["inner.txt"]


def test_move_back_to_root(client):
    h = _auth(client, "carol")
    client.post("/folders", json={"path": "/f"}, headers=h)
    _upload(client, h, "x.txt", parent="/f")

    r = _move(client, h, "/f/x.txt", "/")
    assert r.status_code == 200
    assert r.json()["path"] == "/x.txt"


def test_move_rejects_folder_into_itself(client):
    h = _auth(client, "dave")
    client.post("/folders", json={"path": "/a"}, headers=h)
    client.post("/folders", json={"path": "/a/b"}, headers=h)
    r = _move(client, h, "/a", "/a/b")
    assert r.status_code == 400


def test_move_conflict(client):
    h = _auth(client, "erin")
    _upload(client, h, "dup.txt", parent="/")
    client.post("/folders", json={"path": "/d"}, headers=h)
    _upload(client, h, "dup.txt", parent="/d")
    r = _move(client, h, "/dup.txt", "/d")
    assert r.status_code == 409


def test_move_missing_destination(client):
    h = _auth(client, "frank")
    _upload(client, h, "a.txt")
    r = _move(client, h, "/a.txt", "/nope")
    assert r.status_code == 404
