import asyncio
import logging
import os
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware

from app.database import create_pool
from app.ws_manager import manager as ws_manager
from app import simulator
from app.routers import forklifts, tasks, inventory, alerts, events
from app.routers import ws, admin, analytics, ai_workflow, telegram_bot

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)


@asynccontextmanager
async def lifespan(app: FastAPI):
    pool = await create_pool()
    app.state.pool = pool
    sim_task = asyncio.create_task(simulator.run(pool, ws_manager))

    poll_task = None
    if os.getenv("TELEGRAM_USE_POLLING", "").lower() in ("1", "true", "yes"):
        from app.routers.telegram_bot import run_polling  # noqa: PLC0415
        poll_task = asyncio.create_task(run_polling(pool))

    yield

    sim_task.cancel()
    try:
        await sim_task
    except asyncio.CancelledError:
        pass

    if poll_task:
        poll_task.cancel()
        try:
            await poll_task
        except asyncio.CancelledError:
            pass

    await pool.close()


app = FastAPI(title="Warehouse Dashboard API", version="1.0.0", lifespan=lifespan)
app.add_middleware(GZipMiddleware, minimum_size=500)

_cors_raw = os.getenv("CORS_ORIGINS", "http://localhost:3000")
_cors_origins = [o.strip() for o in _cors_raw.split(",") if o.strip()]

app.add_middleware(
    CORSMiddleware,
    allow_origins=_cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(forklifts.router)
app.include_router(tasks.router)
app.include_router(inventory.router)
app.include_router(alerts.router)
app.include_router(events.router)
app.include_router(ws.router)
app.include_router(admin.router)
app.include_router(analytics.router)
app.include_router(ai_workflow.router)
app.include_router(telegram_bot.router)


@app.get("/health")
async def health():
    return {"status": "ok"}
