# ── Build stage ──────────────────────────────────────────────────────────────────
FROM node:22-alpine AS build

RUN corepack enable && corepack prepare pnpm@10.24.0 --activate
# better-sqlite3 may need native compilation
RUN apk add --no-cache python3 make g++

WORKDIR /app

# Copy package manifests first (changes rarely → cached layer)
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY schema/package.json schema/
COPY server/package.json server/
COPY bots/package.json bots/
# Stubs for remaining workspace packages (pnpm requires all listed in workspace)
COPY ui/package.json ui/
COPY admin/package.json admin/
COPY e2e/package.json e2e/

RUN pnpm install --frozen-lockfile

# Copy source for server dependency chain only
COPY schema/ schema/
COPY bots/ bots/
COPY server/ server/

# Build in dependency order
RUN pnpm --filter @pokerathome/schema build && \
    pnpm --filter @pokerathome/bots build && \
    pnpm --filter @pokerathome/server build

# Fix bots entry point for Node.js runtime (dev uses tsx which handles .ts natively)
RUN sed -i 's/"main": "src\/index.ts"/"main": "dist\/index.js"/' bots/package.json

# Create standalone deployment with flat node_modules (no pnpm symlinks to break)
RUN pnpm --filter @pokerathome/server deploy /deploy --prod --legacy

# ── Runtime stage ────────────────────────────────────────────────────────────────
FROM node:22-alpine

WORKDIR /app
COPY --from=build /deploy .

# SQLite data volume mount point
RUN mkdir -p /data

ENV NODE_ENV=production
EXPOSE 3000

CMD ["node", "dist/index.js"]
