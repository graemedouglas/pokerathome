
## Game Rules
- **Texas Hold'em only** — two cards, five on the board
- No straddles, no bomb pots to start
- Basic betting: check, call, raise (fold always available)
- All-in is just a max raise
- Arbitrary bet amounts allowed (no chip-size alignment), but server enforces a minimum (big blind)
- Tournament format is the long-term goal; MVP doesn't require it
- Bots only need to play one game at a time

### Known Edge Cases (to handle eventually, not MVP)
- Player has less than the big blind but more than the ante — side pot logic
- All-in for less than the minimum raise — does it reopen action?
- Big blind player eliminated mid-hand — dealer position logic
- Forced actions (e.g., all-in call ends betting rounds — bot must yield control)

### Rule Extensions (future)
- Bomb pots, straddles, other variants
- Goal: eventually support self-hosted games with configurable house rules


## UI Requirements
- **2D web UI** (React or plain JS — Wade's call)
- Renders: cards, chips, pot, player positions, actions
- Animations are **not** a hard requirement — just render the state
- **Spectator vs. Player views:**
  - Spectators see all cards
  - Players see only their own cards
  - Spectator delay (configurable per room) to prevent cheating — liked by all
- Spectator visibility of human player actions: configurable per room

### Replay System (not three-hour scope, but important)
- Server logs every action + game state snapshot
- Enables step-through replay of any hand (important for bot developers debugging)
- Action applied to game state produces next game state — supports timeline scrubbing

### Admin Dashboard (stretch goal)
- List connected bots
- Create rooms
- Assign bots to rooms
- "Start game" button