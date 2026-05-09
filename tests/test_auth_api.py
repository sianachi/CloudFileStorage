import pytest
from fastapi.testclient import TestClient


@pytest.fixture
def client(monkeypatch, tmp_path):
    monkeypatch.setenv("STORAGE_ROOT", str(tmp_path))
    from main import create_app

    app = create_app()
    with TestClient(app) as test_client:
        yield test_client


def test_register_then_duplicate(client: TestClient):
    body = {
        "username": "alice",
        "password": "secret123",
        "email": "alice@example.com",
    }
    r = client.post("/auth/register", json=body)
    assert r.status_code == 200
    data = r.json()
    assert data["success"] is True
    assert data["username"] == "alice"

    r2 = client.post("/auth/register", json=body)
    assert r2.status_code == 409


def test_login_invalid_credentials(client: TestClient):
    client.post(
        "/auth/register",
        json={
            "username": "bob",
            "password": "pw",
            "email": "bob@example.com",
        },
    )
    r = client.post(
        "/auth/login",
        json={"username": "bob", "password": "wrong"},
    )
    assert r.status_code == 401


def test_login_unknown_user(client: TestClient):
    r = client.post(
        "/auth/login",
        json={"username": "nobody", "password": "x"},
    )
    assert r.status_code == 401


def test_login_me_logout(client: TestClient):
    client.post(
        "/auth/register",
        json={
            "username": "carol",
            "password": "secret123",
            "email": "carol@example.com",
        },
    )
    login_r = client.post(
        "/auth/login",
        json={"username": "carol", "password": "secret123"},
    )
    assert login_r.status_code == 200
    token = login_r.json()["access_token"]
    headers = {"Authorization": f"Bearer {token}"}

    me_r = client.get("/auth/me", headers=headers)
    assert me_r.status_code == 200
    assert me_r.json()["username"] == "carol"

    out_r = client.post("/auth/logout", headers=headers)
    assert out_r.status_code == 200

    me_after = client.get("/auth/me", headers=headers)
    assert me_after.status_code == 401
