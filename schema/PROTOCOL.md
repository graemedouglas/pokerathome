# Poker@Home WebSocket Protocol

> Bot builder reference. This document describes the full WebSocket message protocol.
> For the machine-readable spec, see [`poker-protocol.asyncapi.yaml`](./poker-protocol.asyncapi.yaml).

## Connection

Connect via WebSocket to the game server (default: `wss://localhost:3000/ws`). All messages are JSON strings sent over a single WebSocket connection. The first thing you must do after connecting is **identify**.

---

## Message Envelope

Every message — client-to-server and server-to-client — is a JSON object with a uniform shape:

```json
{
  "action": "<messageType>",
  "payload": { ... }
}
```

- `action` — string discriminator identifying the message type.
- `payload` — message-specific data (may be `{}` for signals with no data).

---

## Card Notation

Cards are two-character strings: **rank** + **suit**.

| Ranks       | Suits                               |
| ----------- | ----------------------------------- |
| `2` through `9`, `T`, `J`, `Q`, `K`, `A` | `h` (hearts), `d` (diamonds), `c` (clubs), `s` (spades) |

Examples: `Ad` (ace of diamonds), `Tc` (ten of clubs), `6s` (six of spades).

---

## Message Reference

### Client to Server

| `action`        | Payload                                | Description                        |
| --------------- | -------------------------------------- | ---------------------------------- |
| `identify`      | `{ displayName, reconnectToken? }`     | Request identity / reconnect       |
| `listGames`     | `{}`                                   | List available games               |
| `joinGame`      | `{ gameId, role? }`                    | Join a game room (as player or spectator) |
| `ready`         | `{}`                                   | Signal readiness to play           |
| `playerAction`  | `{ handNumber, type, amount? }`        | Submit a game action               |
| `revealCards`   | `{ handNumber }`                       | Voluntarily show hole cards        |
| `chat`          | `{ message }`                          | Send a chat message                |
| `leaveGame`     | `{}`                                   | Leave the current game             |

### Server to Client

| `action`        | Payload                                       | Description                                  |
| --------------- | --------------------------------------------- | -------------------------------------------- |
| `identified`    | `{ playerId, reconnectToken, currentGame? }`  | Identity confirmed                           |
| `gameList`      | `{ games[] }`                                 | Available games                              |
| `gameJoined`    | `{ gameState }`                               | Joined a game, here's the initial state      |
| `gameState`     | `{ gameState, event, actionRequest? }`        | **Main message** — every state transition    |
| `timeWarning`   | `{ remainingMs }`                             | Action timer countdown                       |
| `gameOver`      | `{ gameId, reason, standings[] }`             | Game concluded                               |
| `chatMessage`   | `{ playerId, displayName, message, timestamp }` | Chat broadcast                            |
| `error`         | `{ code, message, details? }`                 | Something went wrong                         |

---

## Flows

### 1. Identity Flow

```
Bot                                   Server
 |                                      |
 |── { action: "identify",             |
 |     payload: {                       |
 |       displayName: "MyBot" }} ──────>|
 |                                      |
 |<──── { action: "identified",         |
 |        payload: {                    |
 |          playerId: "uuid",           |
 |          reconnectToken: "tok" }} ───|
```

On reconnect (e.g. after a crash), include the `reconnectToken` you received earlier. If you were in a game, the `identified` response will include `currentGame` with the full game state so you can resume.

### 2. Lobby Flow

```
Bot                                   Server
 |                                      |
 |── { action: "listGames",            |
 |     payload: {} } ─────────────────>|
 |                                      |
 |<──── { action: "gameList",           |
 |        payload: { games: [...] }} ──|
 |                                      |
 |── { action: "joinGame",             |
 |     payload: { gameId: "uuid" }} ──>|
 |                                      |
 |<──── { action: "gameJoined",         |
 |        payload: { gameState }} ─────|
 |                                      |
 |── { action: "ready",                |
 |     payload: {} } ─────────────────>|
```

After joining and signaling `ready`, the server will begin sending `gameState` messages once the game starts.

To join as a **spectator**, include `role: "spectator"` in the `joinGame` payload:

```json
{ "action": "joinGame", "payload": { "gameId": "uuid", "role": "spectator" } }
```

Spectators do not need to send `ready`. They immediately receive game state updates with all hole cards visible and are never prompted to act. Spectators do not count against the game's `maxPlayers` limit.

### 3. Game Flow (the core loop)

Every state transition produces a **`gameState`** message. The payload contains three fields:

| Field            | Always present? | Description                                   |
| ---------------- | --------------- | --------------------------------------------- |
| `gameState`      | Yes             | Full game state snapshot after the transition  |
| `event`          | Yes             | What just happened (discriminated on `type`)   |
| `actionRequest`  | Only your turn  | Available actions + time limit                 |

Typical hand sequence:

```
Server ──> { action: "gameState", payload: { ..., event: { type: "HAND_START" } } }
Server ──> { action: "gameState", payload: { ..., event: { type: "BLINDS_POSTED" } } }
Server ──> { action: "gameState", payload: { ..., event: { type: "DEAL" }, actionRequest: {...} } }
Bot    ──> { action: "playerAction", payload: { handNumber: 1, type: "CALL" } }
Server ──> { action: "gameState", payload: { ..., event: { type: "PLAYER_ACTION" } } }
  ... betting continues ...
Server ──> { action: "gameState", payload: { ..., event: { type: "FLOP" } } }
  ... more betting ...
Server ──> { action: "gameState", payload: { ..., event: { type: "TURN" } } }
  ... more betting ...
Server ──> { action: "gameState", payload: { ..., event: { type: "RIVER" } } }
  ... final betting ...
Server ──> { action: "gameState", payload: { ..., event: { type: "SHOWDOWN" } } }
Server ──> { action: "gameState", payload: { ..., event: { type: "HAND_END" } } }
```

**Key design property:** Every `gameState` message contains the *complete* snapshot. If your bot crashes and reconnects, the latest `gameState` has everything you need. You do not need to reconstruct state from message history.

### 4. Action Flow

When `actionRequest` is present in a `gameState` payload, you must respond. The server tells you exactly what's legal:

```json
{
  "action": "gameState",
  "payload": {
    "gameState": { "..." : "full snapshot" },
    "event": { "type": "DEAL" },
    "actionRequest": {
      "availableActions": [
        { "type": "FOLD" },
        { "type": "CALL", "amount": 50 },
        { "type": "RAISE", "min": 100, "max": 1500 },
        { "type": "ALL_IN", "amount": 1500 }
      ],
      "timeToActMs": 30000
    }
  }
}
```

Your response:

```json
{ "action": "playerAction", "payload": { "handNumber": 1, "type": "RAISE", "amount": 200 } }
```

**Action types:**

| Action   | Fields      | Description                                                    |
| -------- | ----------- | -------------------------------------------------------------- |
| `FOLD`   | --          | Give up the hand                                               |
| `CHECK`  | --          | Pass (only when no bet is open)                                |
| `CALL`   | --          | Match the current bet (amount shown in actionRequest)          |
| `BET`    | `amount`    | Open betting. Min = big blind, max = your stack                |
| `RAISE`  | `amount`    | Raise. Min = 2x the bet differential, max = your stack         |
| `ALL_IN` | --          | Bet your entire remaining stack                                |

**Timer:** You have `timeToActMs` milliseconds. The server sends `timeWarning` messages as the deadline approaches. If you don't respond in time, the server applies the default action (CHECK if possible, else FOLD) and broadcasts a `PLAYER_TIMEOUT` event.

### 5. Chat

```json
// Bot sends:
{ "action": "chat", "payload": { "message": "gg" } }

// Server broadcasts to all:
{ "action": "chatMessage", "payload": { "playerId": "uuid", "displayName": "MyBot", "message": "gg", "timestamp": "2026-02-06T..." } }
```

No effect on gameplay.

---

## GameState Object

The full snapshot sent with every game event:

| Field              | Type              | Description                                           |
| ------------------ | ----------------- | ----------------------------------------------------- |
| `gameId`           | `string (uuid)`   | Game identifier                                       |
| `gameType`         | `"cash"`          | Game type (tournament support planned)                |
| `handNumber`       | `integer`         | Monotonically increasing hand counter                 |
| `stage`            | `Stage`           | `PRE_FLOP`, `FLOP`, `TURN`, `RIVER`, `SHOWDOWN`      |
| `communityCards`   | `Card[]`          | Board cards (0-5)                                     |
| `pot`              | `integer`         | Total chips in play                                   |
| `pots`             | `PotBreakdown[]`  | Per-pot breakdown (for side pots)                     |
| `players`          | `PlayerState[]`   | All players at the table                              |
| `dealerSeatIndex`  | `integer`         | Dealer button position                                |
| `smallBlindAmount` | `integer`         | Current small blind                                   |
| `bigBlindAmount`   | `integer`         | Current big blind                                     |
| `activePlayerId`   | `string | null`   | Who must act, or null                                 |

### PlayerState

| Field         | Type              | Description                                                       |
| ------------- | ----------------- | ----------------------------------------------------------------- |
| `id`          | `string (uuid)`   | Player ID                                                         |
| `displayName` | `string`          | Display name                                                      |
| `seatIndex`   | `integer`         | Seat position (0-indexed)                                         |
| `role`        | `"player" \| "spectator"` | Spectators see all hole cards, never prompted to act      |
| `stack`       | `integer`         | Chips not committed to pot                                        |
| `bet`         | `integer`         | Chips committed this betting round                                |
| `potShare`    | `integer`         | Total contributed to pot across all rounds (inclusive of bet)      |
| `folded`      | `boolean`         | Has this player folded?                                           |
| `holeCards`   | `Card[] \| null`  | Your cards (or all cards for spectators). Null for opponents.     |
| `connected`   | `boolean`         | Is this player currently connected?                               |

---

## Event Types

Events are discriminated on the `type` field within the `gameState` payload's `event` object.

| Event type        | Key fields                                                     |
| ----------------- | -------------------------------------------------------------- |
| `HAND_START`      | `handNumber`, `dealerSeatIndex`                                |
| `BLINDS_POSTED`   | `smallBlind: { playerId, amount }`, `bigBlind: { playerId, amount }` |
| `DEAL`            | _(check holeCards in GameState)_                               |
| `FLOP`            | `cards: Card[3]`                                               |
| `TURN`            | `card: Card`                                                   |
| `RIVER`           | `card: Card`                                                   |
| `PLAYER_ACTION`   | `playerId`, `action: { type, amount? }`                        |
| `PLAYER_TIMEOUT`  | `playerId`, `defaultAction: { type, amount? }`                 |
| `SHOWDOWN`        | `results: [{ playerId, holeCards, handRank, handDescription }]`|
| `HAND_END`        | `winners: [{ playerId, amount, potIndex }]`                    |
| `PLAYER_REVEALED` | `playerId`, `holeCards`                                        |
| `PLAYER_JOINED`   | `playerId`, `displayName`, `seatIndex`, `role?`                |
| `PLAYER_LEFT`     | `playerId`                                                     |

---

## Error Codes

| Code               | Description                              |
| ------------------ | ---------------------------------------- |
| `INVALID_ACTION`   | Action type not valid in current context |
| `OUT_OF_TURN`      | Not your turn to act                     |
| `INVALID_AMOUNT`   | Bet/raise amount out of valid range      |
| `NOT_IN_GAME`      | You're not in a game                     |
| `GAME_NOT_FOUND`   | Requested game doesn't exist             |
| `GAME_FULL`        | Game has no open seats                   |
| `ALREADY_IN_GAME`  | You're already in a game                 |
| `NOT_IDENTIFIED`   | Must identify before other actions       |
| `INVALID_MESSAGE`  | Malformed or unrecognized message        |

---

## Edge Cases

- **Reconnection:** Send `{ action: "identify", payload: { displayName: "...", reconnectToken: "..." } }`. If you were in a game, the `identified` response includes `currentGame` with the full state.
- **Disconnect mid-hand:** You stay in the game (`connected: false`). Server auto-checks or auto-folds on your turns until you reconnect.
- **Invalid action:** Server responds with `{ action: "error", ... }`. You can retry within remaining time. If you don't, timeout applies.
- **Side pots:** The `pots[]` array in GameState breaks down each pot with eligible players. `HAND_END` attributes winnings per pot index.
- **Split pot:** Multiple entries in `winners[]` with the same `potIndex`.
- **Everyone folds:** `HAND_END` fires immediately (no `SHOWDOWN`). Pot goes to the last player standing.
- **Card reveal:** After `SHOWDOWN`, you can optionally send `{ action: "revealCards", payload: { handNumber } }`. Server broadcasts a `PLAYER_REVEALED` event.
- **Spectators:** Join with `{ gameId, role: "spectator" }`. Same `gameState` messages as players, but `holeCards` are visible for all players and `actionRequest` is never included. Spectators don't need to `ready` up, don't count against `maxPlayers`, and can chat.
