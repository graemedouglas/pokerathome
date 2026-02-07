---
name: Poker WebSocket Protocol Schema
overview: Design and author an AsyncAPI 3.0 specification defining the full WebSocket protocol for the Poker@Home game (cash game first, tournament-extensible), including generated documentation and TypeScript type scaffolding.
todos:
  - id: asyncapi-spec
    content: Author the AsyncAPI 3.0 YAML spec with all channels, operations, messages, and component schemas
    status: completed
  - id: protocol-guide
    content: Write PROTOCOL.md -- concise human-readable protocol reference for bot builders
    status: completed
  - id: tooling-setup
    content: Set up package.json with AsyncAPI CLI + Modelina deps and validation/generation scripts
    status: completed
  - id: validate-and-gen
    content: Validate the spec, generate HTML docs and TypeScript types, verify output
    status: in_progress
isProject: false
---

# Poker@Home WebSocket Protocol Schema

## Deliverables

- `**schema/poker-protocol.asyncapi.yaml**` -- The AsyncAPI 3.0 spec (single file, all models inline)
- **Generated HTML docs** via `@asyncapi/cli` for bot builders to reference
- **Generated TypeScript types** via `@asyncapi/modelina` for server and bot consumers
- `**schema/PROTOCOL.md**` -- Human-readable protocol guide summarizing flows and edge cases (lighter-weight companion to the YAML)
- **Root `package.json**` with dev deps and scripts for validation, docs gen, and type gen

---

## Core Data Models

### GameState (the master snapshot, sent with every game message)

```yaml
gameId: string
gameType: "cash" # "tournament" later
handNumber: integer # monotonically increasing
stage: PRE_FLOP | FLOP | TURN | RIVER | SHOWDOWN
communityCards: string[] # e.g. ["6c", "4s", "Td"]
pot: integer # total chips in play
pots: # breakdown for side pot scenarios
  - amount: integer
    eligiblePlayerIds: string[]
players: PlayerState[]
dealerSeatIndex: integer
smallBlindAmount: integer
bigBlindAmount: integer
activePlayerId: string | null
```

### PlayerState (per-player, within GameState)

```yaml
id: string (UUID)
displayName: string
seatIndex: integer
role: "player" | "spectator"    # spectators see all hole cards, never get action prompts
stack: integer
bet: integer                    # current betting round commitment
potShare: integer               # total contributed to pot across all rounds
folded: boolean
holeCards: string[] | null      # your own cards (or all cards for spectators); null for opponents
connected: boolean
```

### Event (discriminated union -- what just happened)

| Event type        | Key fields                                                   |
| ----------------- | ------------------------------------------------------------ |
| `HAND_START`      | handNumber, dealerSeatIndex                                  |
| `BLINDS_POSTED`   | smallBlind: {playerId, amount}, bigBlind: {playerId, amount} |
| `DEAL`            | _(hole cards appear in player's holeCards field)_            |
| `FLOP`            | cards: string[3]                                             |
| `TURN`            | card: string                                                 |
| `RIVER`           | card: string                                                 |
| `PLAYER_ACTION`   | playerId, action: {type, amount?}                            |
| `PLAYER_TIMEOUT`  | playerId, defaultAction: {type, amount?}                     |
| `SHOWDOWN`        | results: [{playerId, holeCards, handRank, handDescription}]  |
| `HAND_END`        | winners: [{playerId, amount, potIndex}]                      |
| `PLAYER_REVEALED` | playerId, holeCards                                          |
| `PLAYER_JOINED`   | playerId, displayName, seatIndex                             |
| `PLAYER_LEFT`     | playerId                                                     |

### ActionRequest (present only for the player who must act)

```yaml
availableActions: # array of ActionOption
  - type: FOLD
  - type: CHECK
  - type: CALL
    amount: integer # fixed amount to call
  - type: BET
    min: integer # minimum bet (big blind)
    max: integer # maximum bet (their stack)
  - type: RAISE
    min: integer # minimum raise (2x differential)
    max: integer # maximum raise (their stack)
  - type: ALL_IN
    amount: integer # their remaining stack
timeToActMs: integer
```

### Action (bot/player response)

```yaml
type: FOLD | CHECK | CALL | BET | RAISE | ALL_IN
amount: integer # required for BET and RAISE; ignored for others
```

---

## Message Flows (Socket.IO Events)

### Server to Client events

| Event name    | Payload                                             | When                                                   |
| ------------- | --------------------------------------------------- | ------------------------------------------------------ |
| `identified`  | {playerId, reconnectToken, currentGame?}            | After bot identifies; currentGame present on reconnect |
| `gameList`    | {games: [{gameId, name, playerCount, stakes, ...}]} | Response to listGames                                  |
| `gameJoined`  | {gameState}                                         | Bot successfully joined a game room                    |
| `gameState`   | {gameState, event, actionRequest?}                  | **The main workhorse** -- every state transition       |
| `timeWarning` | {remainingMs}                                       | Countdown nudges (e.g. at 50%, 80% of time)            |
| `gameOver`    | {gameId, reason, standings}                         | Game concluded                                         |
| `chatMessage` | {playerId, displayName, message, timestamp}         | Chat                                                   |
| `error`       | {code, message, details?}                           | Validation errors, invalid actions, etc.               |

### Client to Server events

| Event name    | Payload                        | When                             |
| ------------- | ------------------------------ | -------------------------------- |
| `identify`    | {displayName, reconnectToken?} | First thing on connect           |
| `listGames`   | {}                             | Request available games          |
| `joinGame`    | {gameId}                       | Join a game room                 |
| `ready`       | {}                             | Signal readiness to play         |
| `action`      | {handNumber, type, amount?}    | Response to actionRequest        |
| `revealCards` | {handNumber}                   | Optional card reveal at showdown |
| `chat`        | {message}                      | Send chat message                |
| `leaveGame`   | {}                             | Leave current game               |

### Unified Game Message Pattern

The core design principle: **every game state transition produces one `gameState` message** containing the full snapshot + the event that caused it + an action prompt if it is now this player's turn. This means:

- Bots need exactly one message handler for game logic
- Crash recovery is trivial (latest `gameState` is complete)
- The `event` field acts as the discriminator for what just happened
- `actionRequest` is only present for the one player whose turn it is

```
Server: gameState { state, event: HAND_START }
Server: gameState { state, event: BLINDS_POSTED }
Server: gameState { state, event: DEAL, actionRequest: {...} }  --> to active player
Player: action { handNumber: 1, type: "CALL" }
Server: gameState { state, event: PLAYER_ACTION }               --> broadcast
Server: gameState { state, event: PLAYER_ACTION, actionRequest }  --> next player
...
Server: gameState { state, event: FLOP }
...
Server: gameState { state, event: SHOWDOWN }
Server: gameState { state, event: HAND_END }
```

---

## Edge Cases to Handle

- **Invalid action**: Server responds with `error` event (code + message). Bot must retry within remaining time, else timeout.
- **Bot disconnect mid-hand**: Player stays in game (`connected: false`). Auto-check if possible, else auto-fold on their turns. On reconnect with `reconnectToken`, server sends current `gameState`.
- **Action timeout**: Server broadcasts `gameState` with `PLAYER_TIMEOUT` event containing the default action taken (check > fold).
- **Side pots**: When player all-ins for less than the current bet, `pots[]` array in GameState breaks down pot eligibility. `HAND_END` event attributes winnings per pot index.
- **Split pot**: Multiple winners in `HAND_END` event for the same pot index.
- **All fold to one**: `HAND_END` fires immediately, no `SHOWDOWN` event. Winner does not need to reveal.
- **Heads-up blinds**: Dealer posts small blind (standard heads-up rules). Schema doesn't change; server logic handles it.
- **Player leaves cash game**: `PLAYER_LEFT` event broadcast, game continues if 2+ players remain.
- **Spectators**: Same `gameState` messages, but: `holeCards` visible for ALL players, no `actionRequest` ever included.

---

## Tooling and Scripts

Root `package.json` dev dependencies:

- `@asyncapi/cli` -- validate spec, generate docs
- `@asyncapi/modelina` -- generate TypeScript types

NPM scripts:

- `pnpm schema:validate` -- `asyncapi validate schema/poker-protocol.asyncapi.yaml`
- `pnpm schema:docs` -- generate HTML docs into `schema/generated/docs/`
- `pnpm schema:types` -- generate TypeScript interfaces into `schema/generated/types/`

---

## File Structure

```
pokerathome/
  package.json                              # asyncapi tooling deps + scripts
  schema/
    SPEC.md                                 # existing high-level spec
    PROTOCOL.md                             # human-readable protocol guide
    poker-protocol.asyncapi.yaml            # THE AsyncAPI 3.0 spec
    generated/
      docs/                                 # generated HTML docs (gitignored)
      types/                                # generated TS interfaces (gitignored)
```

---

## Implementation Notes

- **AsyncAPI 3.0** over 2.x because it decouples channels from operations, giving us cleaner modeling of bidirectional Socket.IO events.
- **Single YAML file** for the spec (all schemas inline). The protocol isn't large enough to warrant splitting into multiple files, and a single file is easier for bot builders to consume.
- **Tournament extensibility**: GameState includes optional `blindSchedule` and `nextBlindLevel` fields marked as tournament-only. GameType enum is `"cash" | "tournament"`. Tournament-specific events (e.g. `BLIND_LEVEL_UP`, `PLAYER_ELIMINATED`, `TOURNAMENT_END`) are stubbed with TODO markers.
- Card format validation: regex pattern `^[2-9TJQKA][hdcs]$` baked into the schema.
- All integer chip amounts (no floats) to avoid rounding issues.
