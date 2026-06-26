import asyncpg
from fastapi import APIRouter, Depends, HTTPException, status

from app.auth import get_current_user, require_admin
from app.dependencies import get_pool
from app.models import CreateUserRequest, UserProfile
from app.supabase_admin import get_supabase_admin

router = APIRouter(prefix="/admin", tags=["admin"])


@router.get("/users", response_model=list[UserProfile])
async def list_users(
    pool: asyncpg.Pool = Depends(get_pool),
    _user: dict = Depends(get_current_user),
):
    rows = await pool.fetch(
        "SELECT id::text, email, role::text, display_name, created_at "
        "FROM profiles ORDER BY created_at"
    )
    return [dict(r) for r in rows]


@router.post("/users", response_model=UserProfile, status_code=status.HTTP_201_CREATED)
async def create_user(
    body: CreateUserRequest,
    pool: asyncpg.Pool = Depends(get_pool),
    _user: dict = Depends(require_admin),
):
    if body.role not in ("admin", "operator"):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Role must be admin or operator")

    sb = get_supabase_admin()
    try:
        res = sb.auth.admin.create_user({
            "email": body.email,
            "password": body.password,
            "email_confirm": True,
            "app_metadata": {"role": body.role},
            "user_metadata": {"display_name": body.display_name or body.email.split("@")[0]},
        })
    except Exception as exc:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(exc))

    row = await pool.fetchrow(
        "SELECT id::text, email, role::text, display_name, created_at "
        "FROM profiles WHERE id = $1",
        res.user.id,
    )
    if not row:
        raise HTTPException(status.HTTP_500_INTERNAL_SERVER_ERROR, "Profile not created by trigger")
    return dict(row)


@router.delete("/users/{user_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_user(
    user_id: str,
    _user: dict = Depends(require_admin),
):
    sb = get_supabase_admin()
    try:
        sb.auth.admin.delete_user(user_id)
    except Exception as exc:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(exc))
