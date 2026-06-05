# ── Stage 1: install dependencies ─────────────────────────────────────────────
FROM node:20-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json* ./
# npm install is used (not ci) so the image builds even without a committed lockfile.
RUN npm install

# ── Stage 2: build Next.js (standalone output) ────────────────────────────────
FROM node:20-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .

# NEXT_PUBLIC_* vars are embedded in the JS bundle at build time.
# Pass the backend URL in as a build argument (default: localhost for local dev).
ARG NEXT_PUBLIC_API_URL=http://localhost:8000
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL
ENV NEXT_TELEMETRY_DISABLED=1
ENV BUILD_STANDALONE=true

# Ensure public/ exists so the COPY below never fails
RUN mkdir -p public

RUN npm run build

# ── Stage 3: minimal production runner ────────────────────────────────────────
FROM node:20-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

# Standalone output contains server.js + trimmed node_modules
COPY --from=builder /app/.next/standalone ./
# Static assets must live alongside the standalone server
COPY --from=builder /app/.next/static  ./.next/static
COPY --from=builder /app/public        ./public

EXPOSE 3000
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

CMD ["node", "server.js"]
