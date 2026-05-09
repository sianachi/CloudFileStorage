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


def test_register_then_duplicate(client: TestClient):
    body = {
        "username": "alice",
        "password": VALID_PASSWORD,
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
            "password": VALID_PASSWORD,
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
            "password": VALID_PASSWORD,
            "email": "carol@example.com",
        },
    )
    login_r = client.post(
        "/auth/login",
        json={"username": "carol", "password": VALID_PASSWORD},
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


def test_register_rejects_short_password(client: TestClient):
    r = client.post(
        "/auth/register",
        json={
            "username": "dave",
            "password": "short1",
            "email": "dave@example.com",
        },
    )
    assert r.status_code == 422


def test_register_rejects_password_without_digit(client: TestClient):
    r = client.post(
        "/auth/register",
        json={
            "username": "eve",
            "password": "noDigitsAtAllHere",
            "email": "eve@example.com",
        },
    )
    assert r.status_code == 422


def test_register_accepts_password_at_min_length(client: TestClient):
    r = client.post(
        "/auth/register",
        json={
            "username": "frank",
            "password": "abcdefghijk1",  # exactly 12 chars, has digit
            "email": "frank@example.com",
        },
    )
    assert r.status_code == 200


def test_register_rejects_oversized_password(client: TestClient):
    r = client.post(
        "/auth/register",
        json={
            "username": "grace",
            "password": "a" * 72 + "1",  # 73 bytes
            "email": "grace@example.com",
        },
    )
    assert r.status_code == 422


def test_register_rejects_invalid_email(client: TestClient):
    r = client.post(
        "/auth/register",
        json={
            "username": "heidi",
            "password": VALID_PASSWORD,
            "email": "not-an-email",
        },
    )
    assert r.status_code == 422


def test_login_does_not_enforce_password_policy(client: TestClient):
    # A short password sent to /auth/login must NOT 422 — login should
    # only ever fail with 401 so existing accounts don't get locked out
    # if the policy ever tightens further.
    r = client.post(
        "/auth/login",
        json={"username": "ivan", "password": "x"},
    )
    assert r.status_code == 401
