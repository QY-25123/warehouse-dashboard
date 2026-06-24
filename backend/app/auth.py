import os
from typing import Optional

import jwt
from fastapi import Depends, HTTPException, Request, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

_bearer = HTTPBearer()
_JWT_SECRET = os.getenv("SUPABASE_JWT_SECRET", "")
_ALGORITHM = "HS256"
_AUDIENCE = "authenticated"


def _decode(token: str) -> dict:
    try:
        return jwt.decode(
            token,
            _JWT_SECRET,
            algorithms=[_ALGORITHM],
            audience=_AUDIENCE,
        )
    except jwt.ExpiredSignatureError:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Token expired")
    except jwt.InvalidTokenError:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid token")


async def get_current_user(
    creds: HTTPAuthorizationCredentials = Depends(_bearer),
) -> dict:
    return _decode(creds.credentials)


def require_role(*roles: str):
    async def _guard(user: dict = Depends(get_current_user)) -> dict:
        user_role = (user.get("app_metadata") or {}).get("role")
        if user_role not in roles:
            raise HTTPException(status.HTTP_403_FORBIDDEN, "Insufficient permissions")
        return user
    return _guard


require_admin = require_role("admin")


def verify_ws_token(token: str) -> Optional[dict]:
    try:
        return _decode(token)
    except HTTPException:
        return None
