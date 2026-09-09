"""Authentication and the role model.

Design notes on the role workflow, which was the weakest part of the old system:

1. A client can never choose its own role. `POST /register` ignores any `role`
   in the body. Privilege is granted by the server or not at all.
2. Admins come from exactly three places: the `ADMIN_USERNAMES` environment
   variable, a matching `ADMIN_ACCESS_CODE` presented to `/request-access` by
   an already-authenticated user, or the bootstrap rule that the first account
   created on an empty database becomes the administrator, so a fresh
   deployment is usable.
3. Sign-up collects four fields: username, password, name, email. It used to
   also ask for an account type, a department and an "official access code" -
   a credential prompt on an anonymous form, asking someone to choose their
   privilege level before they had seen the product. Requesting administrator
   access is now a deliberate action taken from inside the application, where
   the caller is authenticated and the attempt is attributable.
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
from typing import Optional

import bcrypt
import jwt
from fastapi import APIRouter, Depends, HTTPException, Request, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from pydantic import BaseModel, Field

import config
import ratelimit
from database import neo4j_driver

logger = logging.getLogger("archivemind.auth")

router = APIRouter()
security = HTTPBearer(auto_error=True)

ROLE_ADMIN = "admin"
ROLE_USER = "user"
VALID_ROLES = {ROLE_ADMIN, ROLE_USER}

USERNAME_PATTERN = re.compile(r"^[A-Za-z0-9._-]{3,32}$")


EMAIL_PATTERN = re.compile(r"^[^@\s]+@[^@\s]+\.[A-Za-z]{2,}$")

# Who someone says they are. A *profile* field, never a permission.
#
# Collected at sign-up again, having been removed alongside the access code.
# The distinction matters: the access code was a credential prompt on an
# anonymous form and could grant privilege, so it had to go. This grants
# nothing. It is also the single most useful thing an administrator has when
# deciding an access request - a citizen and a government official are very
# different people to hand the delete button to - and asking once at sign-up
# beats asking nobody.
#
# `staff` is the person working inside a department under an official: they
# handle the documents day to day without owning what the archive contains.
ACCOUNT_TYPES = {"citizen", "staff", "official"}
DEFAULT_ACCOUNT_TYPE = "citizen"


# --- Models ------------------------------------------------------------------
class UserRegister(BaseModel):
    """Sign-up payload. Four fields, and that is the point.

    This used to also collect an account type, a department, a designation and
    an "official access code". Each asked the user to decide about *privilege*
    at the moment they know least about the product, and the access code in
    particular put a credential prompt on an unauthenticated form - which
    teaches people to type secrets into sign-up pages. Privilege is now
    requested from inside the application by someone already signed in, who can
    see what they are asking for. See `request_admin_access`.

    `role` is deliberately absent and always has been. Pydantic ignores unknown
    keys, so an older client still posting `role`, `account_type` or
    `access_code` is accepted and the values silently dropped.
    """
    username: str = Field(min_length=3, max_length=32)
    password: str = Field(min_length=1, max_length=128)
    full_name: str = Field(default="", max_length=120)
    email: str = Field(default="", max_length=160)
    # Profile, not permission. An unrecognised value falls back to the default
    # rather than being rejected, because this can never grant anything and a
    # failed sign-up over a cosmetic field would be a poor trade.
    account_type: str = Field(default=DEFAULT_ACCOUNT_TYPE, max_length=20)


class AccessRequest(BaseModel):
    """Ask for administrator access from inside the application."""
    reason: str = Field(default="", max_length=500)
    access_code: str = Field(default="", max_length=128)


class AccountDeletion(BaseModel):
    """Close your own account.

    The current password is required even though the caller is already
    authenticated. Deletion is irreversible, so a token left behind on a shared
    machine must not be enough to destroy someone's account.
    """
    password: str = Field(min_length=1, max_length=128)


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
# Backed by the shared sliding-window store. The dict this replaced only ever
# shrank on a *successful* sign-in, so a stream of failures against varying
# usernames grew it without bound - slow memory exhaustion driven from an
# unauthenticated endpoint. `ratelimit` prunes expired windows and caps the
# number of tracked keys.
#
# The semantics are unusual enough to keep as three separate calls: a *failed*
# attempt counts against you, the act of trying does not, so the check and the
# record happen at different points in the handler.
_LOGIN_BUCKET = "login"


def _throttle_key(request: Request, username: str) -> str:
    client = request.client.host if request.client else "unknown"
    return f"{client}:{username.lower()}"


def check_login_rate(request: Request, username: str) -> None:
    key = _throttle_key(request, username)
    attempts = ratelimit.peek(_LOGIN_BUCKET, key, config.LOGIN_WINDOW_SECONDS)
    if attempts >= config.LOGIN_MAX_ATTEMPTS:
        retry_in = ratelimit.retry_after(_LOGIN_BUCKET, key, config.LOGIN_WINDOW_SECONDS)
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail=f"Too many sign-in attempts. Try again in {retry_in} seconds.",
            headers={"Retry-After": str(retry_in)},
        )


def record_failed_login(request: Request, username: str) -> None:
    ratelimit.record(
        _LOGIN_BUCKET, _throttle_key(request, username), config.LOGIN_WINDOW_SECONDS
    )


def clear_login_attempts(request: Request, username: str) -> None:
    ratelimit.clear(_LOGIN_BUCKET, _throttle_key(request, username))


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
def _resolve_role_for_new_user(session, username: str) -> str:
    """The server decides the role. The client never gets a say.

    Two routes to admin, and neither involves anything the sign-up form
    collects:
      1. Named in ADMIN_USERNAMES - the deployment operator's decision.
      2. Bootstrap: the first account on an empty database, so a fresh
         deployment is usable at all.

    The access code used to be a third route, checked here against a field on
    the registration form. It moved to `request_admin_access`, where the caller
    is authenticated. That is a better place for it in two ways: an anonymous
    endpoint can no longer be used to guess the code, and a person asking for
    privilege has already seen what the product does.
    """
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
                   u.requested_at AS requested_at,
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
        "requested_at": record["requested_at"],
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
        account_type = DEFAULT_ACCOUNT_TYPE

    with neo4j_driver.session() as session:
        role = _resolve_role_for_new_user(session, username)
        try:
            # The uniqueness constraint on User.username makes this atomic: a
            # concurrent duplicate signup fails here rather than racing through.
            session.run(
                """
                CREATE (u:User {
                    username: $username, password_hash: $password_hash, role: $role,
                    full_name: $full_name, email: $email, account_type: $account_type,
                    organisation: '', designation: '', requested_role: '',
                    created_at: $ts
                })
                """,
                username=username,
                password_hash=get_password_hash(user.password),
                role=role,
                full_name=user.full_name.strip()[:120],
                email=email,
                account_type=account_type,
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


@router.delete("/me")
def delete_own_account(
    payload: AccountDeletion, user: CurrentUser = Depends(get_current_user)
):
    """Close your own account. Available to everyone, administrators included.

    Three things have to be right here, and the middle one is the subtle one.

    **The password is required.** Deletion is irreversible, so a token left on
    a shared machine must not be enough to destroy an account.

    **Uploaded documents are transferred, not deleted.** The archive is shared:
    `get_user_documents` reaches documents through
    `(owner:User)-[:UPLOADED]->(:Document)`, so detaching a user who had
    uploaded anything would leave those documents orphaned and they would
    silently vanish from every other user's view - the chunks and vectors still
    on disk, the documents simply gone. They are re-pointed at the
    longest-serving remaining administrator instead.

    **The last administrator cannot leave.** An archive nobody can administer
    is one where no document can ever be added or removed again. This mirrors
    the existing guard on role changes.
    """
    record = _fetch_user(user.username)
    if not record or not verify_password(payload.password, record.get("password_hash") or ""):
        raise HTTPException(status_code=400, detail="That password is not correct.")

    with neo4j_driver.session() as session:
        successor = None
        if user.is_admin:
            remaining = session.run(
                "MATCH (u:User) WHERE u.role = 'admin' AND u.username <> $username "
                "RETURN u.username AS username ORDER BY coalesce(u.created_at, 0) ASC "
                "LIMIT 1",
                username=user.username,
            ).single()
            if not remaining:
                raise HTTPException(
                    status_code=400,
                    detail="You are the last administrator. Promote someone else "
                           "before deleting your account.",
                )
            successor = remaining["username"]

        owned = session.run(
            "MATCH (u:User {username: $username})-[:UPLOADED]->(d:Document) "
            "RETURN count(d) AS n",
            username=user.username,
        ).single()
        document_count = (owned["n"] if owned else 0) or 0

        if document_count:
            if not successor:
                # A reader with documents should not be possible - only admins
                # can ingest - but if a demoted admin still owns some, hand them
                # to an administrator rather than orphaning them.
                fallback = session.run(
                    "MATCH (u:User) WHERE u.role = 'admin' AND u.username <> $username "
                    "RETURN u.username AS username ORDER BY coalesce(u.created_at, 0) ASC "
                    "LIMIT 1",
                    username=user.username,
                ).single()
                if not fallback:
                    raise HTTPException(
                        status_code=400,
                        detail="Your uploaded documents have nowhere to go. Ask an "
                               "administrator to take them over first.",
                    )
                successor = fallback["username"]

            session.run(
                """
                MATCH (old:User {username: $username})-[r:UPLOADED]->(d:Document)
                MATCH (new:User {username: $successor})
                MERGE (new)-[:UPLOADED]->(d)
                DELETE r
                """,
                username=user.username, successor=successor,
            )
            logger.info(
                "Transferred %d document(s) from '%s' to '%s' on account deletion.",
                document_count, user.username, successor,
            )

        # Conversations are private, so they go with the person.
        session.run(
            """
            MATCH (u:User {username: $username})-[:HAS_SESSION]->(s:ChatSession)
            OPTIONAL MATCH (s)-[:HAS_MESSAGE]->(m:Message)
            DETACH DELETE m, s
            """,
            username=user.username,
        )
        session.run("MATCH (u:User {username: $username}) DETACH DELETE u",
                    username=user.username)

    logger.info("Account '%s' deleted at the owner's request.", user.username)
    return {
        "status": "deleted",
        "documents_transferred": document_count,
        "transferred_to": successor,
        "message": "Your account has been deleted.",
    }


# --- Administrator access requests -------------------------------------------
@router.post("/request-access")
def request_admin_access(
    payload: AccessRequest, user: CurrentUser = Depends(get_current_user)
):
    """Ask for administrator access, from inside the application.

    This replaces the "Government official" choice on the sign-up form. Two
    things improve by moving it here. The access code is now checked behind
    authentication, so it cannot be guessed from an anonymous endpoint and the
    attempt is attributable. And the person asking has used the product, so
    they know what they are asking for rather than picking a role off a
    dropdown before they have seen a single document.

    A correct code grants the role immediately; anything else records a pending
    request for an administrator to decide on.
    """
    if user.is_admin:
        raise HTTPException(status_code=400, detail="You already have administrator access.")

    code = payload.access_code.strip()
    now = int(time.time() * 1000)

    # secrets.compare_digest keeps this constant-time, so the code cannot be
    # recovered a character at a time by timing the response.
    if code and config.ADMIN_ACCESS_CODE and secrets.compare_digest(
        code, config.ADMIN_ACCESS_CODE
    ):
        with neo4j_driver.session() as session:
            session.run(
                "MATCH (u:User {username: $username}) "
                "SET u.role = $role, u.requested_role = '', u.request_reason = '', "
                "    u.requested_at = null",
                username=user.username, role=ROLE_ADMIN,
            )
        logger.info("Granted admin to '%s' via the access code.", user.username)
        return {
            "status": "granted",
            "role": ROLE_ADMIN,
            "message": "Administrator access granted. Reload to see the admin tools.",
        }

    if code:
        # Wrong code. Record the request anyway rather than dead-ending them,
        # but do not say which half was wrong.
        logger.info("Rejected access code from '%s'; recording a request.", user.username)

    with neo4j_driver.session() as session:
        session.run(
            """
            MATCH (u:User {username: $username})
            SET u.requested_role = $role, u.request_reason = $reason,
                u.requested_at = $ts
            """,
            username=user.username, role=ROLE_ADMIN,
            reason=payload.reason.strip()[:500], ts=now,
        )

    logger.info("Access request recorded for '%s'.", user.username)
    return {
        "status": "pending",
        "role": user.role,
        "message": "Your request has been sent. An administrator will review it.",
    }


@router.delete("/request-access")
def withdraw_admin_access_request(user: CurrentUser = Depends(get_current_user)):
    """Change your mind. A request you cannot withdraw is a request you regret."""
    with neo4j_driver.session() as session:
        session.run(
            "MATCH (u:User {username: $username}) "
            "SET u.requested_role = '', u.request_reason = '', u.requested_at = null",
            username=user.username,
        )
    return {"status": "withdrawn"}


@router.get("/access-requests")
def list_access_requests(_: CurrentUser = Depends(require_admin)):
    """Pending requests, newest first. Drives the admin notification badge.

    Kept separate from `/users` so the notification can poll something small
    and cheap rather than pulling the whole directory every minute.
    """
    with neo4j_driver.session() as session:
        rows = session.run(
            """
            MATCH (u:User)
            WHERE u.requested_role = $role
            RETURN u.username AS username, u.full_name AS full_name,
                   u.email AS email, u.organisation AS organisation,
                   u.designation AS designation, u.request_reason AS reason,
                   u.account_type AS account_type, u.requested_at AS requested_at
            ORDER BY coalesce(u.requested_at, 0) DESC
            """,
            role=ROLE_ADMIN,
        )
        requests = [
            {
                "username": r["username"],
                "full_name": r["full_name"] or "",
                "email": r["email"] or "",
                "organisation": r["organisation"] or "",
                "designation": r["designation"] or "",
                # The whole reason account_type is collected at sign-up: it is
                # what an administrator weighs when deciding this request.
                # Returning the requests without it made the field decorative.
                "account_type": r["account_type"] or DEFAULT_ACCOUNT_TYPE,
                "reason": r["reason"] or "",
                "requested_at": r["requested_at"],
            }
            for r in rows
        ]
    return {"requests": requests, "count": len(requests)}


@router.post("/access-requests/{username}/decline")
def decline_access_request(
    username: str, admin: CurrentUser = Depends(require_admin)
):
    """Clear a request without granting it.

    Declining and approving must both be possible from the notification, or
    the badge never goes down and an administrator learns to ignore it.
    """
    with neo4j_driver.session() as session:
        updated = session.run(
            "MATCH (u:User {username: $username}) "
            "SET u.requested_role = '', u.request_reason = '', u.requested_at = null "
            "RETURN u.username AS username",
            username=username,
        ).single()

    if not updated:
        raise HTTPException(status_code=404, detail="No such user.")

    logger.info("Access request from '%s' declined by '%s'.", username, admin.username)
    return {"status": "declined", "username": username}


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
            "SET u.role = $role, u.requested_role = '', u.request_reason = '', "
            "    u.requested_at = null "
            "RETURN u.username AS username",
            username=username,
            role=role,
        ).single()

    if not updated:
        raise HTTPException(status_code=404, detail="No such user.")

    logger.info("Role for '%s' changed to '%s' by '%s'.", username, role, admin.username)
    return {"username": username, "role": role}
