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


def _upload(client, headers, name, parent="/"):
    return client.post(
        "/files",
        params={"parent": parent},
        headers=headers,
        files={"upload": (name, io.BytesIO(b"x"), "text/plain")},
    )


def test_search_matches_substring_case_insensitive(client):
    h = _auth(client, "alice")
    _upload(client, h, "Report.pdf")
    _upload(client, h, "notes.txt")

    r = client.get("/files/search", params={"q": "report"}, headers=h)
    assert r.status_code == 200
    names = [e["name"] for e in r.json()["entries"]]
    assert names == ["Report.pdf"]


def test_search_excludes_trashed(client):
    h = _auth(client, "bob")
    _upload(client, h, "secret.txt")
    client.delete("/files", params={"path": "/secret.txt"}, headers=h)

    r = client.get("/files/search", params={"q": "secret"}, headers=h)
    assert r.json()["entries"] == []


def test_search_is_owner_scoped(client):
    ha = _auth(client, "carol")
    hb = _auth(client, "dave")
    _upload(client, ha, "carol-only.txt")

    r = client.get("/files/search", params={"q": "carol-only"}, headers=hb)
    assert r.json()["entries"] == []


def test_search_escapes_like_wildcards(client):
    h = _auth(client, "erin")
    _upload(client, h, "100percent.txt")
    _upload(client, h, "50pct.txt")

    # A literal "%" must not act as a wildcard matching everything.
    r = client.get("/files/search", params={"q": "%"}, headers=h)
    assert r.json()["entries"] == []
