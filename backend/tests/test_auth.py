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
    assert auth._resolve_role_for_new_user(
        _StubSession(user_count=0), "founder"
    ) == auth.ROLE_ADMIN


def test_a_later_account_is_a_reader():
    assert auth._resolve_role_for_new_user(
        _StubSession(user_count=5), "citizen1"
    ) == auth.ROLE_USER


def test_named_admins_are_granted(monkeypatch):
    """The deployment operator's decision, made out of band."""
    monkeypatch.setattr(config, "ADMIN_USERNAMES", {"named.admin"})
    assert auth._resolve_role_for_new_user(
        _StubSession(user_count=5), "Named.Admin"
    ) == auth.ROLE_ADMIN


def test_registration_takes_no_privilege_input_at_all():
    """The property the whole role model rests on.

    `account_type` is back on the form, and that is fine: it is a profile label
    an administrator reads when deciding an access request, and
    `_resolve_role_for_new_user` does not take it as an argument, so it cannot
    influence the outcome. What must never return is `access_code` or `role` -
    a credential prompt on an anonymous form, and a client-chosen privilege.
    """
    fields = set(auth.UserRegister.model_fields)
    assert fields == {"username", "password", "full_name", "email", "account_type"}
    assert "access_code" not in fields
    assert "role" not in fields

    # The signature is the guarantee: role resolution cannot see the profile.
    import inspect

    assert set(inspect.signature(auth._resolve_role_for_new_user).parameters) == {
        "session", "username",
    }


@pytest.mark.parametrize("declared", ["citizen", "staff", "official"])
def test_every_account_type_still_resolves_to_a_reader(declared):
    """Declaring yourself an official grants nothing. It is a label."""
    assert declared in auth.ACCOUNT_TYPES
    assert auth._resolve_role_for_new_user(
        _StubSession(user_count=5), "someone"
    ) == auth.ROLE_USER


def test_an_unrecognised_account_type_falls_back_rather_than_failing():
    """A cosmetic field must never be able to fail a sign-up."""
    payload = auth.UserRegister(
        username="citizen1", password="correct1horse", account_type="wizard",
    )
    resolved = payload.account_type.strip().lower()
    assert (
        resolved if resolved in auth.ACCOUNT_TYPES else auth.DEFAULT_ACCOUNT_TYPE
    ) == auth.DEFAULT_ACCOUNT_TYPE


def test_deleting_an_account_requires_the_password():
    """Deletion is irreversible, so a token left on a shared machine must not
    be enough on its own."""
    assert set(auth.AccountDeletion.model_fields) == {"password"}


def test_an_unknown_field_in_the_payload_is_dropped_not_honoured():
    """An older client still posting role/account_type/access_code must be
    accepted, with the values discarded rather than acted on."""
    payload = auth.UserRegister(
        username="citizen1",
        password="correct1horse",
        role="admin",
        account_type="official",
        access_code="anything",
    )
    assert not hasattr(payload, "role")
    assert not hasattr(payload, "access_code")
    assert payload.username == "citizen1"


def test_the_access_request_model_carries_a_reason_and_a_code():
    """Privilege is now requested from inside the app, authenticated."""
    request = auth.AccessRequest(reason="I manage the finance archive.")
    assert request.reason == "I manage the finance archive."
    assert request.access_code == ""


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
