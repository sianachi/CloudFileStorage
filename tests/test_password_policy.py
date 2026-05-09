from services.auth.password_policy import validate_password


def test_valid_password_returns_no_failures():
    assert validate_password("validPass1234") == []


def test_short_password_is_rejected():
    failures = validate_password("short1")
    assert any("at least" in f for f in failures)


def test_password_without_digit_is_rejected():
    failures = validate_password("noDigitsAtAllHere")
    assert any("digit" in f for f in failures)


def test_password_at_minimum_length_with_digit_passes():
    # exactly 12 characters, contains a digit
    assert validate_password("abcdefghijk1") == []


def test_oversized_password_is_rejected():
    # 73 ASCII bytes, includes a digit so only the length rule fires
    pw = "a" * 72 + "1"
    failures = validate_password(pw)
    assert any("at most" in f for f in failures)


def test_oversized_multibyte_password_is_rejected():
    # 'é' is 2 bytes in UTF-8 — 40 of them is 80 bytes, over the limit
    pw = "é" * 40 + "1"
    failures = validate_password(pw)
    assert any("at most" in f for f in failures)
