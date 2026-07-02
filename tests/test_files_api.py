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


def _register_and_login(client: TestClient, username: str) -> str:
    client.post(
        "/auth/register",
        json={
            "username": username,
            "password": VALID_PASSWORD,
        },
    )
    r = client.post(
        "/auth/login",
        json={"username": username, "password": VALID_PASSWORD},
    )
    assert r.status_code == 200
    return r.json()["access_token"]


def test_files_require_auth(client: TestClient):
    r = client.get("/files")
    assert r.status_code in (401, 403)


def test_upload_then_list(client: TestClient):
    token = _register_and_login(client, "alice")
    headers = {"Authorization": f"Bearer {token}"}

    payload = b"hello world"
    r = client.post(
        "/files",
        params={"parent": "/"},
        headers=headers,
        files={"upload": ("hello.txt", io.BytesIO(payload), "text/plain")},
    )
    assert r.status_code == 200, r.text
    entry = r.json()
    assert entry["name"] == "hello.txt"
    assert entry["size"] == len(payload)
    assert entry["is_directory"] is False

    listing = client.get("/files", headers=headers).json()
    assert listing["path"] == "/"
    names = [e["name"] for e in listing["entries"]]
    assert "hello.txt" in names


def test_two_users_do_not_collide(client: TestClient):
    a_token = _register_and_login(client, "alice")
    b_token = _register_and_login(client, "bob")

    client.post(
        "/files",
        params={"parent": "/"},
        headers={"Authorization": f"Bearer {a_token}"},
        files={"upload": ("notes.txt", io.BytesIO(b"alice-data"), "text/plain")},
    )
    client.post(
        "/files",
        params={"parent": "/"},
        headers={"Authorization": f"Bearer {b_token}"},
        files={"upload": ("notes.txt", io.BytesIO(b"bob"), "text/plain")},
    )

    a_listing = client.get("/files", headers={"Authorization": f"Bearer {a_token}"}).json()
    b_listing = client.get("/files", headers={"Authorization": f"Bearer {b_token}"}).json()

    a_sizes = {e["name"]: e["size"] for e in a_listing["entries"]}
    b_sizes = {e["name"]: e["size"] for e in b_listing["entries"]}
    assert a_sizes["notes.txt"] == len(b"alice-data")
    assert b_sizes["notes.txt"] == len(b"bob")


def test_download_roundtrip(client: TestClient):
    token = _register_and_login(client, "carol")
    headers = {"Authorization": f"Bearer {token}"}
    payload = b"\x00\x01round-trip\xff"

    client.post(
        "/files",
        params={"parent": "/"},
        headers=headers,
        files={"upload": ("blob.bin", io.BytesIO(payload), "application/octet-stream")},
    )
    r = client.get("/files/download", params={"path": "/blob.bin"}, headers=headers)
    assert r.status_code == 200
    assert r.content == payload


def test_create_folder_and_nested_upload(client: TestClient):
    token = _register_and_login(client, "dave")
    headers = {"Authorization": f"Bearer {token}"}

    r = client.post("/folders", json={"path": "/Work"}, headers=headers)
    assert r.status_code == 200, r.text
    assert r.json()["is_directory"] is True

    r2 = client.post(
        "/files",
        params={"parent": "/Work"},
        headers=headers,
        files={"upload": ("memo.txt", io.BytesIO(b"hi"), "text/plain")},
    )
    assert r2.status_code == 200, r2.text

    listing = client.get("/files", params={"path": "/Work"}, headers=headers).json()
    names = [e["name"] for e in listing["entries"]]
    assert names == ["memo.txt"]


def test_create_folder_rejects_missing_parent(client: TestClient):
    token = _register_and_login(client, "eve")
    headers = {"Authorization": f"Bearer {token}"}
    r = client.post("/folders", json={"path": "/Nope/Inner"}, headers=headers)
    assert r.status_code == 404


def test_delete_file_and_quota(client: TestClient):
    token = _register_and_login(client, "frank")
    headers = {"Authorization": f"Bearer {token}"}

    payload = b"x" * 1024
    client.post(
        "/files",
        params={"parent": "/"},
        headers=headers,
        files={"upload": ("a.bin", io.BytesIO(payload), "application/octet-stream")},
    )

    q = client.get("/quota", headers=headers).json()
    assert q["bytes_used"] == 1024

    r = client.delete("/files", params={"path": "/a.bin"}, headers=headers)
    assert r.status_code == 200
    assert r.json()["success"] is True

    listing = client.get("/files", headers=headers).json()
    assert listing["entries"] == []
    q2 = client.get("/quota", headers=headers).json()
    assert q2["bytes_used"] == 0


def test_path_traversal_rejected(client: TestClient):
    token = _register_and_login(client, "grace")
    headers = {"Authorization": f"Bearer {token}"}
    r = client.post("/folders", json={"path": "/../etc"}, headers=headers)
    assert r.status_code == 400


def test_rename_file(client: TestClient):
    token = _register_and_login(client, "iris")
    headers = {"Authorization": f"Bearer {token}"}
    client.post(
        "/files",
        params={"parent": "/"},
        headers=headers,
        files={"upload": ("old.txt", io.BytesIO(b"data"), "text/plain")},
    )
    r = client.patch(
        "/files",
        params={"path": "/old.txt"},
        headers=headers,
        json={"new_name": "renamed.txt"},
    )
    assert r.status_code == 200, r.text
    entry = r.json()
    assert entry["name"] == "renamed.txt"
    assert entry["path"] == "/renamed.txt"

    # Old path is gone, new path serves the same bytes
    assert client.get("/files/download", params={"path": "/old.txt"}, headers=headers).status_code == 404
    dl = client.get("/files/download", params={"path": "/renamed.txt"}, headers=headers)
    assert dl.status_code == 200
    assert dl.content == b"data"


def test_rename_folder_cascades(client: TestClient):
    token = _register_and_login(client, "judy")
    headers = {"Authorization": f"Bearer {token}"}
    client.post("/folders", json={"path": "/Work"}, headers=headers)
    client.post("/folders", json={"path": "/Work/Reports"}, headers=headers)
    client.post(
        "/files",
        params={"parent": "/Work/Reports"},
        headers=headers,
        files={"upload": ("memo.txt", io.BytesIO(b"hello"), "text/plain")},
    )

    r = client.patch(
        "/files",
        params={"path": "/Work"},
        headers=headers,
        json={"new_name": "Job"},
    )
    assert r.status_code == 200, r.text
    assert r.json()["path"] == "/Job"

    # Listing under the old name is gone; new name has the moved subtree
    listing = client.get("/files", headers=headers).json()
    names = [e["name"] for e in listing["entries"]]
    assert names == ["Job"]

    nested = client.get("/files", params={"path": "/Job/Reports"}, headers=headers).json()
    assert [e["name"] for e in nested["entries"]] == ["memo.txt"]

    dl = client.get("/files/download", params={"path": "/Job/Reports/memo.txt"}, headers=headers)
    assert dl.status_code == 200
    assert dl.content == b"hello"


def test_rename_collision_returns_409(client: TestClient):
    token = _register_and_login(client, "kim")
    headers = {"Authorization": f"Bearer {token}"}
    client.post(
        "/files",
        params={"parent": "/"},
        headers=headers,
        files={"upload": ("a.txt", io.BytesIO(b"1"), "text/plain")},
    )
    client.post(
        "/files",
        params={"parent": "/"},
        headers=headers,
        files={"upload": ("b.txt", io.BytesIO(b"2"), "text/plain")},
    )
    r = client.patch(
        "/files",
        params={"path": "/a.txt"},
        headers=headers,
        json={"new_name": "b.txt"},
    )
    assert r.status_code == 409


def test_rename_rejects_slash_in_name(client: TestClient):
    token = _register_and_login(client, "leo")
    headers = {"Authorization": f"Bearer {token}"}
    client.post(
        "/files",
        params={"parent": "/"},
        headers=headers,
        files={"upload": ("a.txt", io.BytesIO(b"1"), "text/plain")},
    )
    r = client.patch(
        "/files",
        params={"path": "/a.txt"},
        headers=headers,
        json={"new_name": "subdir/evil.txt"},
    )
    assert r.status_code == 400


def test_delete_folder_cascades(client: TestClient):
    token = _register_and_login(client, "heidi")
    headers = {"Authorization": f"Bearer {token}"}

    client.post("/folders", json={"path": "/Stuff"}, headers=headers)
    client.post(
        "/files",
        params={"parent": "/Stuff"},
        headers=headers,
        files={"upload": ("inner.txt", io.BytesIO(b"hi"), "text/plain")},
    )

    r = client.delete("/files", params={"path": "/Stuff"}, headers=headers)
    assert r.status_code == 200

    # Inner file should be gone too.
    r2 = client.get("/files/download", params={"path": "/Stuff/inner.txt"}, headers=headers)
    assert r2.status_code == 404
    listing = client.get("/files", headers=headers).json()
    assert listing["entries"] == []
