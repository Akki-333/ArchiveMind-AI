"""Authentication and the role model.

Design notes on the role workflow, which was the weakest part of the old system:

1. A client can never choose its own role. `POST /register` ignores any `role`
   in the body. Privilege is granted by the server or not at all.
2. Admins come from exactly three places: the `ADMIN_USERNAMES` environment
   variable, a matching `ADMIN_ACCESS_CODE` presented at sign-up, or the
   bootstrap rule that the first account created on an empty database becomes
   the administrator, so a fresh deployment is usable.
3. The sign-up form asks who you are (citizen, researcher, government
   official). That is a *request and a profile*, never a grant. Choosing
   "official" without the access code creates a reader account with a pending
   request an administrator can approve - the distinction the UI needs, without
   handing the client the decision.
4. The role in the JWT is a hint, never the authority. Every request re-reads
   the role from Neo4j, so a demotion takes effect on the next request instead
   of when a week-old token happens to expire.
5. `/auth/me` exists so the frontend can ask the server who it is talking to
   rather than trusting a value in localStorage. It also carries the profile.
6. You may edit your own profile, never your own role, username or account
   type. Preferences are self-service; identity and privilege are not.
"""
import datetime
import logging
import re
import secrets
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


EMAIL_PATTERN = re.compile(r"^[^@\s]+@[^@\s]+\.[A-Za-z]{2,}$")

# Who someone says they are. This is a *profile* field, not a permission: it
# shapes the sign-up form and tells an administrator who is asking, and that is
# all. See _resolve_role_for_new_user for what actually grants privilege.
ACCOUNT_TYPES = {"citizen", "researcher", "official"}


# --- Models ------------------------------------------------------------------
class UserRegister(BaseModel):
    """Sign-up payload.

    `role` is deliberately absent, and always has been. What is new is
    `account_type` and `access_code`, which let a government official identify
    themselves at sign-up without letting them *grant* themselves anything:
    selecting "official" is a request, and only a matching ADMIN_ACCESS_CODE
    turns that request into the admin role. Without the code the account is
    created as a reader with the request recorded for an admin to approve.

    Pydantic ignores unknown keys, so an older client that still posts `role`
    is accepted and the value silently dropped rather than honoured.
    """
    username: str = Field(min_length=3, max_length=32)
    password: str = Field(min_length=1, max_length=128)
    full_name: str = Field(default="", max_length=120)
    email: str = Field(default="", max_length=160)
    account_type: str = Field(default="citizen", max_length=20)
    organisation: str = Field(default="", max_length=160)
    designation: str = Field(default="", max_length=120)
    access_code: str = Field(default="", max_length=128)


class UserLogin(BaseModel):
    username: str
    password: str


class UserProfileUpdate(BaseModel):
    full_name: str = Field(default="", max_length=120)
    email: str = Field(default="", max_length=160)
    organisation: str = Field(default="", max_length=160)
    designation: str = Field(default="", max_length=120)


class PasswordChange(BaseModel):
    current_password: str = Field(min_length=1, max_length=128)
    new_password: str = Field(min_length=1, max_length=128)


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


def validate_email(email: str) -> str:
    cleaned = email.strip()
    if cleaned and not EMAIL_PATTERN.match(cleaned):
        raise HTTPException(status_code=400, detail="That email address is not valid.")
    return cleaned


# --- Role resolution ---------------------------------------------------------
def _resolve_role_for_new_user(
    session, username: str, account_type: str, access_code: str
) -> tuple:
    """The server decides the role. The client never gets a say.

    Returns (role, requested_role). `requested_role` is non-empty when someone
    asked for official access and could not prove it - a pending request an
    administrator can approve on the People screen, rather than a dead end.

    Three routes to admin, in priority order:
      1. Named in ADMIN_USERNAMES - the deployment operator's decision.
      2. The shared ADMIN_ACCESS_CODE, distributed out of band to officials.
      3. Bootstrap: the first account on an empty database, so a fresh
         deployment is usable at all.
    """
    if username.lower() in config.ADMIN_USERNAMES:
        logger.info("Granting admin to '%s' via ADMIN_USERNAMES.", username)
        return ROLE_ADMIN, ""

    if account_type == "official" and access_code:
        # secrets.compare_digest keeps the comparison constant-time, so the
        # code cannot be recovered a character at a time by timing the response.
        if config.ADMIN_ACCESS_CODE and secrets.compare_digest(
            access_code.strip(), config.ADMIN_ACCESS_CODE
        ):
            logger.info("Granting admin to '%s' via the official access code.", username)
            return ROLE_ADMIN, ""
        logger.info("Rejected access code from '%s'; registering as reader.", username)

    if config.BOOTSTRAP_FIRST_USER_AS_ADMIN:
        existing = session.run("MATCH (u:User) RETURN count(u) AS n").single()
        if existing and existing["n"] == 0:
            logger.info("Bootstrapping first account '%s' as admin.", username)
            return ROLE_ADMIN, ""

    # Asked to be an official but could not prove it: record the request.
    requested = ROLE_ADMIN if account_type == "official" else ""
    return ROLE_USER, requested


def _fetch_user(username: str) -> Optional[dict]:
    with neo4j_driver.session() as session:
        record = session.run(
            "MATCH (u:User {username: $username}) "
            "RETURN u.username AS username, u.role AS role, u.password_hash AS password_hash",
            username=username,
        ).single()
    return dict(record) if record else None


def _fetch_profile(username: str) -> dict:
    """Everything the settings panel shows. Missing fields read as empty, so
    accounts created before these fields existed keep working untouched."""
    with neo4j_driver.session() as session:
        record = session.run(
            """
            MATCH (u:User {username: $username})
            OPTIONAL MATCH (u)-[:UPLOADED]->(d:Document)
            OPTIONAL MATCH (u)-[:HAS_SESSION]->(s:ChatSession)
            RETURN u.username AS username, u.role AS role,
                   u.full_name AS full_name, u.email AS email,
                   u.organisation AS organisation, u.designation AS designation,
                   u.account_type AS account_type, u.requested_role AS requested_role,
                   u.created_at AS created_at,
                   count(DISTINCT d) AS documents, count(DISTINCT s) AS conversations
            """,
            username=username,
        ).single()
    if not record:
        raise HTTPException(status_code=404, detail="That account no longer exists.")
    return {
        "username": record["username"],
        "role": record["role"] or ROLE_USER,
        "full_name": record["full_name"] or "",
        "email": record["email"] or "",
        "organisation": record["organisation"] or "",
        "designation": record["designation"] or "",
        "account_type": record["account_type"] or "citizen",
        "requested_role": record["requested_role"] or "",
        "created_at": record["created_at"],
        "documents": record["documents"],
        "conversations": record["conversations"],
    }


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
    email = validate_email(user.email)

    account_type = user.account_type.strip().lower()
    if account_type not in ACCOUNT_TYPES:
        account_type = "citizen"

    if account_type == "official" and not user.organisation.strip():
        raise HTTPException(
            status_code=400,
            detail="Please name the department or organisation you represent.",
        )

    with neo4j_driver.session() as session:
        role, requested_role = _resolve_role_for_new_user(
            session, username, account_type, user.access_code
        )
        try:
            # The uniqueness constraint on User.username makes this atomic: a
            # concurrent duplicate signup fails here rather than racing through.
            session.run(
                """
                CREATE (u:User {
                    username: $username, password_hash: $password_hash, role: $role,
                    full_name: $full_name, email: $email, account_type: $account_type,
                    organisation: $organisation, designation: $designation,
                    requested_role: $requested_role, created_at: $ts
                })
                """,
                username=username,
                password_hash=get_password_hash(user.password),
                role=role,
                full_name=user.full_name.strip()[:120],
                email=email,
                account_type=account_type,
                organisation=user.organisation.strip()[:160],
                designation=user.designation.strip()[:120],
                requested_role=requested_role,
                ts=int(time.time() * 1000),
            )
        except Exception as exc:
            if "ConstraintValidation" in type(exc).__name__ or "already exists" in str(exc):
                raise HTTPException(status_code=409, detail="That username is already taken.")
            logger.exception("Registration failed for '%s'", username)
            raise HTTPException(status_code=500, detail="Could not create the account.")

    # Tell them plainly what happened. Silently downgrading someone who
    # believed they were signing up as an official is how support tickets and
    # mistrust get made.
    if requested_role:
        message = (
            "Account created as a reader. Your request for official access is "
            "pending - an administrator can approve it, or you can sign up again "
            "with a valid access code."
        )
    else:
        message = "Account created."

    return {
        "message": message,
        "access_token": create_access_token(username, role),
        "token_type": "bearer",
        "username": username,
        "role": role,
        "pending_admin_request": bool(requested_role),
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
    profile = _fetch_profile(user.username)
    profile["is_admin"] = user.is_admin
    # The role from the dependency is the one re-read from the database this
    # request; prefer it over the copy fetched a microsecond later.
    profile["role"] = user.role
    return profile


@router.put("/me")
def update_profile(
    payload: UserProfileUpdate, user: CurrentUser = Depends(get_current_user)
):
    """Edit your own profile. Note what is absent: role, username and
    account_type. Those are identity and privilege, not preferences, and a
    self-service form is exactly the wrong place to change them."""
    email = validate_email(payload.email)

    with neo4j_driver.session() as session:
        session.run(
            """
            MATCH (u:User {username: $username})
            SET u.full_name = $full_name, u.email = $email,
                u.organisation = $organisation, u.designation = $designation,
                u.updated_at = $ts
            """,
            username=user.username,
            full_name=payload.full_name.strip()[:120],
            email=email,
            organisation=payload.organisation.strip()[:160],
            designation=payload.designation.strip()[:120],
            ts=int(time.time() * 1000),
        )

    profile = _fetch_profile(user.username)
    profile["is_admin"] = user.is_admin
    return profile


@router.put("/me/password")
def change_password(
    payload: PasswordChange, user: CurrentUser = Depends(get_current_user)
):
    """Change your own password. The current one is required even though the
    caller is already authenticated: a token left behind on a shared machine
    should not be enough to lock the owner out of their own account."""
    record = _fetch_user(user.username)
    if not record or not verify_password(payload.current_password, record.get("password_hash") or ""):
        raise HTTPException(status_code=400, detail="Your current password is not correct.")

    validate_password(payload.new_password)
    if payload.new_password == payload.current_password:
        raise HTTPException(
            status_code=400, detail="The new password must differ from the current one."
        )

    with neo4j_driver.session() as session:
        session.run(
            "MATCH (u:User {username: $username}) "
            "SET u.password_hash = $hash, u.password_changed_at = $ts",
            username=user.username,
            hash=get_password_hash(payload.new_password),
            ts=int(time.time() * 1000),
        )

    logger.info("Password changed for '%s'.", user.username)
    # Existing tokens stay valid: they are signed with the server key, not with
    # the password, and forcing a re-login here would sign the user out of the
    # tab they are standing in for no security gain.
    return {"status": "success", "message": "Your password has been updated."}


@router.get("/users")
def list_users(_: CurrentUser = Depends(require_admin)):
    with neo4j_driver.session() as session:
        result = session.run(
            "MATCH (u:User) "
            "OPTIONAL MATCH (u)-[:UPLOADED]->(d:Document) "
            "RETURN u.username AS username, u.role AS role, "
            "u.created_at AS created_at, u.full_name AS full_name, "
            "u.email AS email, u.organisation AS organisation, "
            "u.designation AS designation, u.account_type AS account_type, "
            "u.requested_role AS requested_role, count(d) AS documents "
            "ORDER BY u.created_at ASC"
        )
        users = [
            {
                "username": r["username"],
                "role": r["role"] or ROLE_USER,
                "created_at": r["created_at"],
                "documents": r["documents"],
                "full_name": r["full_name"] or "",
                "email": r["email"] or "",
                "organisation": r["organisation"] or "",
                "designation": r["designation"] or "",
                "account_type": r["account_type"] or "citizen",
                # Surfacing the pending request is the whole point of recording
                # it: an admin sees who asked for official access and decides.
                "requested_role": r["requested_role"] or "",
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

        # Clearing requested_role is what makes the People screen's pending
        # badge disappear once the decision has actually been made.
        updated = session.run(
            "MATCH (u:User {username: $username}) "
            "SET u.role = $role, u.requested_role = '' "
            "RETURN u.username AS username",
            username=username,
            role=role,
        ).single()

    if not updated:
        raise HTTPException(status_code=404, detail="No such user.")

    logger.info("Role for '%s' changed to '%s' by '%s'.", username, role, admin.username)
    return {"username": username, "role": role}
