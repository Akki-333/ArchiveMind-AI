"""Tests for the sliding-window limiter.

This module is what stops one account draining a free-tier LLM quota and taking
the archive down for everyone else, so its edges are worth pinning: that the
limit is actually enforced, that a window really does slide, that setting a
limit to zero disables it, and that the store cannot grow without bound - the
failure mode of the login throttle it replaced.
"""
import time

import pytest
from fastapi import HTTPException

import ratelimit


def test_requests_under_the_limit_are_allowed():
    for _ in range(3):
        ratelimit.enforce("bucket", "key", limit=3, window_seconds=60)
    assert ratelimit.peek("bucket", "key", 60) == 3


def test_the_request_over_the_limit_is_rejected():
    for _ in range(3):
        ratelimit.enforce("bucket", "key", limit=3, window_seconds=60)

    with pytest.raises(HTTPException) as excinfo:
        ratelimit.enforce("bucket", "key", limit=3, window_seconds=60)

    assert excinfo.value.status_code == 429
    assert "Retry-After" in excinfo.value.headers


def test_buckets_are_independent():
    """Chatting hard must not lock you out of uploading."""
    for _ in range(3):
        ratelimit.enforce("chat", "alice", limit=3, window_seconds=60)
    ratelimit.enforce("upload", "alice", limit=3, window_seconds=60)  # must not raise


def test_keys_are_independent():
    for _ in range(3):
        ratelimit.enforce("chat", "alice", limit=3, window_seconds=60)
    ratelimit.enforce("chat", "bob", limit=3, window_seconds=60)  # must not raise


def test_the_window_slides():
    """Old hits stop counting once they fall out of the window."""
    ratelimit.enforce("bucket", "key", limit=1, window_seconds=0.05)
    with pytest.raises(HTTPException):
        ratelimit.enforce("bucket", "key", limit=1, window_seconds=0.05)

    time.sleep(0.08)
    ratelimit.enforce("bucket", "key", limit=1, window_seconds=0.05)  # must not raise


def test_a_limit_of_zero_disables_the_check():
    """Configuration must be able to turn any limit off without a code change."""
    for _ in range(50):
        ratelimit.enforce("bucket", "key", limit=0, window_seconds=60)


def test_clear_resets_a_key():
    for _ in range(3):
        ratelimit.enforce("bucket", "key", limit=3, window_seconds=60)
    ratelimit.clear("bucket", "key")
    assert ratelimit.peek("bucket", "key", 60) == 0


def test_record_counts_without_raising():
    """Sign-in needs this: a failed attempt counts, the act of trying does not."""
    for _ in range(10):
        ratelimit.record("login", "key", 60)
    assert ratelimit.peek("login", "key", 60) == 10


def test_peek_does_not_record():
    ratelimit.record("bucket", "key", 60)
    ratelimit.peek("bucket", "key", 60)
    ratelimit.peek("bucket", "key", 60)
    assert ratelimit.peek("bucket", "key", 60) == 1


def test_expired_keys_are_dropped_from_the_store():
    """The bug in the throttle this replaced: the store only ever shrank on a
    successful sign-in, so failed attempts against varying usernames grew it
    without bound."""
    ratelimit.record("bucket", "ephemeral", 0.01)
    time.sleep(0.03)
    assert ratelimit.peek("bucket", "ephemeral", 0.01) == 0

    store = ratelimit._store("bucket")
    assert "ephemeral" not in store.hits


def test_client_key_prefers_the_authenticated_identity():
    """An IP is shared by everyone behind one NAT and can be changed at will;
    the account is the thing worth limiting."""
    assert ratelimit.client_key(None, "Alice") == "user:alice"
    assert ratelimit.client_key(None, "") == "ip:unknown"


def test_retry_after_is_at_least_one_second():
    ratelimit.record("bucket", "key", 60)
    assert ratelimit.retry_after("bucket", "key", 60) >= 1
    assert ratelimit.retry_after("bucket", "missing", 60) == 1
