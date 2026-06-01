# Build context must be the project root so we can COPY schema.sql and seed.sql.
# Usage: docker build -f backend/Dockerfile .
FROM python:3.12-slim

WORKDIR /app

# postgresql-client provides pg_isready + psql (used by entrypoint.sh).
# curl is used by the docker-compose healthcheck.
RUN apt-get update && apt-get install -y --no-install-recommends \
      postgresql-client \
      curl \
    && rm -rf /var/lib/apt/lists/*

COPY backend/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Application source
COPY backend/app/ ./app/

# SQL files needed by entrypoint.sh to initialise the database
COPY schema.sql ./schema.sql
COPY seed.sql   ./seed.sql

# Entrypoint script: waits for postgres, applies schema+seed if absent
COPY backend/entrypoint.sh ./entrypoint.sh
RUN chmod +x ./entrypoint.sh

EXPOSE 8000

ENTRYPOINT ["./entrypoint.sh"]
