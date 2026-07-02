import pytest
from fastapi.testclient import TestClient

from services.auth.rate_limiter import LoginRateGuard

VALID_PASSWORD = "validPass1234"


def test_guard_locks_after_threshold_and_recovers():
    now = [1000.0]
    guard = LoginRateGuard(
        max_per_user=3,
        max_per_ip=100,
        window_seconds=60,
        clock=lambda: now[0],
    )
    ip, user = "1.2.3.4", "bob"

    assert guard.retry_after(ip, user) == 0
    for _ in range(3):
        guard.record_failure(ip, user)

    # Threshold reached → locked, with a positive wait.
    assert guard.retry_after(ip, user) > 0

    # Once the window fully elapses, the key is allowed again.
    now[0] += 61
    assert guard.retry_after(ip, user) == 0


def test_success_clears_user_lock():
    now = [0.0]
    guard = LoginRateGuard(
        max_per_user=2, max_per_ip=100, window_seconds=60, clock=lambda: now[0]
    )
    guard.record_failure("ip", "carol")
    guard.record_success("ip", "carol")
    # The single prior failure was cleared, so a fresh failure doesn't lock.
    guard.record_failure("ip", "carol")
    assert guard.retry_after("ip", "carol") == 0


@pytest.fixture
def client(monkeypatch, tmp_path):
    monkeypatch.setenv("STORAGE_ROOT", str(tmp_path))
    monkeypatch.setenv("LOGIN_MAX_FAILURES_PER_USER", "3")
    from main import create_app

    app = create_app()
    with TestClient(app) as test_client:
        yield test_client


def test_login_lockout_returns_429(client: TestClient):
    client.post(
        "/auth/register",
        json={"username": "dave", "password": VALID_PASSWORD},
    )
    for _ in range(3):
        r = client.post(
            "/auth/login", json={"username": "dave", "password": "wrong"}
        )
        assert r.status_code == 401

    # Fourth attempt is rejected before credentials are even checked.
    blocked = client.post(
        "/auth/login", json={"username": "dave", "password": "wrong"}
    )
    assert blocked.status_code == 429
    assert "Retry-After" in blocked.headers

    # Even the *correct* password is blocked while locked out.
    still_blocked = client.post(
        "/auth/login", json={"username": "dave", "password": VALID_PASSWORD}
    )
    assert still_blocked.status_code == 429
