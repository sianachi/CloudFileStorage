"""In-memory sliding-window rate limiting for authentication endpoints.

Brute-force protection without an external dependency (no Redis) — fine for
the single-process deployment Pithos targets. If the backend ever scales to
multiple workers this state would need to move to a shared store, because
each process would otherwise keep its own independent counters.

The design is a sliding window per key: we keep the timestamps of recent
events (failed logins) and, once ``max_events`` fall inside ``window_seconds``,
the key is locked until the oldest event ages out of the window.
"""

import os
import time
from collections import defaultdict, deque
from typing import Callable


class SlidingWindowLimiter:
    def __init__(
        self,
        max_events: int,
        window_seconds: float,
        clock: Callable[[], float] = time.monotonic,
    ):
        self._max = max_events
        self._window = window_seconds
        self._events: dict[str, deque[float]] = defaultdict(deque)
        self._clock = clock

    def _prune(self, key: str, now: float) -> deque[float]:
        dq = self._events[key]
        cutoff = now - self._window
        while dq and dq[0] <= cutoff:
            dq.popleft()
        return dq

    def retry_after(self, key: str) -> float:
        """Seconds until ``key`` is allowed again; 0.0 if allowed now."""
        now = self._clock()
        dq = self._prune(key, now)
        if len(dq) < self._max:
            return 0.0
        return max(0.0, dq[0] + self._window - now)

    def record(self, key: str) -> None:
        now = self._clock()
        self._prune(key, now)
        self._events[key].append(now)

    def clear(self, key: str) -> None:
        self._events.pop(key, None)


class LoginRateGuard:
    """Combines a strict per-username limiter with a looser per-IP limiter.

    Per-username stops an attacker hammering one account; per-IP stops one
    host spraying many usernames. A caller is blocked if *either* trips.
    """

    def __init__(
        self,
        *,
        max_per_user: int,
        max_per_ip: int,
        window_seconds: float,
        clock: Callable[[], float] = time.monotonic,
    ):
        self._user = SlidingWindowLimiter(max_per_user, window_seconds, clock)
        self._ip = SlidingWindowLimiter(max_per_ip, window_seconds, clock)
        # Registration is throttled per-IP on *every* attempt (not just
        # failures) to curb automated account creation.
        self._register = SlidingWindowLimiter(max_per_ip, window_seconds, clock)

    @classmethod
    def from_env(cls, clock: Callable[[], float] = time.monotonic) -> "LoginRateGuard":
        return cls(
            max_per_user=int(os.getenv("LOGIN_MAX_FAILURES_PER_USER", "5")),
            max_per_ip=int(os.getenv("LOGIN_MAX_FAILURES_PER_IP", "20")),
            window_seconds=float(os.getenv("LOGIN_LOCKOUT_WINDOW_SECONDS", "900")),
            clock=clock,
        )

    @staticmethod
    def _user_key(username: str) -> str:
        return f"user:{username.lower()}"

    @staticmethod
    def _ip_key(ip: str) -> str:
        return f"ip:{ip}"

    def retry_after(self, ip: str, username: str) -> int:
        """Seconds the caller must wait, rounded up; 0 if allowed now."""
        wait = max(
            self._user.retry_after(self._user_key(username)),
            self._ip.retry_after(self._ip_key(ip)),
        )
        # Round up so a sub-second remainder still reports at least 1s.
        return int(wait) + (1 if wait > int(wait) else 0)

    def record_failure(self, ip: str, username: str) -> None:
        self._user.record(self._user_key(username))
        self._ip.record(self._ip_key(ip))

    def register_retry_after(self, ip: str) -> int:
        wait = self._register.retry_after(self._ip_key(ip))
        return int(wait) + (1 if wait > int(wait) else 0)

    def record_registration_attempt(self, ip: str) -> None:
        self._register.record(self._ip_key(ip))

    def record_success(self, ip: str, username: str) -> None:
        # A correct login clears that username's failures so a legitimate user
        # who fat-fingered a few times isn't left locked out. The IP counter is
        # intentionally left intact — a success from one account shouldn't wipe
        # the evidence of spraying across others.
        self._user.clear(self._user_key(username))
