"""Tests for the role model and input validation.

`_resolve_role_for_new_user` is the single function standing between a sign-up
form and administrator access over a government archive. The original system
took the role straight from the request body, so anyone could pick "admin" from
a dropdown. These tests pin the rule that replaced it: the client asks, the
server decides.
"""
import pytest

import auth
import config


class _StubResult:
    def __init__(self, record):
        self._record = record

    def single(self):
        return self._record


class _StubSession:
    """Stands in for a Neo4j session.

    The only query `_resolve_role_for_new_user` runs is the user count for the
    bootstrap rule, so a stub is enough and the tests stay offline.
    """

    def __init__(self, user_count=1):
        self.user_count = user_count

    def run(self, *_args, **_kwargs):
        return _StubResult({"n": self.user_count})


# --- Role resolution ---------------------------------------------------------
def test_first_account_on_an_empty_database_becomes_admin():
    """The bootstrap rule, without which a fresh deployment is unusable."""
    role, requested = auth._resolve_role_for_new_user(
        _StubSession(user_count=0), "founder", "citizen", ""
    )
    assert role == auth.ROLE_ADMIN
    assert requested == ""


def test_a_later_account_is_a_reader():
    role, requested = auth._resolve_role_for_new_user(
        _StubSession(user_count=5), "citizen1", "citizen", ""
    )
    assert role == auth.ROLE_USER
    assert requested == ""


def test_claiming_to_be_an_official_grants_nothing_without_the_code():
    """The security property the sign-up form depends on. Selecting
    "Government official" is a request, never a grant."""
    role, requested = auth._resolve_role_for_new_user(
        _StubSession(user_count=5), "impostor", "official", ""
    )
    assert role == auth.ROLE_USER
    assert requested == auth.ROLE_ADMIN  # recorded for an admin to approve


def test_a_wrong_access_code_grants_nothing():
    role, requested = auth._resolve_role_for_new_user(
        _StubSession(user_count=5), "impostor", "official", "not-the-code"
    )
    assert role == auth.ROLE_USER
    assert requested == auth.ROLE_ADMIN


def test_the_correct_access_code_grants_admin():
    role, requested = auth._resolve_role_for_new_user(
        _StubSession(user_count=5), "official1", "official", config.ADMIN_ACCESS_CODE
    )
    assert role == auth.ROLE_ADMIN
    assert requested == ""


def test_an_access_code_from_a_non_official_signup_is_ignored():
    """The code only applies to someone who declared themselves an official;
    it must not become a general-purpose backdoor on every sign-up."""
    role, _ = auth._resolve_role_for_new_user(
        _StubSession(user_count=5), "citizen1", "citizen", config.ADMIN_ACCESS_CODE
    )
    assert role == auth.ROLE_USER


def test_named_admins_are_granted_regardless_of_account_type(monkeypatch):
    monkeypatch.setattr(config, "ADMIN_USERNAMES", {"named.admin"})
    role, requested = auth._resolve_role_for_new_user(
        _StubSession(user_count=5), "Named.Admin", "citizen", ""
    )
    assert role == auth.ROLE_ADMIN
    assert requested == ""


# --- Validation --------------------------------------------------------------
@pytest.mark.parametrize("password", ["short1", "alllettersnodigits", "12345678"])
def test_weak_passwords_are_rejected(password):
    with pytest.raises(Exception):
        auth.validate_password(password)


def test_a_password_with_letters_and_digits_is_accepted():
    auth.validate_password("correct1horse")  # must not raise


@pytest.mark.parametrize("username", ["ab", "has space", "has/slash", "x" * 33, ""])
def test_invalid_usernames_are_rejected(username):
    with pytest.raises(Exception):
        auth.validate_username(username)


@pytest.mark.parametrize("username", ["abc", "user.name", "user-name", "user_name"])
def test_valid_usernames_are_accepted(username):
    assert auth.validate_username(username) == username


@pytest.mark.parametrize("email", ["not-an-email", "@example.com", "user@", "a@b"])
def test_invalid_emails_are_rejected(email):
    with pytest.raises(Exception):
        auth.validate_email(email)


def test_email_is_optional():
    """Existing accounts predate the field, so blank must stay legal."""
    assert auth.validate_email("") == ""


def test_a_valid_email_is_accepted():
    assert auth.validate_email("  user@example.gov.in ") == "user@example.gov.in"


# --- Passwords ---------------------------------------------------------------
def test_password_hashing_round_trips():
    hashed = auth.get_password_hash("correct1horse")
    assert hashed != "correct1horse"
    assert auth.verify_password("correct1horse", hashed) is True
    assert auth.verify_password("wrong1horse", hashed) is False


def test_verify_password_is_safe_against_malformed_hashes():
    """A corrupted stored hash must fail closed, not raise a 500."""
    assert auth.verify_password("anything", "not-a-bcrypt-hash") is False
    assert auth.verify_password("anything", "") is False
