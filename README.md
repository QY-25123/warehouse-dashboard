# Real-Time Warehouse Dashboard

A full-stack warehouse operations dashboard with live forklift tracking, task monitoring, inventory management, and alert notifications — all updated in real time via WebSocket.

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                         Docker Compose                          │
│                                                                 │
│  ┌──────────────┐    ┌──────────────────┐    ┌──────────────┐  │
│  │  PostgreSQL  │◄───│  FastAPI backend │◄───│  Next.js 14  │  │
│  │  (port 5432) │    │  (port 8000)     │    │  (port 3000) │  │
│  │              │    │                  │    │              │  │
│  │  schema.sql  │    │  REST endpoints  │    │  App Router  │  │
│  │  seed.sql    │    │  WebSocket /ws   │    │  TypeScript  │  │
│  │  5 tables    │    │  IoT simulator   │    │  Tailwind    │  │
│  └──────────────┘    └──────────────────┘    └──────────────┘  │
│         ▲                    │                       │          │
│         │         asyncpg    │  WS broadcast         │ browser  │
│         └────────────────────┘        ┌──────────────┘          │
│                                       │ NEXT_PUBLIC_API_URL      │
│                                       ▼ (baked at build time)   │
└─────────────────────────────────────────────────────────────────┘
```

**Data flow:**
1. Background asyncio task (2 s tick) mutates forklifts/tasks/inventory in Postgres and publishes events.
2. FastAPI broadcasts changes to all connected WebSocket clients (`/ws/events`).
3. Next.js Client Components receive WS messages and update UI state in place — no full-page refresh.
4. Server Components fetch initial data from REST endpoints at SSR time so the page is never blank.

---

## Quick start

### Prerequisites

- [Docker Desktop](https://www.docker.com/products/docker-desktop/) (or Docker Engine + Compose v2)

### Run

```bash
# Clone the repo and enter the project root
git clone <repo-url>
cd real-time-warehouse-dashboard

# (Optional) copy and edit the env file — defaults work out of the box
cp .env.example .env

# Build images and start all three services
docker compose up --build
```

The first run builds the images and seeds the database automatically.  
Subsequent runs skip seeding (the `forklifts` table is already present).

| Service    | URL                        |
|------------|----------------------------|
| Frontend   | http://localhost:3000       |
| Backend API| http://localhost:8000/docs  |
| PostgreSQL | localhost:5432              |

### Stop

```bash
docker compose down          # stop containers, keep volume
docker compose down -v       # stop containers AND delete DB volume (full reset)
```

---

## Environment variables

All variables have safe defaults so `docker compose up --build` works without a `.env` file.  
Copy `.env.example` to `.env` to customise.

### Database (`db` service)

| Variable            | Default          | Description                        |
|---------------------|------------------|------------------------------------|
| `POSTGRES_DB`       | `warehouse`      | Database name                      |
| `POSTGRES_USER`     | `warehouse_user` | Postgres user                      |
| `POSTGRES_PASSWORD` | `warehouse_pass` | Postgres password                  |
| `POSTGRES_PORT`     | `5432`           | Host port mapped to Postgres       |

### Backend (`backend` service)

The backend reads the same `POSTGRES_*` variables above (passed by Compose).

| Variable        | Default | Description                              |
|-----------------|---------|------------------------------------------|
| `BACKEND_PORT`  | `8000`  | Host port mapped to the FastAPI server   |

### Frontend (`frontend` service)

| Variable               | Default                    | Description                                                                 |
|------------------------|----------------------------|-----------------------------------------------------------------------------|
| `NEXT_PUBLIC_API_URL`  | `http://localhost:8000`    | Backend URL used by the **browser** to call the API and open WebSockets.    |
| `FRONTEND_PORT`        | `3000`                     | Host port mapped to the Next.js server                                      |

> **Note:** `NEXT_PUBLIC_API_URL` is baked into the JavaScript bundle at `docker compose build` time.  
> If you change it after building, run `docker compose build frontend` to rebuild the image.  
> For production, set it to the public URL of your backend (e.g. `https://api.example.com`).

---

## Project structure

```
.
├── schema.sql                  # PostgreSQL enums + 5 tables
├── seed.sql                    # Mock data (10 forklifts, 30 tasks, …)
├── docker-compose.yml
├── .env.example
│
├── backend/
│   ├── Dockerfile              # Build context = project root
│   ├── entrypoint.sh           # Wait for PG → init DB → start uvicorn
│   ├── requirements.txt
│   └── app/
│       ├── main.py             # FastAPI app + lifespan
│       ├── database.py         # asyncpg pool + JSONB codec
│       ├── dependencies.py
│       ├── models.py           # Pydantic v2 response models
│       ├── simulator.py        # Background IoT simulator (2 s tick)
│       ├── ws_manager.py       # WebSocket connection manager
│       └── routers/
│           ├── forklifts.py    # GET /forklifts
│           ├── tasks.py        # GET /tasks
│           ├── inventory.py    # GET /inventory
│           ├── alerts.py       # GET /alerts  PATCH /alerts/:id
│           ├── events.py       # GET /events
│           └── ws.py           # WS /ws/events
│
└── frontend/
    ├── Dockerfile              # Multi-stage: deps → builder → runner
    ├── next.config.js          # output: standalone
    ├── app/                    # Next.js App Router pages
    ├── components/             # Client components (map, tables, panels)
    ├── hooks/                  # useWebSocket (auto-reconnect)
    └── lib/                    # api.ts, types.ts
```
