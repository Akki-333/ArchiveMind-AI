"""In-memory sliding-window rate limiting.

Why this exists as its own module: sign-in was the only throttled endpoint,
while the endpoints that actually cost money - chat, upload, graph extraction -
had no limit at all. One authenticated account could exhaust a free-tier LLM
quota in a couple of minutes, and when the quota is gone every user gets a 503.
Guarding the cheap endpoint and leaving the expensive ones open is the wrong way
round.

Two deliberate properties:

* **Bounded memory.** The throttle this replaces was a plain `defaultdict(list)`
  that only shrank when a sign-in succeeded, so failed attempts against varying
  usernames grew it without limit. This prunes expired windows on write and caps
  the number of tracked keys.
* **Honest about its scope.** This is per-process. It is the right shape for the
  single-worker deployment this runs on, and it silently does nothing useful
  across multiple workers. When this app grows a second worker, move the store
  behind Redis - the call sites do not change, only `_Store`.
"""
import logging
import threading
import time
from dataclasses import dataclass, field
from typing import Dict, List, Optional, Tuple

from fastapi import HTTPException, Request, status

logger = logging.getLogger("archivemind.ratelimit")

# Above this many tracked keys the stale ones are evicted. Generous enough that
# a real deployment never reaches it, small enough that a hostile one cannot
# exhaust memory.
MAX_TRACKED_KEYS = 20_000


@dataclass
class _Store:
    """Timestamps per key, pruned as it is used."""
    hits: Dict[str, List[float]] = field(default_factory=dict)
    lock: threading.Lock = field(default_factory=threading.Lock)

    def record_and_count(self, key: str, window: float) -> Tuple[int, float]:
        """Add a hit and return (count_in_window, oldest_timestamp_in_window)."""
        now = time.time()
        cutoff = now - window
        with self.lock:
            timestamps = [t for t in self.hits.get(key, ()) if t > cutoff]
            timestamps.append(now)
            self.hits[key] = timestamps
            if len(self.hits) > MAX_TRACKED_KEYS:
                self._evict(cutoff)
            return len(timestamps), timestamps[0]

    def count(self, key: str, window: float) -> int:
        cutoff = time.time() - window
        with self.lock:
            timestamps = [t for t in self.hits.get(key, ()) if t > cutoff]
            if timestamps:
                self.hits[key] = timestamps
            else:
                self.hits.pop(key, None)
            return len(timestamps)

    def clear(self, key: str) -> None:
        with self.lock:
            self.hits.pop(key, None)

    def _evict(self, cutoff: float) -> None:
        """Drop every key whose window has fully expired; if that is not enough,
        drop the least recently active. Called with the lock already held."""
        stale = [k for k, v in self.hits.items() if not v or v[-1] <= cutoff]
        for key in stale:
            self.hits.pop(key, None)
        if len(self.hits) > MAX_TRACKED_KEYS:
            ordered = sorted(self.hits.items(), key=lambda kv: kv[1][-1])
            for key, _ in ordered[: len(self.hits) - MAX_TRACKED_KEYS]:
                self.hits.pop(key, None)
        logger.warning(
            "Rate-limit store exceeded %d keys; pruned to %d.",
            MAX_TRACKED_KEYS, len(self.hits),
        )


_stores: Dict[str, _Store] = {}
_stores_lock = threading.Lock()


def _store(bucket: str) -> _Store:
    with _stores_lock:
        if bucket not in _stores:
            _stores[bucket] = _Store()
        return _stores[bucket]


def client_key(request: Optional[Request], identity: str = "") -> str:
    """Identify the caller.

    Prefers the authenticated username, because that is the thing actually worth
    limiting - an IP is shared by everyone behind one NAT, and a determined
    caller can change it. The IP is the fallback for unauthenticated routes.
    """
    if identity:
        return f"user:{identity.lower()}"
    host = "unknown"
    if request is not None and request.client:
        host = request.client.host
    return f"ip:{host}"


def enforce(
    bucket: str,
    key: str,
    limit: int,
    window_seconds: float,
    message: str = "Too many requests. Please wait a moment and try again.",
) -> None:
    """Record a hit and raise 429 when the caller is over the limit.

    A limit of 0 or less disables the check, so any of these can be turned off
    from configuration without a code change.
    """
    if limit <= 0:
        return
    count, oldest = _store(bucket).record_and_count(key, window_seconds)
    if count > limit:
        retry_in = max(int(oldest + window_seconds - time.time()), 1)
        logger.info("Rate limit hit on '%s' for %s (%d/%d).", bucket, key, count, limit)
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail=f"{message} Try again in {retry_in}s.",
            headers={"Retry-After": str(retry_in)},
        )


def record(bucket: str, key: str, window_seconds: float) -> int:
    """Record a hit without raising. Returns the count in the window.

    Sign-in needs this separately from `enforce`: a *failed* attempt is what
    should count against you, not the act of trying, so the check and the
    record happen at different points in the handler.
    """
    count, _ = _store(bucket).record_and_count(key, window_seconds)
    return count


def peek(bucket: str, key: str, window_seconds: float) -> int:
    """Current count without recording a hit."""
    return _store(bucket).count(key, window_seconds)


def retry_after(bucket: str, key: str, window_seconds: float) -> int:
    """Seconds until the oldest hit in the window expires."""
    store = _store(bucket)
    with store.lock:
        timestamps = store.hits.get(key) or []
        if not timestamps:
            return 1
        return max(int(timestamps[0] + window_seconds - time.time()), 1)


def clear(bucket: str, key: str) -> None:
    _store(bucket).clear(key)


def reset_all() -> None:
    """Test helper. Not called from any production path."""
    with _stores_lock:
        _stores.clear()
