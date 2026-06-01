#!/bin/sh
# Backend entrypoint: wait for Postgres, apply schema+seed if tables are
# absent, then exec uvicorn.  Safe to run repeatedly — the CREATE TABLE
# statements use CREATE TYPE / IF NOT EXISTS semantics and the check below
# means the seed only runs once.
set -e

DB_URL="postgresql://${POSTGRES_USER}:${POSTGRES_PASSWORD}@${POSTGRES_HOST}:${POSTGRES_PORT:-5432}/${POSTGRES_DB}"

echo "[entrypoint] Waiting for PostgreSQL at ${POSTGRES_HOST}:${POSTGRES_PORT:-5432}..."
until pg_isready -h "${POSTGRES_HOST}" -p "${POSTGRES_PORT:-5432}" -U "${POSTGRES_USER}" -d "${POSTGRES_DB}" -q; do
  sleep 1
done
echo "[entrypoint] PostgreSQL is ready."

# Check whether the forklifts table already exists.
TABLE_EXISTS=$(psql "${DB_URL}" -tAc \
  "SELECT EXISTS (
     SELECT FROM information_schema.tables
     WHERE table_schema = 'public' AND table_name = 'forklifts'
   )" 2>/dev/null || echo "f")

if [ "${TABLE_EXISTS}" = "t" ]; then
  echo "[entrypoint] Schema already present — skipping init."
else
  echo "[entrypoint] Schema not found — applying schema.sql..."
  psql "${DB_URL}" -f /app/schema.sql
  echo "[entrypoint] Seeding data..."
  psql "${DB_URL}" -f /app/seed.sql
  echo "[entrypoint] Database initialised successfully."
fi

exec uvicorn app.main:app --host 0.0.0.0 --port 8000
