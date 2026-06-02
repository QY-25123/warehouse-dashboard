-- Real-Time Warehouse Dashboard Schema
-- All CREATE TYPE / CREATE TABLE / CREATE INDEX statements are idempotent.

-- ── ENUMs (wrapped so re-running is a no-op) ──────────────────────────────────

DO $$ BEGIN
  CREATE TYPE forklift_status AS ENUM ('idle', 'moving_empty', 'moving_loaded', 'loading', 'error');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE task_type AS ENUM ('inbound', 'outbound', 'relocation', 'replenishment');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE task_status AS ENUM ('pending', 'in-progress', 'completed', 'delayed', 'out_of_stock');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Extend existing enum if the DB was created before out_of_stock was added.
ALTER TYPE task_status ADD VALUE IF NOT EXISTS 'out_of_stock';

DO $$ BEGIN
  CREATE TYPE alert_severity AS ENUM ('info', 'warning', 'critical');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ── Tables ────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS forklifts (
    id           SERIAL PRIMARY KEY,
    name         VARCHAR(50)      NOT NULL UNIQUE,
    status       forklift_status  NOT NULL DEFAULT 'idle',
    x            NUMERIC(8, 2)    NOT NULL,
    y            NUMERIC(8, 2)    NOT NULL,
    last_updated TIMESTAMPTZ      NOT NULL DEFAULT NOW()
);

-- item_name UNIQUE enables ON CONFLICT DO NOTHING idempotent seeding.
CREATE TABLE IF NOT EXISTS inventory (
    id             SERIAL PRIMARY KEY,
    item_name      VARCHAR(100)  NOT NULL UNIQUE,
    quantity       INTEGER       NOT NULL CHECK (quantity >= 0),
    location_zone  VARCHAR(10)   NOT NULL,
    last_updated   TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS tasks (
    id                SERIAL PRIMARY KEY,
    type              task_type    NOT NULL,
    forklift_id       INTEGER      REFERENCES forklifts(id) ON DELETE SET NULL,
    status            task_status  NOT NULL DEFAULT 'pending',
    origin_zone       VARCHAR(4),
    destination_zone  VARCHAR(4),
    inventory_item_id INTEGER      REFERENCES inventory(id),
    created_at        TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at        TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS events (
    id        SERIAL PRIMARY KEY,
    type      VARCHAR(50)   NOT NULL,
    payload   JSONB         NOT NULL DEFAULT '{}',
    timestamp TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS alerts (
    id         SERIAL PRIMARY KEY,
    severity   alert_severity NOT NULL,
    message    TEXT           NOT NULL,
    resolved   BOOLEAN        NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ    NOT NULL DEFAULT NOW()
);

-- ── Indexes ───────────────────────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_tasks_forklift_id    ON tasks(forklift_id);
CREATE INDEX IF NOT EXISTS idx_tasks_status         ON tasks(status);
CREATE INDEX IF NOT EXISTS idx_tasks_inventory_item ON tasks(inventory_item_id);
CREATE INDEX IF NOT EXISTS idx_inventory_zone       ON inventory(location_zone);
CREATE INDEX IF NOT EXISTS idx_events_timestamp     ON events(timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_events_type          ON events(type);
CREATE INDEX IF NOT EXISTS idx_alerts_resolved      ON alerts(resolved);
CREATE INDEX IF NOT EXISTS idx_alerts_severity      ON alerts(severity);
