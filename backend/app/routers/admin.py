import pathlib

import asyncpg
from fastapi import APIRouter, Depends, HTTPException, status

from app.auth import require_admin
from app.dependencies import get_pool
from app.models import CreateUserRequest, UserProfile
from app.supabase_admin import create_auth_user, delete_auth_user
from app import simulator

router = APIRouter(prefix="/admin", tags=["admin"])


@router.get("/users", response_model=list[UserProfile])
async def list_users(
    pool: asyncpg.Pool = Depends(get_pool),
    _user: dict = Depends(require_admin),
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

    display_name = body.display_name or body.email.split("@")[0]
    try:
        data = await create_auth_user(body.email, body.password, body.role, display_name)
    except Exception as exc:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(exc))

    user_id = data.get("id")
    row = await pool.fetchrow(
        "SELECT id::text, email, role::text, display_name, created_at "
        "FROM profiles WHERE id = $1",
        user_id,
    )
    if not row:
        raise HTTPException(status.HTTP_500_INTERNAL_SERVER_ERROR, "Profile not created by trigger")
    return dict(row)


@router.delete("/users/{user_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_user(
    user_id: str,
    _user: dict = Depends(require_admin),
):
    try:
        await delete_auth_user(user_id)
    except Exception as exc:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(exc))


# ── System reset ──────────────────────────────────────────────────────────────

def _find_seed() -> pathlib.Path:
    # Works from both local dev (project root) and Docker (/app/seed.sql).
    candidates = [
        pathlib.Path(__file__).parents[3] / "seed.sql",  # local: <project_root>/seed.sql
        pathlib.Path("/app/seed.sql"),                    # Docker container
    ]
    for p in candidates:
        if p.exists():
            return p
    raise FileNotFoundError("seed.sql not found in expected locations")


@router.post("/reset", status_code=status.HTTP_200_OK)
async def reset_system(
    pool: asyncpg.Pool = Depends(get_pool),
    _user: dict = Depends(require_admin),
):
    """
    Wipe all simulation data and restore the database to its seeded state.
    Also resets the in-memory simulator so no backend restart is needed.
    Does NOT touch the profiles/auth tables.
    """
    try:
        seed_sql = _find_seed().read_text()
    except FileNotFoundError as exc:
        raise HTTPException(status.HTTP_500_INTERNAL_SERVER_ERROR, str(exc))

    async with pool.acquire() as conn:
        async with conn.transaction():
            # Drop all simulation-generated rows; serial sequences restart from 1.
            # CASCADE covers any FK references not explicitly listed.
            await conn.execute(
                "TRUNCATE tasks, events, alerts, inventory, forklifts RESTART IDENTITY CASCADE"
            )
            # Re-seed forklifts and inventory from seed.sql.
            await conn.execute(seed_sql)

    # Wipe the simulator's in-memory caches so the next tick rebuilds cleanly.
    simulator.reset()

    return {"status": "ok"}
