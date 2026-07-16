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
    capacity     INTEGER          NOT NULL DEFAULT 50,
    last_updated TIMESTAMPTZ      NOT NULL DEFAULT NOW()
);

-- Add capacity to existing deployments (idempotent)
ALTER TABLE forklifts ADD COLUMN IF NOT EXISTS capacity INTEGER NOT NULL DEFAULT 50;

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
    planned_quantity  INTEGER,
    source            TEXT,
    sheet_row_index   INTEGER,
    created_at        TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at        TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- Add columns to existing deployments (idempotent)
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS planned_quantity INTEGER;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS source TEXT;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS sheet_row_index INTEGER;

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
CREATE INDEX IF NOT EXISTS idx_tasks_sheet_source   ON tasks(source, sheet_row_index) WHERE source IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_inventory_zone       ON inventory(location_zone);
CREATE INDEX IF NOT EXISTS idx_events_timestamp     ON events(timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_events_type          ON events(type);
CREATE INDEX IF NOT EXISTS idx_alerts_resolved      ON alerts(resolved);
CREATE INDEX IF NOT EXISTS idx_alerts_severity      ON alerts(severity);

-- ── WhatsApp agentic workflow ─────────────────────────────────────────────────

DO $$ BEGIN
  CREATE TYPE whatsapp_session_state AS ENUM (
    'idle', 'chatting', 'awaiting_confirmation',
    'generating', 'awaiting_plan_approval', 'executing'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE whatsapp_message_direction AS ENUM ('inbound', 'outbound');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS whatsapp_sessions (
    id           SERIAL PRIMARY KEY,
    phone_number VARCHAR(30)             NOT NULL UNIQUE,
    state        whatsapp_session_state  NOT NULL DEFAULT 'idle',
    pending_plan JSONB,
    created_at   TIMESTAMPTZ             NOT NULL DEFAULT NOW(),
    updated_at   TIMESTAMPTZ             NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS whatsapp_messages (
    id         SERIAL PRIMARY KEY,
    session_id INTEGER                       NOT NULL REFERENCES whatsapp_sessions(id) ON DELETE CASCADE,
    direction  whatsapp_message_direction    NOT NULL,
    content    TEXT                          NOT NULL,
    timestamp  TIMESTAMPTZ                   NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_whatsapp_messages_session ON whatsapp_messages(session_id);
CREATE INDEX IF NOT EXISTS idx_whatsapp_sessions_updated ON whatsapp_sessions(updated_at DESC);

-- ── Auth: user profiles ──────────────────────────────────────────────────────

DO $$ BEGIN
  CREATE TYPE user_role AS ENUM ('admin', 'operator');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS profiles (
    id           UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    email        TEXT         NOT NULL,
    role         user_role    NOT NULL DEFAULT 'operator',
    display_name TEXT,
    created_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_profiles_role ON profiles(role);

-- Auto-create a profile row when Supabase Auth inserts a new user.
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (id, email, role, display_name)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE((NEW.raw_app_meta_data->>'role')::user_role, 'operator'),
    COALESCE(NEW.raw_user_meta_data->>'display_name', split_part(NEW.email, '@', 1))
  );
  UPDATE auth.users
  SET raw_app_meta_data = raw_app_meta_data || jsonb_build_object(
    'role', COALESCE(NEW.raw_app_meta_data->>'role', 'operator')
  )
  WHERE id = NEW.id;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- Keep JWT claims in sync when an admin changes a user's role.
CREATE OR REPLACE FUNCTION public.sync_role_to_claims()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  UPDATE auth.users
  SET raw_app_meta_data = raw_app_meta_data || jsonb_build_object('role', NEW.role::text)
  WHERE id = NEW.id;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_profile_role_updated ON profiles;
CREATE TRIGGER on_profile_role_updated
  AFTER UPDATE OF role ON profiles
  FOR EACH ROW EXECUTE FUNCTION public.sync_role_to_claims();
