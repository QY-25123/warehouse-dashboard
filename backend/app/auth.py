import os
from typing import Optional

import jwt
from jwt import PyJWKClient
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

_bearer = HTTPBearer()
_SUPABASE_URL = os.getenv("SUPABASE_URL", "")
_JWKS_URL = f"{_SUPABASE_URL}/auth/v1/.well-known/jwks.json"
_JWT_SECRET = os.getenv("SUPABASE_JWT_SECRET", "")
_AUDIENCE = "authenticated"

_jwks_client: PyJWKClient | None = None


def _get_jwks_client() -> PyJWKClient:
    global _jwks_client
    if _jwks_client is None:
        _jwks_client = PyJWKClient(_JWKS_URL, cache_keys=True)
    return _jwks_client


def _decode(token: str) -> dict:
    try:
        header = jwt.get_unverified_header(token)
        alg = header.get("alg", "HS256")

        if alg.startswith("ES") or alg.startswith("RS"):
            signing_key = _get_jwks_client().get_signing_key_from_jwt(token)
            return jwt.decode(
                token,
                signing_key.key,
                algorithms=[alg],
                audience=_AUDIENCE,
            )
        else:
            return jwt.decode(
                token,
                _JWT_SECRET,
                algorithms=["HS256"],
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
