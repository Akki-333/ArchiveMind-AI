"""Authentication and the role model.

Design notes on the role workflow, which was the weakest part of the old system:

1. A client can never choose its own role. `POST /register` ignores any `role`
   in the body. Privilege is granted by the server or not at all.
2. Admins come from exactly two places: the `ADMIN_USERNAMES` environment
   variable, or the bootstrap rule that the first account created on an empty
   database becomes the administrator, so a fresh deployment is usable.
3. The role in the JWT is a hint, never the authority. Every request re-reads
   the role from Neo4j, so a demotion takes effect on the next request instead
   of when a week-old token happens to expire.
4. `/auth/me` exists so the frontend can ask the server who it is talking to
   rather than trusting a value in localStorage.
"""
import datetime
import logging
import re
import time
import uuid
from collections import defaultdict
from typing import Optional

import bcrypt
import jwt
from fastapi import APIRouter, Depends, HTTPException, Request, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from pydantic import BaseModel, Field

import config
from database import neo4j_driver

logger = logging.getLogger("archivemind.auth")

router = APIRouter()
security = HTTPBearer(auto_error=True)

ROLE_ADMIN = "admin"
ROLE_USER = "user"
VALID_ROLES = {ROLE_ADMIN, ROLE_USER}

USERNAME_PATTERN = re.compile(r"^[A-Za-z0-9._-]{3,32}$")


# --- Models ------------------------------------------------------------------
class UserRegister(BaseModel):
    username: str = Field(min_length=3, max_length=32)
    password: str = Field(min_length=1, max_length=128)
    # `role` is deliberately absent. Pydantic ignores unknown keys by default,
    # so an older frontend that still sends one is accepted and the value
    # silently dropped rather than honoured.


class UserLogin(BaseModel):
    username: str
    password: str


class RoleUpdate(BaseModel):
    role: str


class CurrentUser(BaseModel):
    username: str
    role: str

    @property
    def is_admin(self) -> bool:
        return self.role == ROLE_ADMIN


# --- Password handling -------------------------------------------------------
def get_password_hash(password: str) -> str:
    return bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")


def verify_password(plain: str, hashed: str) -> bool:
    try:
        return bcrypt.checkpw(plain.encode("utf-8"), hashed.encode("utf-8"))
    except (ValueError, TypeError):
        return False


def validate_password(password: str) -> None:
    if len(password) < config.MIN_PASSWORD_LENGTH:
        raise HTTPException(
            status_code=400,
            detail=f"Password must be at least {config.MIN_PASSWORD_LENGTH} characters.",
        )
    if password.isdigit() or password.isalpha():
        raise HTTPException(
            status_code=400,
            detail="Password must contain both letters and numbers.",
        )


def validate_username(username: str) -> str:
    cleaned = username.strip()
    if not USERNAME_PATTERN.match(cleaned):
        raise HTTPException(
            status_code=400,
            detail="Username must be 3-32 characters using letters, numbers, dot, dash or underscore.",
        )
    return cleaned


# --- Login throttling --------------------------------------------------------
# In-memory sliding window, which matches the single-process deployment. A
# multi-worker setup would move this to Redis.
_login_attempts: dict = defaultdict(list)


def _throttle_key(request: Request, username: str) -> str:
    client = request.client.host if request.client else "unknown"
    return f"{client}:{username.lower()}"


def check_login_rate(request: Request, username: str) -> None:
    key = _throttle_key(request, username)
    now = time.time()
    window_start = now - config.LOGIN_WINDOW_SECONDS
    attempts = [t for t in _login_attempts[key] if t > window_start]
    _login_attempts[key] = attempts
    if len(attempts) >= config.LOGIN_MAX_ATTEMPTS:
        retry_in = int(attempts[0] + config.LOGIN_WINDOW_SECONDS - now)
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail=f"Too many sign-in attempts. Try again in {max(retry_in, 1)} seconds.",
        )


def record_failed_login(request: Request, username: str) -> None:
    _login_attempts[_throttle_key(request, username)].append(time.time())


def clear_login_attempts(request: Request, username: str) -> None:
    _login_attempts.pop(_throttle_key(request, username), None)


# --- Tokens ------------------------------------------------------------------
def create_access_token(username: str, role: str) -> str:
    now = datetime.datetime.now(datetime.timezone.utc)
    payload = {
        "sub": username,
        "role": role,
        "iat": now,
        "exp": now + datetime.timedelta(hours=config.JWT_EXPIRY_HOURS),
        "jti": str(uuid.uuid4()),
    }
    return jwt.encode(payload, config.JWT_SECRET, algorithm=config.JWT_ALGORITHM)


# --- Role resolution ---------------------------------------------------------
def _resolve_role_for_new_user(session, username: str) -> str:
    """The server decides the role. The client never gets a say."""
    if username.lower() in config.ADMIN_USERNAMES:
        logger.info("Granting admin to '%s' via ADMIN_USERNAMES.", username)
        return ROLE_ADMIN

    if config.BOOTSTRAP_FIRST_USER_AS_ADMIN:
        existing = session.run("MATCH (u:User) RETURN count(u) AS n").single()
        if existing and existing["n"] == 0:
            logger.info("Bootstrapping first account '%s' as admin.", username)
            return ROLE_ADMIN

    return ROLE_USER


def _fetch_user(username: str) -> Optional[dict]:
    with neo4j_driver.session() as session:
        record = session.run(
            "MATCH (u:User {username: $username}) "
            "RETURN u.username AS username, u.role AS role, u.password_hash AS password_hash",
            username=username,
        ).single()
    return dict(record) if record else None


# --- Dependencies ------------------------------------------------------------
def get_current_user(
    credentials: HTTPAuthorizationCredentials = Depends(security),
) -> CurrentUser:
    """Decode the token, then re-read the role from the database.

    Re-reading is the point: the token says who you are, the database says what
    you may do. A stale or tampered role claim cannot escalate anything.
    """
    try:
        payload = jwt.decode(
            credentials.credentials,
            config.JWT_SECRET,
            algorithms=[config.JWT_ALGORITHM],
        )
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail="Session expired. Please sign in again.")
    except jwt.PyJWTError:
        raise HTTPException(status_code=401, detail="Invalid authentication credentials.")

    username = payload.get("sub")
    if not username:
        raise HTTPException(status_code=401, detail="Invalid authentication credentials.")

    user = _fetch_user(username)
    if not user:
        raise HTTPException(status_code=401, detail="This account no longer exists.")

    role = user.get("role") or ROLE_USER
    if role not in VALID_ROLES:
        role = ROLE_USER
    return CurrentUser(username=user["username"], role=role)


def require_admin(user: CurrentUser = Depends(get_current_user)) -> CurrentUser:
    """Gate for every write that changes the shared archive."""
    if not user.is_admin:
        raise HTTPException(
            status_code=403,
            detail="Administrator access is required for this action.",
        )
    return user


# --- Routes ------------------------------------------------------------------
@router.post("/register", status_code=201)
def register_user(user: UserRegister):
    username = validate_username(user.username)
    validate_password(user.password)

    with neo4j_driver.session() as session:
        role = _resolve_role_for_new_user(session, username)
        try:
            # The uniqueness constraint on User.username makes this atomic: a
            # concurrent duplicate signup fails here rather than racing through.
            session.run(
                "CREATE (u:User {username: $username, password_hash: $password_hash, "
                "role: $role, created_at: $ts})",
                username=username,
                password_hash=get_password_hash(user.password),
                role=role,
                ts=int(time.time() * 1000),
            )
        except Exception as exc:
            if "ConstraintValidation" in type(exc).__name__ or "already exists" in str(exc):
                raise HTTPException(status_code=409, detail="That username is already taken.")
            logger.exception("Registration failed for '%s'", username)
            raise HTTPException(status_code=500, detail="Could not create the account.")

    return {
        "message": "Account created.",
        "access_token": create_access_token(username, role),
        "token_type": "bearer",
        "username": username,
        "role": role,
    }


@router.post("/login")
def login_user(request: Request, user: UserLogin):
    username = user.username.strip()
    check_login_rate(request, username)

    record = _fetch_user(username)
    if not record or not verify_password(user.password, record.get("password_hash") or ""):
        record_failed_login(request, username)
        # Identical message either way: never reveal which half was wrong.
        raise HTTPException(status_code=401, detail="Incorrect username or password.")

    clear_login_attempts(request, username)
    role = record.get("role") or ROLE_USER
    return {
        "access_token": create_access_token(record["username"], role),
        "token_type": "bearer",
        "username": record["username"],
        "role": role,
    }


@router.get("/me")
def read_current_user(user: CurrentUser = Depends(get_current_user)):
    """Server-authoritative identity. The frontend calls this on boot instead of
    trusting the role it cached in localStorage."""
    return {"username": user.username, "role": user.role, "is_admin": user.is_admin}


@router.get("/users")
def list_users(_: CurrentUser = Depends(require_admin)):
    with neo4j_driver.session() as session:
        result = session.run(
            "MATCH (u:User) "
            "OPTIONAL MATCH (u)-[:UPLOADED]->(d:Document) "
            "RETURN u.username AS username, u.role AS role, "
            "u.created_at AS created_at, count(d) AS documents "
            "ORDER BY u.created_at ASC"
        )
        users = [
            {
                "username": r["username"],
                "role": r["role"] or ROLE_USER,
                "created_at": r["created_at"],
                "documents": r["documents"],
            }
            for r in result
        ]
    return {"users": users}


@router.put("/users/{username}/role")
def update_user_role(
    username: str,
    payload: RoleUpdate,
    admin: CurrentUser = Depends(require_admin),
):
    role = payload.role.strip().lower()
    if role not in VALID_ROLES:
        raise HTTPException(
            status_code=400,
            detail=f"Role must be one of: {', '.join(sorted(VALID_ROLES))}.",
        )

    if username == admin.username and role != ROLE_ADMIN:
        raise HTTPException(
            status_code=400,
            detail="You cannot remove your own administrator access.",
        )

    with neo4j_driver.session() as session:
        if role == ROLE_USER:
            remaining = session.run(
                "MATCH (u:User) WHERE u.role = 'admin' AND u.username <> $username "
                "RETURN count(u) AS n",
                username=username,
            ).single()
            if remaining and remaining["n"] == 0:
                raise HTTPException(
                    status_code=400,
                    detail="This is the last administrator. Promote someone else first.",
                )

        updated = session.run(
            "MATCH (u:User {username: $username}) SET u.role = $role "
            "RETURN u.username AS username",
            username=username,
            role=role,
        ).single()

    if not updated:
        raise HTTPException(status_code=404, detail="No such user.")

    logger.info("Role for '%s' changed to '%s' by '%s'.", username, role, admin.username)
    return {"username": username, "role": role}
