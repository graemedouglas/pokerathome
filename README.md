# pokerathome

Self-hostable online poker for humans and robots.

## Project Structure

```
pokerathome/
  schema/         @pokerathome/schema   — Protocol spec, Zod types, docs
  server/         @pokerathome/server   — Game server (Fastify + WS + SQLite)
  ui/             @pokerathome/ui       — PixiJS game client (Vite)
  admin/          @pokerathome/admin    — Admin dashboard (Vite stub)
```

## Getting Started

```bash
# Install dependencies (review package.json files first)
pnpm install

# Build the schema package (dependency of server and ui)
pnpm --filter @pokerathome/schema build

# Start the server
pnpm dev

# Create a game via the admin API (server must be running)
curl -X POST http://localhost:3000/api/games \
  -H 'Content-Type: application/json' \
  -d '{"name":"Test Table","smallBlind":5,"bigBlind":10,"maxPlayers":6,"startingStack":1000}'

# Or create a game via CLI (server must NOT be running — uses DB directly)
pnpm --filter @pokerathome/server create-game --name "Test Table" --blinds 5/10 --stack 1000 --seats 6

# Start the UI (separate terminal)
pnpm dev:ui
```

The server runs on `http://localhost:3000` with:
- WebSocket endpoint at `ws://localhost:3000/ws`
- Admin REST API at `http://localhost:3000/api/games`
- Health check at `http://localhost:3000/health`

The UI runs on `http://localhost:5173` (proxies WebSocket to the server via Vite).

The admin dashboard runs on `http://localhost:3001` (proxies API calls to the server).

## Documentation

- [Protocol Reference](schema/PROTOCOL.md) — Full WebSocket message protocol for bot builders
- [Protocol Spec](schema/SPEC.md) — High-level requirements and design notes
- [AsyncAPI Schema](schema/poker-protocol.asyncapi.yaml) — Machine-readable protocol definition
