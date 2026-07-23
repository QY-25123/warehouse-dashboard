# Real-Time Warehouse Dashboard

A full-stack warehouse operations dashboard with live forklift tracking, task monitoring, inventory management, alert notifications, an AI task planner, Telegram bot integration, and Google Sheets sync — all updated in real time via WebSocket.

---

## Table of Contents

- [Features](#features)
- [Architecture](#architecture)
- [Tech Stack](#tech-stack)
- [Database Schema](#database-schema)
- [API Reference](#api-reference)
- [Quick Start](#quick-start)
- [Environment Variables](#environment-variables)
- [Project Structure](#project-structure)
- [Authentication & Roles](#authentication--roles)
- [Integrations](#integrations)

---

## Features

### Core Dashboard Pages

| Page | Description |
|------|-------------|
| **Dashboard** | KPI summary cards + throughput chart |
| **Forklifts** | Live SVG map (4×4 zone grid A1–D4) + traffic heatmap with color-intensity overlay |
| **Tasks** | Real-time task table with status filter strip (Pending / In-Progress / Completed / Delayed) |
| **Inventory** | Zone-filtered inventory with out-of-stock (red) and low-stock (yellow, ≤10 units) badges |
| **Alerts** | Severity-filtered alert panel (info / warning / critical) with one-click resolve |
| **Events** | Live event log with type filter and color-coded badges |
| **AI Tasks** | Natural-language task planner powered by Claude — generates and executes forklift assignment plans |
| **Telegram** | Conversational AI bot dashboard — view sessions, message history, and plan approval states |
| **Admin → Users** | User management panel (admin only) — view roles and manage operator accounts |

### Real-Time Updates

All data pages receive live pushes from the backend via a single persistent WebSocket connection (`/ws/events`). Messages are batched into one frame per 2-second tick to minimise network traffic. On reconnect, the hook automatically retries with exponential backoff.

WebSocket message types:
- `forklift_update` — position, status, zone changes (only if moved ≥1 SVG unit)
- `task_update` — status transitions
- `inventory_update` — quantity changes
- `alert` — new alerts from threshold checks
- `batch` — multiple messages wrapped in a single frame

### Background Simulator

A background asyncio task ticks every 2 seconds and simulates warehouse activity:
- Advances forklift positions along assigned routes
- Transitions task statuses (pending → in-progress → completed)
- Updates inventory quantities for inbound/outbound/replenishment tasks
- Inserts warehouse events into the events table
- Checks alert thresholds: forklift inactivity, delayed tasks, and zero-stock items
- Cleans up events older than 2 hours every ~15 minutes (300 ticks)

### AI Task Planner (Claude)

Accessible at `/ai`. Operators describe a warehouse task in plain English — Claude parses the intent, queries available forklifts and inventory, calculates the optimal forklift-to-trip assignment based on per-forklift capacity settings, and returns a structured plan with:

- Task type (inbound / outbound / relocation / replenishment)
- Items, zones, and quantities
- Per-forklift trip breakdown with distance-to-pickup and estimated completion time
- Insufficient-stock warnings with adjusted quantities

Admins can review and approve the plan, which then creates task rows that the simulator picks up automatically. Admins can also configure per-forklift capacity limits from the same page.

### Telegram Bot

A conversational Telegram bot lets warehouse staff request tasks from their phones. The bot maintains per-user session state (`idle → chatting → generating → awaiting_plan_approval → executing`) and uses Claude to parse requests and generate plans. The dashboard's `/telegram` page shows all active sessions, full message history, and pending plans awaiting approval.

### Google Sheets Integration

When `GOOGLE_SHEET_ID` and `GOOGLE_OAUTH_JSON` are set, a background poller runs every 60 seconds and:
1. Reads rows with `Status = Pending` from the configured sheet.
2. Validates item names, task types, quantities, and required zones.
3. Computes an AI-generated forklift plan for each row.
4. Creates tasks in the database tagged with `source = 'google_sheets'`.
5. Writes `Status = Completed`, the assigned forklift names, and a completion timestamp back to the sheet once all tasks for that row finish.

Expected sheet columns: `Item Name`, `Task Type`, `Quantity`, `Origin Zone`, `Destination Zone`, `Status`, `Assigned Forklift`, `Completed At`.

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────────────┐
│                            Docker Compose                               │
│                                                                         │
│  ┌──────────────┐    ┌────────────────────────┐    ┌─────────────────┐  │
│  │  PostgreSQL  │◄───│    FastAPI backend      │◄───│  Next.js 14     │  │
│  │  (port 5432) │    │    (port 8000)          │    │  (port 3000)    │  │
│  │              │    │                         │    │                 │  │
│  │  schema.sql  │    │  REST endpoints         │    │  App Router     │  │
│  │  seed.sql    │    │  WebSocket /ws/events   │    │  TypeScript     │  │
│  │  10 tables   │    │  IoT simulator (2s)     │    │  Tailwind CSS   │  │
│  │              │    │  Sheets poller (60s)    │    │  Supabase Auth  │  │
│  │  Supabase    │    │  Telegram bot (polling) │    │                 │  │
│  │  Auth layer  │    │  Claude AI planner      │    │                 │  │
│  └──────────────┘    └────────────────────────┘    └─────────────────┘  │
│         ▲                       │                          │             │
│         │    asyncpg            │  WS batch frames         │  browser    │
│         └───────────────────────┘        ┌─────────────────┘             │
│                                          │ NEXT_PUBLIC_API_URL            │
│                                          ▼ (baked at build time)         │
└─────────────────────────────────────────────────────────────────────────┘
```

**Data flow:**

1. The background asyncio simulator (2 s tick) mutates forklifts / tasks / inventory in Postgres and inserts events.
2. FastAPI batches all per-tick WebSocket messages into a single frame and broadcasts to all connected clients (`/ws/events`).
3. Next.js Client Components receive WS messages and update local state in place — no full-page refresh required.
4. Next.js Server Components fetch initial data from REST endpoints at SSR time so pages are never blank on first load.
5. The Google Sheets poller and Telegram bot each run as independent asyncio tasks within the same FastAPI process.

---

## Tech Stack

### Backend

| Library | Version | Purpose |
|---------|---------|---------|
| FastAPI | 0.115.5 | Async web framework + OpenAPI docs |
| Uvicorn | 0.32.1 | ASGI server |
| asyncpg | 0.30.0 | Async PostgreSQL driver with JSONB codec |
| Pydantic | 2.10.3 | Request/response validation |
| PyJWT + cryptography | 2.9.0 / 44.0.0 | JWT verification (HS256 and ES/RS algorithms) |
| supabase | 2.13.0 | Supabase admin SDK (user management) |
| anthropic | ≥0.40.0 | Claude API for AI task planning |
| gspread + google-auth-oauthlib | ≥6.0.0 | Google Sheets read/write |
| scipy | ≥1.13.0 | Spatial calculations for heatmap and forklift routing |
| httpx | ≥0.27.0 | Async HTTP client (Telegram bot API) |

### Frontend

| Library | Version | Purpose |
|---------|---------|---------|
| Next.js | 14.2.29 | App Router, SSR, standalone output |
| React | 18.3 | UI framework |
| TypeScript | 5 | Static typing |
| Tailwind CSS | 3.4 | Utility-first styling |
| @supabase/supabase-js | 2.x | Auth session management |

### Infrastructure

| Component | Version | Notes |
|-----------|---------|-------|
| PostgreSQL | 16-alpine | Schema + seed applied via Docker entrypoint |
| Docker Compose | v2 | Three-service stack with health checks |
| Supabase | hosted | Auth provider (JWT-based, JWKS endpoint) |

---

## Database Schema

### Core Tables

| Table | Key Columns | Description |
|-------|-------------|-------------|
| `forklifts` | `id`, `name`, `status`, `x`, `y`, `capacity` | 10 forklifts with position (SVG coordinate space) and carrying capacity |
| `inventory` | `id`, `item_name`, `quantity`, `location_zone` | 50 inventory items across warehouse zones |
| `tasks` | `id`, `type`, `status`, `forklift_id`, `origin_zone`, `destination_zone`, `planned_quantity`, `source`, `sheet_row_index` | Forklift work orders; `source` tracks origin (simulator / ai_workflow / google_sheets) |
| `events` | `id`, `type`, `payload` (JSONB), `timestamp` | Audit trail of all warehouse activity, auto-pruned every ~15 min |
| `alerts` | `id`, `severity`, `message`, `resolved` | Threshold-triggered alerts with resolve workflow |

### Auth & Agentic Tables

| Table | Description |
|-------|-------------|
| `profiles` | One row per Supabase Auth user; stores `role` (admin / operator); kept in sync with JWT claims via DB trigger |
| `whatsapp_sessions` | Per-phone-number Telegram bot session with state machine and pending plan JSONB |
| `whatsapp_messages` | Message history (inbound + outbound) for each bot session |

### Enums

- `forklift_status`: `idle` / `moving_empty` / `moving_loaded` / `loading` / `error`
- `task_type`: `inbound` / `outbound` / `relocation` / `replenishment`
- `task_status`: `pending` / `in-progress` / `completed` / `delayed` / `out_of_stock`
- `alert_severity`: `info` / `warning` / `critical`
- `user_role`: `admin` / `operator`

---

## API Reference

Interactive Swagger UI available at **http://localhost:8000/docs** after startup.

### REST Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/health` | Health check — returns `{"status":"ok"}` |
| `GET` | `/forklifts` | List all forklifts with current position and status |
| `GET` | `/tasks` | List tasks; filter by `?status=` and `?type=` |
| `GET` | `/inventory` | List inventory items; filter by `?zone=` |
| `GET` | `/alerts` | List alerts; filter by `?severity=` and `?include_resolved=` |
| `PATCH` | `/alerts/{id}` | Mark an alert as resolved |
| `GET` | `/events` | List recent events; filter by `?type=` and `?limit=` (max 500) |
| `GET` | `/events/heatmap` | Aggregated zone activity counts for the heatmap (server-side, no raw events needed) |
| `POST` | `/ai/plan` | Generate a forklift plan from a natural-language description (auth required) |
| `POST` | `/ai/execute` | Submit an approved plan as task rows (auth required) |
| `GET` | `/ai/capacities` | List per-forklift capacity settings (auth required) |
| `PATCH` | `/ai/capacities/{id}` | Update forklift capacity (admin only) |
| `GET` | `/telegram/conversations` | List all Telegram bot sessions (auth required) |
| `GET` | `/telegram/conversations/{id}` | Session detail with full message history (auth required) |
| `POST` | `/telegram/webhook` | Telegram webhook receiver |
| `GET` | `/admin/users` | List all users with roles (admin only) |
| `PATCH` | `/admin/users/{id}` | Update a user's role (admin only) |
| `GET` | `/analytics/throughput` | Hourly task throughput for the throughput chart |

### WebSocket

| Path | Description |
|------|-------------|
| `GET /ws/events` | Persistent WebSocket; token passed as query param `?token=`; receives batched JSON messages |

---

## Quick Start

### Prerequisites

- [Docker Desktop](https://www.docker.com/products/docker-desktop/) (or Docker Engine + Compose v2)
- A [Supabase](https://supabase.com/) project (free tier works) for authentication

### 1. Configure environment

```bash
# Clone and enter the project
git clone <repo-url>
cd real-time-warehouse-dashboard

# Copy and edit the backend env file
cp .env.example .env
# Fill in SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_JWT_SECRET (see below)
```

For the frontend, set `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` in `frontend/.env.local` (copy from `frontend/.env.local.example`).

### 2. Start all services

```bash
docker compose up --build
```

The first run builds images and seeds the database (10 forklifts, 30 tasks, 50 inventory items, 80 events, 10 alerts). Subsequent runs skip seeding automatically.

| Service | URL |
|---------|-----|
| Frontend | http://localhost:3000 |
| Backend API + Swagger | http://localhost:8000/docs |
| PostgreSQL | localhost:5432 |

### 3. Stop

```bash
docker compose down          # stop containers, keep volume
docker compose down -v       # stop containers AND delete DB volume (full reset)
```

### Local development (without Docker)

```bash
# Backend
cd backend
pip install -r requirements.txt
cp .env.example .env  # fill in vars
uvicorn app.main:app --reload --port 8000

# Frontend (separate terminal)
cd frontend
npm install
cp .env.local.example .env.local  # fill in vars
npm run dev
```

---

## Environment Variables

All variables have safe defaults so `docker compose up --build` works for the simulator-only flow. Auth and integrations require real credentials.

### Database (`db` service)

| Variable | Default | Description |
|----------|---------|-------------|
| `POSTGRES_DB` | `warehouse` | Database name |
| `POSTGRES_USER` | `warehouse_user` | Postgres user |
| `POSTGRES_PASSWORD` | `warehouse_pass` | Postgres password |
| `POSTGRES_PORT` | `5432` | Host port mapped to Postgres |

### Backend (`backend/.env`)

| Variable | Required | Description |
|----------|----------|-------------|
| `POSTGRES_HOST` | yes | Hostname of the Postgres container (use `db` in Docker Compose) |
| `POSTGRES_DB` | yes | Database name |
| `POSTGRES_USER` | yes | Postgres user |
| `POSTGRES_PASSWORD` | yes | Postgres password |
| `SUPABASE_URL` | yes | Your Supabase project URL (`https://<ref>.supabase.co`) |
| `SUPABASE_JWT_SECRET` | yes | JWT secret from Supabase dashboard → Settings → API |
| `SUPABASE_SERVICE_ROLE_KEY` | for admin API | Service role key for user management |
| `ANTHROPIC_API_KEY` | for AI planner | Claude API key |
| `TELEGRAM_BOT_TOKEN` | for Telegram | Bot token from BotFather |
| `TELEGRAM_USE_POLLING` | optional | Set `true` for local dev (vs webhook in prod) |
| `GOOGLE_SHEET_ID` | for Sheets | Google Sheets document ID |
| `GOOGLE_SHEET_NAME` | optional | Sheet tab name (default: `Sheet1`) |
| `GOOGLE_OAUTH_JSON` | for Sheets | Service account JSON (base64-encoded or raw) |
| `CORS_ORIGINS` | optional | Comma-separated allowed origins (default: `http://localhost:3000`) |
| `BACKEND_PORT` | optional | Host port for the backend (default: `8000`) |

### Frontend (`frontend/.env.local`)

| Variable | Required | Description |
|----------|----------|-------------|
| `NEXT_PUBLIC_API_URL` | yes | Backend URL visible to the browser (e.g. `http://localhost:8000`) |
| `NEXT_PUBLIC_SUPABASE_URL` | yes | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | yes | Supabase anon/public key |
| `FRONTEND_PORT` | optional | Host port for the frontend (default: `3000`) |

> **Note:** `NEXT_PUBLIC_API_URL` is baked into the JavaScript bundle at build time. If you change it after building, run `docker compose build frontend` to rebuild the image. For production, set it to the public URL of your backend (e.g. `https://api.example.com`).

---

## Project Structure

```
.
├── schema.sql                    # PostgreSQL enums + 10 tables (idempotent)
├── seed.sql                      # Mock data: 10 forklifts, 30 tasks, 50 items, etc.
├── docker-compose.yml
├── .env.example
│
├── backend/
│   ├── Dockerfile                # Build context = project root; COPYs schema.sql + seed.sql
│   ├── entrypoint.sh             # Wait for Postgres → init DB (if empty) → start uvicorn
│   ├── requirements.txt
│   └── app/
│       ├── main.py               # FastAPI app, lifespan, middleware, router registration
│       ├── database.py           # asyncpg connection pool + JSONB/UUID codecs
│       ├── dependencies.py       # get_pool FastAPI dependency
│       ├── models.py             # Pydantic v2 response models for all tables
│       ├── auth.py               # Supabase JWT verification (HS256 + ES/RS via JWKS)
│       ├── simulator.py          # Background IoT simulator (2 s tick)
│       ├── ws_manager.py         # WebSocket connection manager with asyncio lock
│       ├── sheets_client.py      # gspread OAuth2 helper
│       ├── sheets_poller.py      # Google Sheets → DB task importer (60 s polling)
│       ├── supabase_admin.py     # Supabase admin client wrapper
│       └── routers/
│           ├── forklifts.py      # GET /forklifts
│           ├── tasks.py          # GET /tasks
│           ├── inventory.py      # GET /inventory
│           ├── alerts.py         # GET /alerts  PATCH /alerts/:id
│           ├── events.py         # GET /events  GET /events/heatmap
│           ├── ws.py             # WS /ws/events (batched broadcast)
│           ├── admin.py          # GET/PATCH /admin/users (admin only)
│           ├── analytics.py      # GET /analytics/throughput
│           ├── ai_workflow.py    # POST /ai/plan  POST /ai/execute  GET+PATCH /ai/capacities
│           └── telegram_bot.py   # POST /telegram/webhook  GET /telegram/conversations
│
└── frontend/
    ├── Dockerfile                # Multi-stage: deps → builder → runner (standalone output)
    ├── next.config.js            # output: standalone
    ├── tailwind.config.ts
    ├── middleware.ts             # Auth guard — redirects unauthenticated users to /login
    ├── contexts/
    │   └── AuthContext.tsx       # Supabase session + role provider
    ├── app/                      # Next.js App Router pages
    │   ├── layout.tsx            # Root layout with Navigation
    │   ├── page.tsx              # Root → Dashboard
    │   ├── forklifts/            # Live map + heatmap tabs
    │   ├── tasks/
    │   ├── inventory/
    │   ├── alerts/
    │   ├── events/
    │   ├── ai/                   # AI Task Planner page
    │   ├── telegram/             # Telegram bot dashboard page
    │   ├── admin/users/          # Admin user management (admin only)
    │   └── login/                # Supabase Auth login page
    ├── components/
    │   ├── Navigation.tsx        # Dark top bar, active-link highlight, mobile hamburger
    │   ├── DashboardClient.tsx   # KPI cards + throughput chart
    │   ├── KpiCard.tsx           # Individual KPI stat tile
    │   ├── ThroughputChart.tsx   # Hourly task throughput SVG chart
    │   ├── ForkliftMap.tsx       # SVG 100×100 viewBox map with zone grid + hover tooltips
    │   ├── ForkliftHeatmap.tsx   # Zone intensity heatmap with busiest-zones sidebar
    │   ├── ForkliftTabs.tsx      # Tab switcher: Live Map / Traffic Heatmap
    │   ├── TaskTable.tsx         # Filterable task table with live WS row updates
    │   ├── InventoryTable.tsx    # Zone + search filters, stock-level badges
    │   ├── InventoryItemDetail.tsx # Item detail modal
    │   ├── AlertPanel.tsx        # Severity filters, resolve button, WS re-fetch
    │   ├── EventLog.tsx          # Type filter, colour-coded badges, capped at 100
    │   ├── AIWorkflow.tsx        # NL input → plan card → approve & execute
    │   ├── TelegramDashboard.tsx # Session list + message thread viewer
    │   ├── AdminUserPanel.tsx    # User role management table
    │   └── OnboardingTour.tsx    # First-time guided tour overlay
    ├── hooks/
    │   └── useWebSocket.ts       # Auto-reconnect WS hook (callbackRef pattern)
    └── lib/
        ├── api.ts                # Namespaced API helpers (api.forklifts.list(), api.ai.plan(), …)
        ├── types.ts              # TypeScript interfaces + WsMessage discriminated union
        ├── auth.ts               # Cookie helpers for Supabase token
        ├── client-auth.ts        # getClientToken() — reads active Supabase session
        └── supabase.ts           # Supabase client singleton
```

---

## Authentication & Roles

Authentication is handled by **Supabase Auth**. All dashboard pages are protected by `middleware.ts`, which reads the `sb-access-token` cookie and redirects unauthenticated requests to `/login`.

### Roles

| Role | Capabilities |
|------|-------------|
| `operator` | Full read access to all pages; can resolve alerts; can generate and execute AI plans |
| `admin` | Everything above + user management (`/admin/users`); can update per-forklift capacity settings |

Roles are stored in the `profiles` table and synced into Supabase JWT `app_metadata` via database triggers, so the FastAPI backend can enforce them without an extra DB round-trip per request.

### Backend Auth

The FastAPI `auth.py` module verifies JWTs using:
- **HS256**: using `SUPABASE_JWT_SECRET` directly
- **ES256 / RS256**: via JWKS endpoint (`{SUPABASE_URL}/auth/v1/.well-known/jwks.json`) with key caching

Protected routes use `Depends(get_current_user)` or `Depends(require_admin)`.

WebSocket connections pass the token as a query parameter: `ws://localhost:8000/ws/events?token=<jwt>`.

---

## Integrations

### Claude AI (Anthropic)

The `/ai/plan` endpoint accepts a plain-English task description and calls Claude to:
1. Identify task type, inventory item, quantity, and zones.
2. Query idle forklifts and available inventory from the database.
3. Compute a multi-forklift trip assignment that minimises makespan.
4. Return a structured plan with per-forklift breakdown and estimated completion time.

The `/ai/execute` endpoint converts an approved plan into `tasks` rows that the simulator picks up on the next tick.

### Telegram Bot

The bot is implemented as a state machine:

```
idle → chatting → awaiting_confirmation → generating → awaiting_plan_approval → executing → idle
```

Operators chat with the bot in natural language. Claude parses the intent, generates a plan, and waits for the operator to type `yes` or `no` to approve. If approved, tasks are created in the database. The dashboard `/telegram` page monitors all active sessions in real time.

Set `TELEGRAM_USE_POLLING=true` for local development. In production, configure a webhook URL pointing to `POST /telegram/webhook`.

### Google Sheets

Connect a Google Sheet by providing a service account with Sheets API access. The expected column layout:

| Column | Values |
|--------|--------|
| Item Name | Must match an `item_name` in the `inventory` table (case-insensitive) |
| Task Type | `inbound`, `outbound`, `relocation`, or `replenishment` |
| Quantity | Positive integer |
| Origin Zone | Required for `outbound`, `relocation` |
| Destination Zone | Required for `inbound`, `replenishment`, `relocation` |
| Status | Set to `Pending` to trigger import; the poller writes `Completed` when done |
| Assigned Forklift | Written back by the poller on completion |
| Completed At | Written back by the poller on completion |

Rows that fail validation (unknown item, bad task type, invalid quantity, missing zones) are skipped with a warning log and retried on the next poll.
