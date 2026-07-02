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


def _register_and_login(client: TestClient, username: str) -> dict:
    client.post(
        "/auth/register", json={"username": username, "password": VALID_PASSWORD}
    )
    r = client.post(
        "/auth/login", json={"username": username, "password": VALID_PASSWORD}
    )
    assert r.status_code == 200
    return r.json()


def test_login_issues_refresh_token(client: TestClient):
    data = _register_and_login(client, "alice")
    assert data["access_token"]
    assert data["refresh_token"]


def test_refresh_returns_new_pair_and_works(client: TestClient):
    data = _register_and_login(client, "bob")
    r = client.post("/auth/refresh", json={"refresh_token": data["refresh_token"]})
    assert r.status_code == 200
    new_pair = r.json()
    assert new_pair["access_token"]
    assert new_pair["refresh_token"]

    # The new access token authenticates /auth/me.
    me = client.get(
        "/auth/me", headers={"Authorization": f"Bearer {new_pair['access_token']}"}
    )
    assert me.status_code == 200
    assert me.json()["username"] == "bob"


def test_refresh_token_is_single_use(client: TestClient):
    data = _register_and_login(client, "carol")
    first = client.post(
        "/auth/refresh", json={"refresh_token": data["refresh_token"]}
    )
    assert first.status_code == 200
    # Re-using the original (now rotated-away) refresh token must fail.
    replay = client.post(
        "/auth/refresh", json={"refresh_token": data["refresh_token"]}
    )
    assert replay.status_code == 401


def test_access_token_rejected_as_refresh(client: TestClient):
    data = _register_and_login(client, "dave")
    r = client.post("/auth/refresh", json={"refresh_token": data["access_token"]})
    assert r.status_code == 401


def test_refresh_token_rejected_as_access(client: TestClient):
    data = _register_and_login(client, "erin")
    me = client.get(
        "/auth/me", headers={"Authorization": f"Bearer {data['refresh_token']}"}
    )
    assert me.status_code == 401
