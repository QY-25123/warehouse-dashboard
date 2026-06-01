-- Real-Time Warehouse Dashboard Schema

-- moving_empty: travelling to pickup location (no cargo aboard)
-- moving_loaded: travelling to dropoff location (carrying cargo)
CREATE TYPE forklift_status AS ENUM ('idle', 'moving_empty', 'moving_loaded', 'loading', 'error');
CREATE TYPE task_type       AS ENUM ('inbound', 'outbound', 'relocation', 'replenishment');
CREATE TYPE task_status     AS ENUM ('pending', 'in-progress', 'completed', 'delayed');
CREATE TYPE alert_severity  AS ENUM ('info', 'warning', 'critical');

CREATE TABLE forklifts (
    id           SERIAL PRIMARY KEY,
    name         VARCHAR(50)      NOT NULL UNIQUE,
    status       forklift_status  NOT NULL DEFAULT 'idle',
    x            NUMERIC(8, 2)    NOT NULL,
    y            NUMERIC(8, 2)    NOT NULL,
    last_updated TIMESTAMPTZ      NOT NULL DEFAULT NOW()
);

CREATE TABLE inventory (
    id             SERIAL PRIMARY KEY,
    item_name      VARCHAR(100)  NOT NULL,
    quantity       INTEGER       NOT NULL CHECK (quantity >= 0),
    location_zone  VARCHAR(10)   NOT NULL,
    last_updated   TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

CREATE TABLE tasks (
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

CREATE TABLE events (
    id        SERIAL PRIMARY KEY,
    type      VARCHAR(50)   NOT NULL,
    payload   JSONB         NOT NULL DEFAULT '{}',
    timestamp TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

CREATE TABLE alerts (
    id         SERIAL PRIMARY KEY,
    severity   alert_severity NOT NULL,
    message    TEXT           NOT NULL,
    resolved   BOOLEAN        NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ    NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_tasks_forklift_id      ON tasks(forklift_id);
CREATE INDEX idx_tasks_status           ON tasks(status);
CREATE INDEX idx_tasks_inventory_item   ON tasks(inventory_item_id);
CREATE INDEX idx_inventory_zone         ON inventory(location_zone);
CREATE INDEX idx_events_timestamp       ON events(timestamp DESC);
CREATE INDEX idx_events_type            ON events(type);
CREATE INDEX idx_alerts_resolved        ON alerts(resolved);
CREATE INDEX idx_alerts_severity        ON alerts(severity);
