"""
Notion OAuth token management and MCP proxy router.

Endpoints:
  GET  /notion/status          — connection info (workspace, parent page)
  POST /notion/connect         — save tokens from frontend OAuth dance
  DELETE /notion/disconnect    — clear stored tokens
  POST /notion/search-pages    — search Notion for pages (for parent picker)
  POST /notion/set-parent      — save selected parent page
"""

import logging
from typing import Any

import asyncpg
from fastapi import APIRouter, Depends, HTTPException, status

from app.auth import get_current_user
from app.dependencies import get_pool
from app.notion_mcp_client import NotionMCPError, search_pages

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/notion", tags=["notion"])


# ── DB helpers ────────────────────────────────────────────────────────────────

async def _get_token_row(pool: asyncpg.Pool) -> asyncpg.Record | None:
    return await pool.fetchrow("SELECT * FROM notion_tokens WHERE id = 1")


# ── Routes ────────────────────────────────────────────────────────────────────

@router.get("/status")
async def get_status(
    pool: asyncpg.Pool = Depends(get_pool),
    _user: dict = Depends(get_current_user),
) -> dict[str, Any]:
    row = await _get_token_row(pool)
    if not row:
        return {"connected": False}
    return {
        "connected": True,
        "workspace_name": row["workspace_name"],
        "workspace_id": row["workspace_id"],
        "parent_page_id": row["parent_page_id"],
        "parent_page_title": row["parent_page_title"],
        "connected_at": row["connected_at"].isoformat(),
    }


@router.post("/connect", status_code=status.HTTP_201_CREATED)
async def connect(
    body: dict[str, Any],
    pool: asyncpg.Pool = Depends(get_pool),
    _user: dict = Depends(get_current_user),
) -> dict[str, Any]:
    """
    Receive the OAuth token payload from the frontend after PKCE exchange.
    Expected fields: access_token, refresh_token, workspace_id,
                     workspace_name, client_id, expires_in (optional).
    """
    access_token = body.get("access_token", "").strip()
    if not access_token:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "access_token required")

    await pool.execute(
        """
        INSERT INTO notion_tokens
          (id, access_token, refresh_token, client_id,
           workspace_id, workspace_name, connected_at)
        VALUES (1, $1, $2, $3, $4, $5, NOW())
        ON CONFLICT (id) DO UPDATE SET
          access_token   = EXCLUDED.access_token,
          refresh_token  = EXCLUDED.refresh_token,
          client_id      = EXCLUDED.client_id,
          workspace_id   = EXCLUDED.workspace_id,
          workspace_name = EXCLUDED.workspace_name,
          parent_page_id    = NULL,
          parent_page_title = NULL,
          connected_at   = NOW()
        """,
        access_token,
        body.get("refresh_token"),
        body.get("client_id"),
        body.get("workspace_id"),
        body.get("workspace_name"),
    )

    return {
        "connected": True,
        "workspace_name": body.get("workspace_name"),
        "workspace_id": body.get("workspace_id"),
    }


@router.delete("/disconnect", status_code=status.HTTP_204_NO_CONTENT)
async def disconnect(
    pool: asyncpg.Pool = Depends(get_pool),
    _user: dict = Depends(get_current_user),
):
    await pool.execute("DELETE FROM notion_tokens WHERE id = 1")


@router.post("/search-pages")
async def search_pages_proxy(
    body: dict[str, Any],
    pool: asyncpg.Pool = Depends(get_pool),
    _user: dict = Depends(get_current_user),
) -> list[dict]:
    row = await _get_token_row(pool)
    if not row:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Notion is not connected")
    try:
        pages = await search_pages(row["access_token"], body.get("query", ""))
    except NotionMCPError as exc:
        logger.error("Notion search failed: %s", exc)
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, detail=str(exc))
    return pages


@router.post("/set-parent")
async def set_parent(
    body: dict[str, Any],
    pool: asyncpg.Pool = Depends(get_pool),
    _user: dict = Depends(get_current_user),
) -> dict[str, Any]:
    page_id = body.get("page_id", "").strip()
    page_title = body.get("page_title", "").strip()
    if not page_id:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "page_id required")

    row = await pool.fetchrow(
        """
        UPDATE notion_tokens
        SET parent_page_id = $1, parent_page_title = $2
        WHERE id = 1
        RETURNING parent_page_id, parent_page_title
        """,
        page_id, page_title,
    )
    if not row:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Notion is not connected")
    return {"parent_page_id": row["parent_page_id"], "parent_page_title": row["parent_page_title"]}
