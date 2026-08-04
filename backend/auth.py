from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel
import bcrypt
import jwt
import datetime
import os
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from database import neo4j_driver

router = APIRouter()
security = HTTPBearer()

SECRET_KEY = os.getenv("JWT_SECRET", "archivemind-super-secret-key-2026")
ALGORITHM = "HS256"

class UserRegister(BaseModel):
    username: str
    password: str
    role: str = "user"

class UserLogin(BaseModel):
    username: str
    password: str

def get_password_hash(password):
    salt = bcrypt.gensalt()
    return bcrypt.hashpw(password.encode('utf-8'), salt).decode('utf-8')

def verify_password(plain_password, hashed_password):
    return bcrypt.checkpw(plain_password.encode('utf-8'), hashed_password.encode('utf-8'))

def create_access_token(data: dict):
    to_encode = data.copy()
    expire = datetime.datetime.utcnow() + datetime.timedelta(days=7)
    to_encode.update({"exp": expire})
    encoded_jwt = jwt.encode(to_encode, SECRET_KEY, algorithm=ALGORITHM)
    return encoded_jwt

@router.post("/register")
async def register_user(user: UserRegister):
    with neo4j_driver.session() as session:
        # Check if exists
        result = session.run("MATCH (u:User {username: $username}) RETURN u", username=user.username)
        if result.single():
            raise HTTPException(status_code=400, detail="Username already registered")
        
        # Create user
        hashed_password = get_password_hash(user.password)
        session.run("CREATE (u:User {username: $username, password_hash: $password_hash, role: $role})", 
                    username=user.username, password_hash=hashed_password, role=user.role)
        
        access_token = create_access_token(data={"sub": user.username, "role": user.role})
        return {"message": "User created successfully", "access_token": access_token, "token_type": "bearer", "username": user.username, "role": user.role}

@router.post("/login")
async def login_user(user: UserLogin):
    with neo4j_driver.session() as session:
        result = session.run("MATCH (u:User {username: $username}) RETURN u", username=user.username)
        record = result.single()
        
        if not record:
            raise HTTPException(status_code=401, detail="Invalid username or password")
            
        user_node = record["u"]
        if not verify_password(user.password, user_node["password_hash"]):
            raise HTTPException(status_code=401, detail="Invalid username or password")
            
        role = user_node.get("role", "user")
        access_token = create_access_token(data={"sub": user.username, "role": role})
        return {"access_token": access_token, "token_type": "bearer", "username": user.username, "role": role}

def get_current_user(credentials: HTTPAuthorizationCredentials = Depends(security)):
    token = credentials.credentials
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        username: str = payload.get("sub")
        if username is None:
            raise HTTPException(status_code=401, detail="Invalid authentication credentials")
        return username
    except jwt.PyJWTError:
        raise HTTPException(status_code=401, detail="Invalid authentication credentials")
