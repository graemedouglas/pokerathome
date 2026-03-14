# pokerathome

Self-hostable online poker for humans and robots. TypeScript pnpm monorepo.

## Workspaces

| Package | Path | Purpose |
|---------|------|---------|
| `@pokerathome/schema` | `schema/` | AsyncAPI protocol spec + Zod types in `src/protocol.ts`. Shared dependency of server, ui, bots. |
| `@pokerathome/server` | `server/` | Fastify + `@fastify/websocket` + better-sqlite3. Port 3000. Key dirs: `engine/` (game logic, action validation, blinds, deck, hand eval, pot math), `ws/` (WebSocket handlers, session mgmt, routing), `db/` (SQLite schema + queries), `replay/`, `admin-api.ts`. Entry: `src/index.ts`. |
| `@pokerathome/ui` | `ui/` | PixiJS 8 browser client (pure canvas, no React). Vite dev server port 5173, proxies WS to server. Key dirs: `renderer/` (GameRenderer, ActionPanel, PlayerRenderer, CardSprite), `network/` (WsClient, GameController, ReplayController). |
| `@pokerathome/admin` | `admin/` | Vite admin dashboard. Game CRUD, bot management, auth settings, replay management. |
| `@pokerathome/bots` | `bots/` | Bot framework + strategies. `client.ts` = WS client, `strategies/` = implementations (calling-station, tag-bot), `hand-strength.ts` = eval utils, `run.ts` = CLI entry. |
| `@pokerathome/e2e` | `e2e/` | Playwright browser tests + Jest unit tests. Screenshots in `e2e/screenshots/`. |
| — | `python-bot/` | Reference Python bot (not in pnpm workspaces). |
| — | `scripts/` | Dev utilities: reset, kill-dev, deploy (bash + PowerShell variants). |
| — | `docker/` | Dockerfiles + nginx config for deployment. |
| — | `docs/` | `rules/poker_tda.txt` (TDA rules reference). |

## Commands

```
pnpm dev                # Start server (port 3000)
pnpm dev:ui             # Start UI (port 5173)
pnpm dev:admin          # Start admin dashboard
pnpm test               # Server unit tests (Jest)
pnpm test:bots          # Bot tests
pnpm test:integration   # Bot-server integration tests
pnpm test:e2e           # E2e unit tests (Jest)
pnpm e2e                # Full e2e tests (Playwright)
pnpm build              # Build all workspaces
pnpm reset:start        # Wipe DB, restart server, create test game
pnpm kill               # Kill dev servers on ports 3000/5173
pnpm --filter @pokerathome/schema build   # Rebuild schema (required after protocol changes)
```

## Conventions

- **pnpm only.** Never install packages without user approval.
- **Pragmatic over clever.** Avoid over-engineering. Enough architecture to be modular, not so much it bogs things down.
- **One type shape per logical entity** where possible. Minimize shape transformation and plumbing between layers.
- **Don't rename values unnecessarily** as they flow through the system. If the API gives `startDate`, keep it as `startDate`.
- **Tests:** strong, minimally comprehensive test suites over many tiny unit tests. Tests should be flexible, not tightly coupled to implementation details.
- **Schema must stay in sync with server.** If WS protocol changes in server, update `schema/src/protocol.ts` and rebuild. People build bots solely from the schema.
- **All bug fixes must include an e2e test** to lock down the behavior.
- **Logging:** pino. Errors must use `logger.error({ err })` — the param must be named `err` for proper serialization.
- **Dates:** use date-fns for all datetime work.
- **UI style:** sleek and crunchy — Apple-esque. Not over-minimal, not over-decorated.
- **Keep docs/markdown in sync** when making changes that affect them.

## Architecture

- **Schema is the protocol source of truth.** `schema/src/protocol.ts` defines Zod schemas for all WebSocket messages with runtime validation and TypeScript type inference. Server, UI, and bots all import from `@pokerathome/schema`.
- **Server uses `pokersolver`** for hand evaluation. Bots also depend on it.
- **Server imports `@pokerathome/bots`** for running built-in bots server-side.

### Cross-cutting change checklist

Protocol changes must propagate through:
1. `schema/src/protocol.ts` — update Zod schemas
2. `pnpm --filter @pokerathome/schema build` — rebuild
3. `server/src/ws/` — update server handlers
4. `ui/src/network/` — update client adapter
5. `bots/src/client.ts` — update bot client
