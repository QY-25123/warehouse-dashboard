#!/bin/sh
# Backend entrypoint.
# - If DATABASE_URL is set (production/Supabase): skip DB init and start immediately.
# - Otherwise (local Docker): wait for Postgres, apply schema + seed, reset state.
set -e

if [ -n "${DATABASE_URL}" ]; then
  echo "[entrypoint] DATABASE_URL detected — skipping schema init (managed by Supabase)."
else
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
    UPDATE forklifts
    SET    status = 'idle'::forklift_status,
           last_updated = NOW()
    WHERE  status IN ('moving_empty', 'moving_loaded', 'loading', 'error');

    UPDATE tasks
    SET    status = 'pending'::task_status,
           forklift_id = NULL,
           updated_at = NOW()
    WHERE  status IN ('in-progress', 'delayed');
  "
  echo "[entrypoint] State restored — historical data preserved."
fi

echo "[entrypoint] Starting uvicorn."
exec uvicorn app.main:app --host 0.0.0.0 --port 8000
