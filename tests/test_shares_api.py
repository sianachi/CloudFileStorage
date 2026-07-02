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


def test_share_file_with_user_read(client):
    owner = _auth(client, "owner")
    _auth(client, "friend")  # ensure account exists
    friend = _auth(client, "friend")
    _upload(client, owner, "doc.txt", data=b"secret")

    r = client.post(
        "/shares",
        headers=owner,
        json={"path": "/doc.txt", "target_username": "friend", "role": "read"},
    )
    assert r.status_code == 200, r.text
    share = r.json()
    assert share["kind"] == "user"
    assert share["target_username"] == "friend"

    # Friend sees it in "shared with me".
    with_me = client.get("/shares/with-me", headers=friend).json()["entries"]
    assert len(with_me) == 1
    sid = with_me[0]["share_id"]

    # Friend can download the bytes.
    dl = client.get(
        "/shares/with-me/download", params={"id": sid}, headers=friend
    )
    assert dl.status_code == 200
    assert dl.content == b"secret"


def test_read_share_cannot_write(client):
    owner = _auth(client, "o2")
    friend = _auth(client, "f2")
    _upload(client, owner, "note.md", data=b"# hi")
    sid = client.post(
        "/shares",
        headers=owner,
        json={"path": "/note.md", "target_username": "f2", "role": "read"},
    ).json()["id"]

    r = client.put(
        "/shares/with-me/content",
        params={"id": sid},
        headers=friend,
        json={"content": "hacked"},
    )
    assert r.status_code == 403


def test_write_share_allows_content_save(client):
    owner = _auth(client, "o3")
    friend = _auth(client, "f3")
    _upload(client, owner, "note.md", data=b"# original")
    sid = client.post(
        "/shares",
        headers=owner,
        json={"path": "/note.md", "target_username": "f3", "role": "write"},
    ).json()["id"]

    r = client.put(
        "/shares/with-me/content",
        params={"id": sid},
        headers=friend,
        json={"content": "# edited by friend"},
    )
    assert r.status_code == 200
    # Owner sees the edit.
    dl = client.get("/files/download", params={"path": "/note.md"}, headers=owner)
    assert dl.content == b"# edited by friend"


def test_folder_share_subtree_and_upload(client):
    owner = _auth(client, "o4")
    friend = _auth(client, "f4")
    client.post("/folders", json={"path": "/shared"}, headers=owner)
    _upload(client, owner, "a.txt", data=b"A", parent="/shared")

    sid = client.post(
        "/shares",
        headers=owner,
        json={"path": "/shared", "target_username": "f4", "role": "write"},
    ).json()["id"]

    # Friend lists the folder contents (share-relative paths).
    listing = client.get(
        "/shares/with-me/list", params={"id": sid}, headers=friend
    ).json()
    assert [e["name"] for e in listing["entries"]] == ["a.txt"]

    # Friend uploads a new file into the shared folder.
    up = client.post(
        "/shares/with-me/upload",
        params={"id": sid},
        headers=friend,
        files={"upload": ("b.txt", io.BytesIO(b"B"), "text/plain")},
    )
    assert up.status_code == 200, up.text
    # It landed in the owner's folder.
    owner_list = client.get("/files", params={"path": "/shared"}, headers=owner).json()
    assert sorted(e["name"] for e in owner_list["entries"]) == ["a.txt", "b.txt"]


def test_subpath_cannot_escape_shared_folder(client):
    owner = _auth(client, "o5")
    friend = _auth(client, "f5")
    client.post("/folders", json={"path": "/pub"}, headers=owner)
    _upload(client, owner, "outside.txt", data=b"nope", parent="/")
    sid = client.post(
        "/shares",
        headers=owner,
        json={"path": "/pub", "target_username": "f5", "role": "read"},
    ).json()["id"]

    r = client.get(
        "/shares/with-me/download",
        params={"id": sid, "subpath": "/../outside.txt"},
        headers=friend,
    )
    assert r.status_code == 400


def test_public_link_read_only(client):
    owner = _auth(client, "o6")
    _upload(client, owner, "flyer.txt", data=b"public!")
    share = client.post(
        "/shares", headers=owner, json={"path": "/flyer.txt", "public": True}
    ).json()
    token = share["public_token"]
    assert token

    # No auth needed.
    info = client.get(f"/public/{token}")
    assert info.status_code == 200
    assert info.json()["name"] == "flyer.txt"
    dl = client.get(f"/public/{token}/download")
    assert dl.status_code == 200
    assert dl.content == b"public!"


def test_revoke_share_blocks_access(client):
    owner = _auth(client, "o7")
    friend = _auth(client, "f7")
    _upload(client, owner, "x.txt", data=b"x")
    sid = client.post(
        "/shares",
        headers=owner,
        json={"path": "/x.txt", "target_username": "f7", "role": "read"},
    ).json()["id"]

    assert client.get("/shares/with-me/download", params={"id": sid}, headers=friend).status_code == 200
    client.delete("/shares", params={"id": sid}, headers=owner)
    assert client.get("/shares/with-me/download", params={"id": sid}, headers=friend).status_code == 404


def test_cannot_access_others_share(client):
    owner = _auth(client, "o8")
    _auth(client, "f8")
    stranger = _auth(client, "s8")
    _upload(client, owner, "x.txt", data=b"x")
    sid = client.post(
        "/shares",
        headers=owner,
        json={"path": "/x.txt", "target_username": "f8", "role": "read"},
    ).json()["id"]
    # Stranger (not the share target) gets 404.
    assert client.get("/shares/with-me/download", params={"id": sid}, headers=stranger).status_code == 404
