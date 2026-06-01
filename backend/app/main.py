import asyncio
import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.database import create_pool
from app.ws_manager import manager as ws_manager
from app import simulator
from app.routers import forklifts, tasks, inventory, alerts, events
from app.routers import ws

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)


@asynccontextmanager
async def lifespan(app: FastAPI):
    pool = await create_pool()
    app.state.pool = pool
    sim_task = asyncio.create_task(simulator.run(pool, ws_manager))
    yield
    sim_task.cancel()
    try:
        await sim_task
    except asyncio.CancelledError:
        pass
    await pool.close()


app = FastAPI(title="Warehouse Dashboard API", version="1.0.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000"],
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


@app.get("/health")
async def health():
    return {"status": "ok"}
