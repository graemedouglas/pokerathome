---
name: UI Bug Fixes Round 2
overview: "Fix 7 UI bugs: card back sync timing, showdown reveal, sticky winner banner, hand value display, game pacing, split pot display, and CALL $0 pop text."
todos:
  - id: bug1-card-sync
    content: "Fix card backs sync: move cardsDealt tracking before adaptGameState call"
    status: completed
  - id: bug2-call-amount
    content: "Fix CALL $0: assign callAmount to actionAmount in server processAction"
    status: completed
  - id: bug3-sticky-banner
    content: "Fix sticky winner banner: set banner text whenever winners exist, not just showdown phase"
    status: completed
  - id: bug4-showdown-reveal
    content: "Showdown reveal: pass SHOWDOWN holeCards through adapter context and merge into player data"
    status: completed
  - id: bug5-pacing
    content: "Game pacing: parallel flop animation + delay before winner banner at showdown"
    status: completed
  - id: bug6-pot-display
    content: "Fix split pot display: aggregate winners by playerId in extractWinners"
    status: completed
  - id: bug7-hand-value
    content: "Hand value display: add pokersolver to UI, create evaluator, render on player panel"
    status: completed
isProject: false
---

# UI Bug Fixes Round 2

## Bug 1: Card backs don't appear on DEAL (only appear on FLOP)

**Root cause:** In [game-controller.ts](ui/src/network/game-controller.ts), `handleGameState` builds the adapter context with `cardsDealt: this.cardsDealt` _before_ `processEvent` sets `this.cardsDealt = true` in the DEAL branch. So the first render after DEAL still has `hasHiddenCards: false`.

**Fix:** In `handleGameState`, detect the event type and update `cardsDealt` (and `showdownResults`) _before_ building `ctx` and calling `adaptGameState`. Move the state-tracking that currently lives in `processEvent` to before the adapt call. `processEvent` keeps the animation/rendering logic.

```
// Before building ctx:
if (event.type === 'HAND_START') this.cardsDealt = false
if (event.type === 'DEAL') this.cardsDealt = true
```

---

## Bug 2: CALL $0 in action pop text

**Root cause:** In [server/src/engine/game.ts](server/src/engine/game.ts) line 362-367, the CALL case computes `callAmount` locally but never assigns it to `actionAmount`. The event on line 424 uses `actionAmount` which is still `undefined` for CALL, so no amount is emitted.

**Fix:** After the CALL case computes `callAmount`, assign `actionAmount = callAmount` so the PLAYER_ACTION event includes the amount. Same pattern for ALL_IN (which also has a locally-computed amount that should be emitted).

---

## Bug 3: Sticky winner banner

**Root cause:** In [GameRenderer.ts](ui/src/renderer/GameRenderer.ts) line 326, the winner banner text is only set when `phase === 'showdown'`. On fold wins (phase is still `preflop`/`flop` etc.), `update()` skips setting the text and hides the banner. But then `animateWinners()` forces `winnerBanner.visible = true` with the stale old text.

**Fix:** Move the winner banner text logic to work whenever `state.winners.length > 0` regardless of phase. Use the winner data from `state.winners` (which already includes `handDescription: 'Winner'` for fold wins) to build the banner text.

---

## Bug 4: Showdown doesn't reveal opponent hole cards

**Root cause:** The server sends opponent `holeCards` inside the SHOWDOWN event's `results[]`, but `toClientGameState` always hides opponent hole cards (`null`). The adapter only looks at `serverState.players[].holeCards` and never merges the SHOWDOWN results.

**Fix:** In `game-controller.ts`, when handling a SHOWDOWN event, extract the `holeCards` map from `event.results` and pass it through the adapter context. In `adapter.ts`, when showdown holeCards are provided for a player, use them to populate `player.holeCards`. The existing `PlayerRenderer` logic already shows cards face-up when `phase === 'showdown'`.

---

## Bug 5: Game pacing

**Flop too slow:** In [CommunityCards.ts](ui/src/renderer/CommunityCards.ts) `animateReveal`, the 3 flop cards are fully sequential (each card: 300ms drop + 150ms pause + flip + bounce + 100ms gap = ~1s per card = ~3s total). Refactor so the flop drops all 3 with staggered starts (e.g., 120ms apart) and flips them together after they land. Turn/River (single card) keeps the current dramatic pacing.

**Showdown too fast:** In `game-controller.ts` HAND_END handler, add a delay (using the existing `SHOWDOWN_DELAY` constant, 2500ms) before `animateWinners` when there was a showdown, so players can see the revealed cards before the winner banner.

---

## Bug 6: Split pot display shows duplicate winner lines

**Root cause:** When a player wins multiple pots (main + side), `HAND_END.winners` has one entry per pot. [extractWinners](ui/src/adapter.ts) maps these 1:1, so the UI shows "Player wins $X" twice.

**Fix:** In `extractWinners`, aggregate entries by `playerId` — sum the amounts and take the first `handDescription`. This way each player appears once in the winner display.

---

## Bug 7: Show player's current hand value during play

**Approach:** Add `pokersolver` as a UI dependency (it's pure JS, already used by server/bots, works in browsers via Vite's CJS-to-ESM pre-bundling). Create a thin `hand-evaluator.ts` in `ui/src/utils/` that evaluates the human player's hole cards + community cards and returns a description string.

**Display:** Add a hand description text element in `PlayerRenderer` below the card area for the human player. Update it in `PlayerRenderer.update()` whenever the player has hole cards and community cards exist. Copy the type declaration from [server/src/types/pokersolver.d.ts](server/src/types/pokersolver.d.ts) to `ui/src/types/`.

---

## Schema note

The CALL amount fix (Bug 2) makes the server emit `amount` for CALL events, which the schema already supports (Action.amount is optional). No schema file changes needed, but this makes the server behavior more complete relative to the schema.
