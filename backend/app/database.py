import json
import os
import asyncpg
from dotenv import load_dotenv

load_dotenv()


async def _init_connection(conn: asyncpg.Connection) -> None:
    await conn.set_type_codec(
        "jsonb",
        encoder=json.dumps,
        decoder=json.loads,
        schema="pg_catalog",
    )
    await conn.set_type_codec(
        "json",
        encoder=json.dumps,
        decoder=json.loads,
        schema="pg_catalog",
    )


async def create_pool() -> asyncpg.Pool:
    dsn = os.getenv("DATABASE_URL")
    if dsn:
        # Production: Supabase (or any external Postgres) via connection string
        return await asyncpg.create_pool(
            dsn=dsn,
            ssl="require",
            min_size=2,
            max_size=10,
            init=_init_connection,
        )
    # Local dev: individual env vars, no SSL
    return await asyncpg.create_pool(
        host=os.getenv("POSTGRES_HOST", "localhost"),
        port=int(os.getenv("POSTGRES_PORT", 5432)),
        database=os.getenv("POSTGRES_DB", "warehouse"),
        user=os.getenv("POSTGRES_USER", "warehouse_user"),
        password=os.getenv("POSTGRES_PASSWORD", ""),
        min_size=2,
        max_size=10,
        init=_init_connection,
    )
