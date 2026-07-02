import io
import time

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


def _upload(client, headers, name, parent="/"):
    return client.post(
        "/files",
        params={"parent": parent},
        headers=headers,
        files={"upload": (name, io.BytesIO(b"x"), "text/plain")},
    )


def test_favorite_toggle_and_list(client):
    h = _auth(client, "alice")
    _upload(client, h, "a.txt")
    _upload(client, h, "b.txt")

    r = client.post("/files/favorite", headers=h, json={"path": "/a.txt", "favorite": True})
    assert r.status_code == 200
    assert r.json()["is_favorite"] is True

    favs = client.get("/files/favorites", headers=h).json()["entries"]
    assert [e["name"] for e in favs] == ["a.txt"]

    # Un-favorite.
    client.post("/files/favorite", headers=h, json={"path": "/a.txt", "favorite": False})
    assert client.get("/files/favorites", headers=h).json()["entries"] == []


def test_favorite_reflected_in_listing(client):
    h = _auth(client, "bob")
    _upload(client, h, "a.txt")
    client.post("/files/favorite", headers=h, json={"path": "/a.txt", "favorite": True})
    listing = client.get("/files", params={"path": "/"}, headers=h).json()
    entry = next(e for e in listing["entries"] if e["name"] == "a.txt")
    assert entry["is_favorite"] is True


def test_recent_orders_newest_first(client):
    h = _auth(client, "carol")
    _upload(client, h, "old.txt")
    time.sleep(0.01)
    _upload(client, h, "new.txt")
    recent = client.get("/files/recent", headers=h).json()["entries"]
    assert recent[0]["name"] == "new.txt"


def test_recent_excludes_folders_and_trashed(client):
    h = _auth(client, "dave")
    client.post("/folders", json={"path": "/dir"}, headers=h)
    _upload(client, h, "keep.txt")
    _upload(client, h, "gone.txt")
    client.delete("/files", params={"path": "/gone.txt"}, headers=h)

    names = [e["name"] for e in client.get("/files/recent", headers=h).json()["entries"]]
    assert "keep.txt" in names
    assert "gone.txt" not in names
    assert "dir" not in names
