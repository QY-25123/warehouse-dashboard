#!/bin/sh
# Backend entrypoint: wait for Postgres, apply schema + reference seed,
# then soft-reset runtime state so the simulator can resume cleanly.
# Historical tasks, events, and alerts are preserved across restarts.
set -e

DB_URL="postgresql://${POSTGRES_USER}:${POSTGRES_PASSWORD}@${POSTGRES_HOST}:${POSTGRES_PORT:-5432}/${POSTGRES_DB}"

echo "[entrypoint] Waiting for PostgreSQL at ${POSTGRES_HOST}:${POSTGRES_PORT:-5432}..."
until pg_isready -h "${POSTGRES_HOST}" -p "${POSTGRES_PORT:-5432}" -U "${POSTGRES_USER}" -d "${POSTGRES_DB}" -q; do
  sleep 1
done
echo "[entrypoint] PostgreSQL is ready."

echo "[entrypoint] Applying schema..."
psql "${DB_URL}" -f /app/schema.sql

echo "[entrypoint] Seeding reference data (skipped if data already exists)..."
psql "${DB_URL}" -f /app/seed.sql

echo "[entrypoint] Resuming from last state..."
psql "${DB_URL}" -c "
  -- Reset any moving/loading/error forklifts to idle so the simulator
  -- can reassign them. Idle forklifts are left untouched.
  UPDATE forklifts
  SET    status = 'idle'::forklift_status,
         last_updated = NOW()
  WHERE  status IN ('moving_empty', 'moving_loaded', 'loading', 'error');

  -- Reset stuck in-progress tasks back to pending so the simulator
  -- picks them up cleanly on the first assignment tick.
  UPDATE tasks
  SET    status = 'pending'::task_status,
         forklift_id = NULL,
         updated_at = NOW()
  WHERE  status IN ('in-progress', 'delayed');
"
echo "[entrypoint] State restored — historical data preserved. Starting uvicorn."

exec uvicorn app.main:app --host 0.0.0.0 --port 8000
