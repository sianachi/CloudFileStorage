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


def _upload(client, headers, name, data, overwrite=False):
    params = {"parent": "/"}
    if overwrite:
        params["overwrite"] = "true"
    return client.post(
        "/files",
        params=params,
        headers=headers,
        files={"upload": (name, io.BytesIO(data), "text/plain")},
    )


def test_overwrite_creates_versions(client):
    h = _auth(client, "alice")
    _upload(client, h, "a.txt", b"v1content")
    _upload(client, h, "a.txt", b"v2content", overwrite=True)
    _upload(client, h, "a.txt", b"v3content", overwrite=True)

    versions = client.get("/files/versions", params={"path": "/a.txt"}, headers=h).json()
    nos = [v["version_no"] for v in versions["versions"]]
    assert nos == [2, 1]  # newest first; v1content=1, v2content=2

    # The stored version bytes are the *prior* contents.
    d1 = client.get(
        "/files/versions/download", params={"path": "/a.txt", "version": 1}, headers=h
    )
    assert d1.content == b"v1content"
    d2 = client.get(
        "/files/versions/download", params={"path": "/a.txt", "version": 2}, headers=h
    )
    assert d2.content == b"v2content"


def test_restore_version_rolls_back_and_keeps_history(client):
    h = _auth(client, "bob")
    _upload(client, h, "a.txt", b"original")
    _upload(client, h, "a.txt", b"changed", overwrite=True)

    # Roll back to version 1 (the original).
    r = client.post(
        "/files/versions/restore", params={"path": "/a.txt", "version": 1}, headers=h
    )
    assert r.status_code == 200

    current = client.get("/files/download", params={"path": "/a.txt"}, headers=h)
    assert current.content == b"original"

    # The pre-restore contents ("changed") were snapshotted as a new version.
    versions = client.get("/files/versions", params={"path": "/a.txt"}, headers=h).json()
    assert len(versions["versions"]) == 2


def test_save_content_versions_previous(client):
    h = _auth(client, "carol")
    _upload(client, h, "note.md", b"# first")
    r = client.put(
        "/files/content",
        params={"path": "/note.md"},
        headers=h,
        json={"content": "# second"},
    )
    assert r.status_code == 200

    versions = client.get("/files/versions", params={"path": "/note.md"}, headers=h).json()
    assert len(versions["versions"]) == 1
    d = client.get(
        "/files/versions/download", params={"path": "/note.md", "version": 1}, headers=h
    )
    assert d.content == b"# first"


def test_versions_survive_rename(client):
    h = _auth(client, "dave")
    _upload(client, h, "a.txt", b"one")
    _upload(client, h, "a.txt", b"two", overwrite=True)
    # Rename the live file; its history must follow.
    client.patch("/files", params={"path": "/a.txt"}, headers=h, json={"new_name": "b.txt"})

    versions = client.get("/files/versions", params={"path": "/b.txt"}, headers=h).json()
    assert len(versions["versions"]) == 1


def test_missing_version_is_404(client):
    h = _auth(client, "erin")
    _upload(client, h, "a.txt", b"one")
    r = client.get(
        "/files/versions/download", params={"path": "/a.txt", "version": 5}, headers=h
    )
    assert r.status_code == 404
