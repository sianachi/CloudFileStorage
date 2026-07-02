import os
import sqlite3
import base64
import binascii
import hashlib
import hmac
import json
import secrets
from datetime import datetime, timedelta, timezone

import bcrypt

from const import Constants
from dto.dto import (
    LoginResponse,
    LoginUserRequest,
    LogoutResponse,
    RegisterResponse,
    RegisterUserRequest,
    TokenVerificationResult,
)
from models.auth.user import User
from services.migrations import apply_migrations
from services.schema import BASELINE_VERSION, USERS_MIGRATIONS
from services.sqlite_service import SQLiteService


class AuthManagement(SQLiteService):
    def __init__(self, physical_path: str = None):
        base_path = physical_path or ""
        super().__init__(os.path.join(base_path, Constants.USERS_TABLE_NAME))
        self.TABLE_NAME = Constants.USERS_TABLE_NAME
        self._token_secret = os.getenv("AUTH_TOKEN_SECRET", "dev-token-secret")
        self._token_ttl_minutes = int(os.getenv("AUTH_TOKEN_TTL_MINUTES", "30"))
        # Refresh tokens live much longer so a session survives across many
        # short access-token expiries without forcing a re-login. Default 7d.
        self._refresh_ttl_minutes = int(
            os.getenv("AUTH_REFRESH_TTL_MINUTES", str(60 * 24 * 7))
        )
        self._revoked_tokens: set[str] = set()
        # Rotated/consumed refresh tokens are revoked by their jti so a stolen
        # older refresh token can't be replayed after rotation.
        self._revoked_jti: set[str] = set()

    async def initalizeDatabase(self, physical_path: str = None):
        base_path = physical_path or ""
        self._db_path = os.path.join(base_path, Constants.USERS_TABLE_NAME)
        await self.ensure_table(
            f"""
            CREATE TABLE IF NOT EXISTS {self.TABLE_NAME} (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                username TEXT UNIQUE NOT NULL,
                password_hash TEXT NOT NULL,
                -- Legacy column: immediately dropped by migration v1. Kept in
                -- the baseline so the drop migration is valid on fresh DBs too.
                email TEXT,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            )
        """
        )
        await apply_migrations(
            self._db_path, USERS_MIGRATIONS, baseline=BASELINE_VERSION
        )

    async def login(self, request: LoginUserRequest) -> LoginResponse:
        user = await self.get_user(request.username)
        if user is None:
            return LoginResponse(success=False, message="User not found")

        if not bcrypt.checkpw(request.password.encode("utf-8"), user.password_hash.encode("utf-8")):
            return LoginResponse(success=False, message="Invalid password")

        return LoginResponse(
            success=True,
            message="Login successful",
            access_token=self._create_token(user.username, "access"),
            refresh_token=self._create_token(user.username, "refresh"),
            token_type="bearer",
        )

    async def refresh(self, refresh_token: str) -> LoginResponse:
        """Exchange a valid refresh token for a fresh access + refresh pair.

        Rotates the refresh token: the presented one is revoked so it can be
        used exactly once. If it was already used (or forged/expired), the
        exchange fails and the client must log in again.
        """
        result = self.verify_token(refresh_token, expected_type="refresh")
        if not result.valid or result.username is None:
            return LoginResponse(
                success=False, message=result.message or "Invalid refresh token"
            )

        # The account may have been deleted since the token was issued.
        user = await self.get_user(result.username)
        if user is None:
            return LoginResponse(success=False, message="Account not found")

        payload = self._decode_token(refresh_token)
        if payload and "jti" in payload:
            self._revoked_jti.add(payload["jti"])

        return LoginResponse(
            success=True,
            message="Token refreshed",
            access_token=self._create_token(user.username, "access"),
            refresh_token=self._create_token(user.username, "refresh"),
            token_type="bearer",
        )

    async def register(self, request: RegisterUserRequest) -> RegisterResponse:
        existing_user = await self.get_user(request.username)
        if existing_user is not None:
            return RegisterResponse(success=False, message="User already exists")

        password_hash = bcrypt.hashpw(
            request.password.encode("utf-8"),
            bcrypt.gensalt(),
        ).decode("utf-8")
        now = datetime.now(timezone.utc).isoformat()

        try:
            async with self._connect() as db:
                await db.execute(
                    f"INSERT INTO {self.TABLE_NAME} (username, password_hash, created_at, updated_at) "
                    "VALUES (?, ?, ?, ?)",
                    (request.username, password_hash, now, now),
                )
                await db.commit()
        except sqlite3.IntegrityError:
            return RegisterResponse(success=False, message="User already exists")
        return RegisterResponse(
            success=True,
            message="User registered successfully",
            username=request.username,
        )

    async def get_user(self, username: str) -> User | None:
        async with self._connect() as db:
            cursor = await db.execute(
                f"SELECT * FROM {self.TABLE_NAME} WHERE username = ?",
                (username,),
            )
            row = await cursor.fetchone()
            if row is None:
                return None
            return User(
                id=row["id"],
                username=row["username"],
                password_hash=row["password_hash"],
                created_at=datetime.fromisoformat(row["created_at"]),
                updated_at=datetime.fromisoformat(row["updated_at"]),
            )


    async def get_user_by_id(self, user_id: int) -> User | None:
        async with self._connect() as db:
            cursor = await db.execute(
                f"SELECT * FROM {self.TABLE_NAME} WHERE id = ?",
                (user_id,),
            )
            row = await cursor.fetchone()
            if row is None:
                return None
            return User(
                id=row["id"],
                username=row["username"],
                password_hash=row["password_hash"],
                created_at=datetime.fromisoformat(row["created_at"]),
                updated_at=datetime.fromisoformat(row["updated_at"]),
            )

    def logout(self, token: str) -> LogoutResponse:
        self._revoked_tokens.add(token)
        return LogoutResponse(success=True, message="Logout successful")

    def verify_token(
        self, token: str, expected_type: str = "access"
    ) -> TokenVerificationResult:
        if token in self._revoked_tokens:
            return TokenVerificationResult(valid=False, message="Token has been revoked")

        payload = self._decode_token(token)
        if payload is None:
            return TokenVerificationResult(valid=False, message="Invalid token")

        # Tokens issued before typing existed have no "typ" — treat as access
        # so old access tokens keep working, but reject a refresh token used
        # where an access token is required (and vice versa).
        if payload.get("typ", "access") != expected_type:
            return TokenVerificationResult(valid=False, message="Wrong token type")

        jti = payload.get("jti")
        if jti is not None and jti in self._revoked_jti:
            return TokenVerificationResult(valid=False, message="Token has been revoked")

        if payload["exp"] < int(datetime.now(timezone.utc).timestamp()):
            return TokenVerificationResult(valid=False, message="Token has expired")

        return TokenVerificationResult(valid=True, message=None, username=payload["sub"])

    def _create_token(self, username: str, token_type: str = "access") -> str:
        ttl_minutes = (
            self._token_ttl_minutes
            if token_type == "access"
            else self._refresh_ttl_minutes
        )
        expires_at = datetime.now(timezone.utc) + timedelta(minutes=ttl_minutes)
        payload = {
            "sub": username,
            "exp": int(expires_at.timestamp()),
            "typ": token_type,
        }
        # A per-token id lets us revoke a specific refresh token on rotation
        # without invalidating the whole secret.
        if token_type == "refresh":
            payload["jti"] = secrets.token_urlsafe(12)
        payload_bytes = json.dumps(payload, separators=(",", ":")).encode("utf-8")
        payload_b64 = base64.urlsafe_b64encode(payload_bytes).decode("utf-8")
        signature = hmac.new(
            self._token_secret.encode("utf-8"),
            payload_b64.encode("utf-8"),
            hashlib.sha256,
        ).hexdigest()
        return f"{payload_b64}.{signature}"

    def _decode_token(self, token: str) -> dict | None:
        try:
            payload_b64, signature = token.split(".", maxsplit=1)
            expected_signature = hmac.new(
                self._token_secret.encode("utf-8"),
                payload_b64.encode("utf-8"),
                hashlib.sha256,
            ).hexdigest()
            if not hmac.compare_digest(signature, expected_signature):
                return None

            padded_payload = payload_b64 + "=" * (-len(payload_b64) % 4)
            payload = json.loads(base64.urlsafe_b64decode(padded_payload.encode("utf-8")).decode("utf-8"))
            if "sub" not in payload or "exp" not in payload:
                return None
            return payload
        except (ValueError, json.JSONDecodeError, binascii.Error):
            return None
