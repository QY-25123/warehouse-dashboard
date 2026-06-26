import os
import httpx

_SUPABASE_URL = os.getenv("SUPABASE_URL", "").rstrip("/")
_SERVICE_ROLE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY", "")


def _headers() -> dict:
    return {
        "apikey": _SERVICE_ROLE_KEY,
        "Authorization": f"Bearer {_SERVICE_ROLE_KEY}",
        "Content-Type": "application/json",
    }


async def create_auth_user(
    email: str, password: str, role: str, display_name: str
) -> dict:
    async with httpx.AsyncClient() as client:
        resp = await client.post(
            f"{_SUPABASE_URL}/auth/v1/admin/users",
            headers=_headers(),
            json={
                "email": email,
                "password": password,
                "email_confirm": True,
                "app_metadata": {"role": role},
                "user_metadata": {"display_name": display_name},
            },
            timeout=10,
        )
        if not resp.is_success:
            raise ValueError(resp.text)
        return resp.json()


async def delete_auth_user(user_id: str) -> None:
    async with httpx.AsyncClient() as client:
        resp = await client.delete(
            f"{_SUPABASE_URL}/auth/v1/admin/users/{user_id}",
            headers=_headers(),
            timeout=10,
        )
        if not resp.is_success:
            raise ValueError(resp.text)
