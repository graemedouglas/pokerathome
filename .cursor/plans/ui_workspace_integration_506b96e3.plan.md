---
name: UI workspace integration
overview: Extract the PixiJS UI from the `ui` branch into a new `ui/` pnpm workspace, remove the local game engine, add a WebSocket client layer that connects to the server per the AsyncAPI protocol, and add a simple HTML lobby overlay for name entry and game selection.
todos:
  - id: extract-ui
    content: Extract UI files from origin/ui branch into ui/ workspace directory (renderers, utils, settings, types, constants, index.html, configs). Create package.json, update pnpm-workspace.yaml.
    status: completed
  - id: adapter
    content: Create ui/src/adapter.ts -- type mapping layer between server protocol types (from @pokerathome/schema) and UI rendering types (Card objects, GamePhase, Player, AvailableActions).
    status: completed
  - id: ws-client
    content: Create ui/src/network/ws-client.ts -- WebSocket client with connect/send/onMessage, reconnect token storage, and auto-reconnect.
    status: completed
  - id: game-controller
    content: Create ui/src/network/game-controller.ts -- replaces local Game class, bridges server gameState/events to GameRenderer animations and ActionPanel interaction.
    status: completed
  - id: lobby
    content: Create ui/src/lobby/lobby.ts -- HTML overlay for name entry, game list, and ready-up flow. Hides on game start.
    status: completed
  - id: main-wiring
    content: Rewrite ui/src/main.ts to wire lobby -> ws-client -> game-controller -> GameRenderer.
    status: completed
  - id: vite-proxy
    content: Update ui/vite.config.ts with WebSocket proxy to localhost:3000.
    status: completed
  - id: root-scripts
    content: Update root package.json and pnpm-workspace.yaml for the new ui workspace.
    status: completed
  - id: test-e2e
    content: Install deps, start server + UI, create game via admin API, verify full connection flow in browser.
    status: in_progress
isProject: false
---

# UI Workspace Integration with Server

## Context

- **Main branch**: pnpm monorepo with `schema/`, `server/`, `admin/` workspaces
- **UI branch**: Standalone Vite + PixiJS poker game with local game engine and bot players -- no server connectivity
- **Goal**: Merge UI into its own workspace, replace local game engine with WebSocket client, connect to server per [poker-protocol.asyncapi.yaml](schema/poker-protocol.asyncapi.yaml)

## 1. Extract UI from branch into workspace

Cherry-pick the PixiJS rendering code from `origin/ui` into a new `ui/` directory. Keep:

- `src/renderer/` (all PixiJS renderers -- `GameRenderer.ts`, `ActionPanel.ts`, `PlayerRenderer.ts`, etc.)
- `src/utils/` (Animations.ts, Layout.ts)
- `src/settings/` (GameSettings.ts)
- `src/types.ts`, `src/constants.ts`
- `index.html`, `vite.config.ts`, `tsconfig.json`

Remove/skip:

- `src/game/` (entire local game engine -- Game.ts, Deck.ts, HandEvaluator.ts, BettingRound.ts, BotPlayer.ts)
- `dev/` (dev tooling/screenshots)
- `dist/` (build artifacts)

Create `ui/package.json`:

```json
{
  "name": "@pokerathome/ui",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc && vite build",
    "preview": "vite preview"
  },
  "dependencies": {
    "@pokerathome/schema": "workspace:*",
    "pixi.js": "^8.6.6"
  },
  "devDependencies": {
    "typescript": "^5.7.3",
    "vite": "^6.1.0"
  }
}
```

Update [pnpm-workspace.yaml](pnpm-workspace.yaml) to add `ui`.

## 2. Type Adapter Layer

The server and UI use different type shapes. Create `ui/src/adapter.ts` as a single translation layer.

Key mappings:

- **Card**: Server `"Ad"` -> UI `{ suit: 'diamonds', rank: 'A', code: 'Ad' }`. Map `h/d/c/s` to `hearts/diamonds/clubs/spades`, map `T`->`10`, etc.
- **Stage -> Phase**: `PRE_FLOP` -> `preflop`, `FLOP` -> `flop`, etc.
- **PlayerState -> Player**: `id` (uuid->hash to number), `displayName`->`name`, `stack`->`chips`, `bet`->`currentBet`, `folded`->`isFolded`, derive `isDealer`/`isSB`/`isBB`/`isCurrent` from GameState context, `holeCards` null->empty array, assign sequential `avatarId` per seat
- **ActionRequest -> AvailableActions**: Iterate `availableActions` array to derive `canFold`, `canCheck`, `canCall`, `callAmount`, `canRaise`, `minRaise`, `maxRaise`
- **UI PlayerAction -> server PlayerActionPayload**: Map `fold`->`FOLD`, `raise`->`RAISE` etc., include `handNumber`

## 3. WebSocket Client Service

Create `ui/src/network/ws-client.ts`:

- `connect(url)` -- opens WebSocket, returns a promise that resolves on open
- `send(message: ClientMessage)` -- sends JSON `{ action, payload }` envelope
- `onMessage(handler)` -- registers callback for server messages
- `onDisconnect(handler)` -- handles close/error
- Stores `reconnectToken` in localStorage for crash recovery
- Auto-reconnect with backoff

## 4. Network Game Controller

Create `ui/src/network/game-controller.ts` to replace `Game.ts`:

- Holds reference to `GameRenderer` and `WsClient`
- On `gameState` message: runs adapter, calls `renderer.update(uiState)`, triggers appropriate animations based on `event.type` (DEAL -> animate deal, FLOP -> `animateCommunityReveal`, SHOWDOWN -> `animateWinners`, etc.)
- On `actionRequest`: calls `renderer.waitForHumanAction()`, translates result, sends `playerAction` to server
- On `timeWarning`: can display in UI (future enhancement)
- On `gameOver`: show final standings
- Emits events the lobby can listen to for state transitions

## 5. HTML Lobby Overlay

Create `ui/src/lobby/lobby.ts`:

- Simple DOM-based overlay on top of the canvas
- **Screen 1 - Connect**: Text input for display name, "Connect" button. Sends `identify` message, receives `identified` response with `playerId` and `reconnectToken`.
- **Screen 2 - Game List**: Sends `listGames`, displays games as clickable cards showing name, player count, blinds, status. "Join" button sends `joinGame`. "Refresh" button re-fetches.
- **Screen 3 - Waiting**: After joining, shows "Waiting for game to start..." with a "Ready" button that sends `ready`.
- On game start (first `gameState` message): hides overlay, shows PixiJS canvas.

Styled with inline CSS -- dark theme matching the PixiJS background (`#0f0f23`).

## 6. Vite Dev Proxy

Update `ui/vite.config.ts` to proxy WebSocket connections to the server in dev mode:

```typescript
export default defineConfig({
  server: {
    open: true,
    proxy: {
      '/ws': {
        target: 'ws://localhost:3000',
        ws: true,
      },
    },
  },
})
```

## 7. Root Config Updates

- Add `ui` to [pnpm-workspace.yaml](pnpm-workspace.yaml)
- Add `"dev:ui": "pnpm --filter @pokerathome/ui dev"` to root [package.json](package.json)
- Update `"dev"` to run both server and UI (or keep them separate for clarity)

## 8. Testing

- Start server: `pnpm dev` (runs on port 3000)
- Create a game via admin API: `POST http://localhost:3000/api/games`
- Start UI: `pnpm dev:ui` (runs Vite on port 5173)
- In browser: enter name, see game list, join game, ready up
- Verify WebSocket messages flow correctly and PixiJS renders game state

