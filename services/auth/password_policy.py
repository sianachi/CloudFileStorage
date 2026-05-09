from const import Constants


def validate_password(pw: str) -> list[str]:
    failures: list[str] = []

    if len(pw) < Constants.MIN_PASSWORD_LENGTH:
        failures.append(
            f"Password must be at least {Constants.MIN_PASSWORD_LENGTH} characters"
        )

    if len(pw.encode("utf-8")) > Constants.MAX_PASSWORD_BYTES:
        failures.append(
            f"Password must be at most {Constants.MAX_PASSWORD_BYTES} bytes"
        )

    if not any(c.isdigit() for c in pw):
        failures.append("Password must contain at least one digit")

    return failures
