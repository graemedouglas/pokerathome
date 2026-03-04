# Plan: TDA Edge Cases Round 2 — Bug Fix + New Tests

## Context

After the first round (56 tests, 3 bug fixes), a deeper review of TDA rules reveals:
1. A **new bug** in our Rule 47 fix — cumulative short all-ins don't properly reopen betting
2. Several untested edge cases worth covering

---

## Bug Fix: Cumulative Short All-Ins Don't Reopen (TDA Rule 47)

**File:** [action-validator.ts:49-50](server/src/engine/action-validator.ts#L49-L50)

**Problem:** Our recent `alreadyActed` check unconditionally blocks RAISE for players in `actedThisRound`. But TDA Rule 47 says: *"an all-in wager (or cumulative multiple short all-ins) totaling less than a full bet or raise will not reopen betting for players who have already acted **and are not facing at least a full bet or raise** when the action returns to them."*

The key phrase: a player who already acted CAN raise if the amount they now face ≥ `lastRaiseSize`.

**Example:** A bets 100. B all-in 125 (+25 short). C calls. D all-in 200 (+75 short). E calls. Action returns to A: A faces 100 more (200 - 100). Since 100 ≥ lastRaiseSize (100), A should be able to raise. Currently, RAISE is blocked.

Then if A just calls, C faces only 75 more. 75 < 100, so C should NOT be able to raise. This correctly stays blocked.

**Fix:**
```typescript
// Current:
const alreadyActed = state.actedThisRound.includes(playerId);
if (state.currentBet > 0 && player.stack > callAmount && !alreadyActed) {

// Fixed:
const alreadyActed = state.actedThisRound.includes(playerId);
const facingFullRaise = alreadyActed && (state.currentBet - player.bet) >= state.lastRaiseSize;
if (state.currentBet > 0 && player.stack > callAmount && (!alreadyActed || facingFullRaise)) {
```

---

## New Test Categories

### 15. Cumulative Short All-Ins (TDA Rule 47 Extended) — 4 tests
- **15.1 [LIKELY BUG]** Two short all-ins that cumulatively equal a full raise → reopen for already-acted player
- **15.2** Two short all-ins that cumulatively DON'T equal a full raise → stays closed
- **15.3 [LIKELY BUG]** After cumulative reopen, non-facing player (C in example) still can't raise
- **15.4** TDA illustration Example 1: A bets 100, B all-in 125, C calls, D all-in 200, E calls → A can raise, then C cannot (exact scenario from rules doc)

### 16. All-In Showdown Card Visibility (TDA Rule 16) — 3 tests
When all betting is complete and at least one player is all-in, all hole cards should be visible. The engine uses `toClientGameState` with `stage === 'SHOWDOWN'` to reveal cards. Since the engine auto-advances through streets when all players are all-in, cards become visible at showdown.
- **16.1** Two players all-in pre-flop → cards visible at showdown to opponent
- **16.2** Three players: A all-in, B and C still betting → A's cards not visible until betting complete
- **16.3** All-in on flop, run-out to showdown → both hands visible

### 17. Complex Min-Raise Sequences (TDA Rule 43 Illustrations) — 4 tests
Directly from the TDA illustration addendum examples:
- **17.1** Example 1: A bets 600, B raises +1000 to 1600, C raises +2000 to 3600 → D's min raise is 2000 more (total 5600)
- **17.2** Example 2: Blinds 50-100, A all-in 150 (increment +50) → min raise for B is 100 more (total 250), not 150
- **17.3** Example 4-A: Blinds 25-50, A raises +75 to 125, B min-raises +75 to 200, C raises +300 to 500 → D's min raise is +300 (total 800)
- **17.4** Example 4-B: Blinds 25-50, A raises +450 to 500, B and C call → D's min raise is +450 (total 950)

### 18. No Raise Cap in No-Limit (TDA Rule 48) — 2 tests
- **18.1** Multiple re-raises allowed without limit (5+ raises in a round)
- **18.2** Heads-up re-raising back and forth works correctly

### 19. Dead Button Awareness (TDA Rule 32) — 2 tests
The engine doesn't implement dead button (button skips eliminated players). These tests verify the current behavior is at least consistent.
- **19.1** When a player busts in the button seat, button moves to next player
- **19.2** When a player busts between SB and button, blinds still post correctly

### 20. Heads-Up Transition (TDA Rule 34-B Extended) — 2 tests
- **20.1** No player gets BB twice in a row when transitioning to heads-up
- **20.2** Button position adjusts correctly when the eliminated player was the dealer

---

## Files to Modify

| File | Change |
|------|--------|
| [server/src/engine/action-validator.ts](server/src/engine/action-validator.ts) | Fix cumulative short all-in RAISE blocking (line ~49-50) |
| [server/__tests__/engine-tda-rules.test.ts](server/__tests__/engine-tda-rules.test.ts) | Add ~17 new tests (categories 15-20) |

---

## Verification

1. Run `cd server && npx jest __tests__/engine-tda-rules.test.ts` — all tests should pass (including new ones that test the bug fix)
2. Run `cd server && npx jest` — full suite, no regressions
