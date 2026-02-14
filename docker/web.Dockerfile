# ── Build stage ──────────────────────────────────────────────────────────────────
FROM node:22-alpine AS build

RUN corepack enable && corepack prepare pnpm@10.24.0 --activate

WORKDIR /app

# Copy all package manifests (pnpm requires full workspace to resolve lockfile)
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY schema/package.json schema/
COPY ui/package.json ui/
COPY admin/package.json admin/
COPY server/package.json server/
COPY bots/package.json bots/
COPY e2e/package.json e2e/

# --ignore-scripts: skip native module builds we don't need (better-sqlite3 etc.)
RUN pnpm install --frozen-lockfile --ignore-scripts

# Copy source for UI dependency chain
COPY schema/ schema/
COPY ui/ ui/
COPY admin/ admin/

# Build in dependency order
RUN pnpm --filter @pokerathome/schema build
RUN pnpm --filter @pokerathome/ui build
RUN BASE_PATH=/admin/ pnpm --filter @pokerathome/admin build

# ── Serve stage ──────────────────────────────────────────────────────────────────
FROM nginx:alpine

# Replace default nginx site with our reverse-proxy + static config
COPY docker/nginx.conf /etc/nginx/conf.d/default.conf

# Copy built static assets
COPY --from=build /app/ui/dist /usr/share/nginx/html/ui
COPY --from=build /app/admin/dist /usr/share/nginx/html/admin

EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
