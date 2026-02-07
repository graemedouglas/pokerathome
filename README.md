# pokerathome

Self-hostable online poker for humans and robots.

## Project Structure

```
pokerathome/
  schema/         @pokerathome/schema   — Protocol spec, Zod types, docs
  server/         @pokerathome/server   — Game server (Fastify + WS + SQLite)
  admin/          @pokerathome/admin    — Admin dashboard (Vite stub)
```

## Getting Started

```bash
# Install dependencies (review package.json files first)
pnpm install

# Create a game via CLI
pnpm --filter @pokerathome/server create-game --name "Test Table" --blinds 5/10 --stack 1000 --seats 6

# Start the server
pnpm dev

# Start the admin dashboard (separate terminal)
pnpm --filter @pokerathome/admin dev
```

The server runs on `http://localhost:3000` with:
- WebSocket endpoint at `ws://localhost:3000/ws`
- Admin REST API at `http://localhost:3000/api/games`
- Health check at `http://localhost:3000/health`

The admin dashboard runs on `http://localhost:3001` (proxies API calls to the server).

## Documentation

- [Protocol Reference](schema/PROTOCOL.md) — Full WebSocket message protocol for bot builders
- [Protocol Spec](schema/SPEC.md) — High-level requirements and design notes
- [AsyncAPI Schema](schema/poker-protocol.asyncapi.yaml) — Machine-readable protocol definition
