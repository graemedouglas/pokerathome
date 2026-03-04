# Plan: Comprehensive TDA-Based Edge Case Tests

## Context

The poker engine lacks tests for many edge cases defined in the TDA (Tournament Directors Association) 2024 rules. We want to add comprehensive tests targeting cash game and tournament (sit-and-go) modes, specifically around betting logic, blind posting, pot distribution, and tournament mechanics. Several of these tests are expected to expose real bugs in the engine.

All new tests go in `server/__tests__/engine-tda-rules.test.ts`, following existing patterns from `engine.test.ts` (Jest, rigged decks via `makePaddedDeck`, `createInitialState`/`addPlayer`/`startHand`/`processAction`).

---

## Identified Potential Bugs

These are areas where code analysis suggests the implementation diverges from TDA rules. Tests will confirm or refute each one.

### Bug 1: Short All-In Reopens Betting (TDA Rule 47) — HIGH confidence
In [game.ts:516-520](server/src/engine/game.ts#L516-L520), an ALL_IN that exceeds `currentBet` always resets `actedThisRound = []`, even if the raise increment is less than `lastRaiseSize`. Per TDA Rule 47, a short all-in (less than a full raise) should NOT reopen betting for players who already acted.

**Example:** A bets 200, B calls. C goes all-in for 250 (a 50 increment, less than the 200 lastRaiseSize). A and B should NOT get to raise again — they can only call the extra 50 or fold.

### Bug 2: Short BB Sets Wrong lastRaiseSize (TDA Rule 43) — MEDIUM confidence
In [game.ts:412-413](server/src/engine/game.ts#L412-L413), `currentBet` and `lastRaiseSize` are set to `bbAmount = Math.min(bigBlindAmount, bbPlayer.stack)`. When BB is short-stacked (e.g., stack=7, BB=10), the lastRaiseSize becomes 7 instead of 10, causing incorrect min raise calculations for all subsequent pre-flop action.

### Bug 3: Odd Chip Goes to Wrong Player (TDA Rule 20) — MEDIUM confidence
In [pot.ts:87](server/src/engine/pot.ts#L87), split pot remainder goes to `potWinners[0]` (hand evaluator ordering). TDA Rule 20 says the odd chip in board games goes to the first seat left of the button. This requires seat-position-aware distribution.

---

## Test Categories and Cases

### 1. Short All-In Reopening (TDA Rule 47) — 4 tests
- **1.1 [LIKELY BUG]** Short all-in does NOT reopen betting for players who already acted
- **1.2** Full all-in DOES reopen betting correctly
- **1.3 [LIKELY BUG]** After short all-in, players who already acted can only call/fold, not raise
- **1.4** All-in exactly equal to a full raise reopens betting

### 2. Minimum Raise Tracking (TDA Rule 43) — 5 tests
- **2.1** Min raise after initial bet = bet amount
- **2.2** Min raise after a raise = the last raise increment
- **2.3** lastRaiseSize resets to bigBlindAmount on new street
- **2.4 [LIKELY BUG]** lastRaiseSize when BB is short-stacked
- **2.5** Pre-flop raise sizes: call BB + raise by BB

### 3. Odd Chip Distribution (TDA Rule 20) — 3 tests
- **3.1 [LIKELY BUG]** Odd chip should go to first seat left of button in split pot
- **3.2** Even split distributes correctly
- **3.3** Three-way split with remainder

### 4. Heads-Up Rules (TDA Rule 34-B) — 4 tests
- **4.1** Dealer posts SB and acts first pre-flop
- **4.2** Non-dealer (BB) acts first post-flop
- **4.3** Deal order correctness with rigged deck
- **4.4** BB option after SB limps in heads-up

### 5. Short Blind Posting — 4 tests
- **5.1** SB can't cover full small blind → posts remainder, all-in
- **5.2 [LIKELY BUG]** BB can't cover full big blind → affects lastRaiseSize
- **5.3** Both SB and BB are short-stacked
- **5.4** Heads-up: SB is short → all-in from SB

### 6. All-In Run-Out — 4 tests
- **6.1** Both players all-in → all community cards dealt automatically
- **6.2** Three players, different all-in amounts → multiple side pots
- **6.3** One player folds, remaining all-in players run out
- **6.4** All-in on flop → turn and river dealt without betting

### 7. BB Option / Live Blind — 4 tests
- **7.1** BB gets option to raise after all limps
- **7.2** BB checks to end pre-flop
- **7.3** BB raises after limps → reopens action
- **7.4** BB all-in after limps

### 8. Pot Distribution — 5 tests
- **8.1** Single winner takes entire pot
- **8.2** Split pot with even division (board plays)
- **8.3** Side pot: short stack wins main, big stack wins side
- **8.4** Side pot with folded player's contribution
- **8.5** Multiple side pots (4 players, different stacks)

### 9. Stage Advancement — 4 tests
- **9.1** Full check-through from pre-flop to showdown
- **9.2** Skip betting when only 1 player can act
- **9.3** Post-flop first-to-act after some players folded
- **9.4** All-in run-out deals all remaining streets

### 10. Consecutive Hands — 4 tests
- **10.1** Stacks carry over between hands
- **10.2** State fully resets between hands
- **10.3** Dealer button advances each hand
- **10.4** Eliminated player excluded from next hand

### 11. Tournament-Specific — 6 tests
- **11.1** Antes posted from all active players
- **11.2** Player all-in from ante (stack < ante)
- **11.3** Ante consumes stack → can't post blind
- **11.4** Chip denomination enforcement on bets/raises
- **11.5** Chip denomination rounding: min > max → only ALL_IN available
- **11.6** Blind level advancement updates blinds

### 12. Action Validator Edge Cases — 4 tests
- **12.1** CALL not available when callAmount > stack
- **12.2** RAISE not available when stack = callAmount exactly
- **12.3** BET min capped at player stack
- **12.4** Tournament: amounts not divisible by chip denom rejected

### 13. Chip Conservation Invariant — 3 tests
- **13.1** Total chips conserved after simple hand
- **13.2** Total chips conserved with side pots
- **13.3** Total chips conserved in split pot with remainder

### 14. Multi-Way to Heads-Up Transition — 2 tests
- **14.1** Three players → one eliminated → heads-up blind structure
- **14.2** Button/blind positions adjust correctly for heads-up

**Total: ~54 test cases in one file**

---

## Files to Modify

| File | Action |
|------|--------|
| [server/__tests__/engine-tda-rules.test.ts](server/__tests__/engine-tda-rules.test.ts) | **Create** — all new tests |

No production code changes in this step — just tests. If tests expose bugs, we'll discuss fixes interactively.

---

## Verification

1. Run `cd server && npx jest __tests__/engine-tda-rules.test.ts` to execute new tests
2. Tests marked [LIKELY BUG] are expected to **fail** initially — this confirms the bug
3. For each failing test, we'll discuss whether it's a real bug or an intentional deviation from TDA rules before fixing
4. Run full suite `npx jest` to ensure no regressions
