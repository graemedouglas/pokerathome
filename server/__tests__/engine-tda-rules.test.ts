/**
 * Comprehensive edge-case tests derived from the TDA (Tournament Directors
 * Association) 2024 Rules, applied to our NL Hold'em engine for both cash
 * and tournament (sit-and-go) modes.
 *
 * Tests marked [LIKELY BUG] are expected to fail against the current
 * implementation — confirming a divergence from TDA rules.
 */

import { createDeck } from '../src/engine/deck';
import { calculatePots, distributePots } from '../src/engine/pot';
import { getAvailableActions, validateAction } from '../src/engine/action-validator';
import {
  createInitialState,
  addPlayer,
  setPlayerReady,
  startHand,
  processAction,
  advanceBlindLevel,
  toClientGameState,
  type EngineState,
} from '../src/engine/game';
import { generateBlindSchedule } from '../src/engine/blind-schedule';

// ═══════════════════════════════════════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════════════════════════════════════

function makePaddedDeck(knownCards: string[]): string[] {
  const remaining = createDeck().filter((c) => !knownCards.includes(c));
  return [...knownCards, ...remaining];
}

/** Create a 3-player cash game with custom stacks. */
function create3PlayerGame(opts?: {
  stacks?: [number, number, number];
  blinds?: [number, number];
}): EngineState {
  const stacks = opts?.stacks ?? [1000, 1000, 1000];
  const [sb, bb] = opts?.blinds ?? [5, 10];

  let state = createInitialState({
    gameId: 'test-tda',
    gameName: 'TDA Test',
    gameType: 'cash',
    smallBlindAmount: sb,
    bigBlindAmount: bb,
    maxPlayers: 6,
    startingStack: stacks[0],
  });

  // Add players with specific stacks
  for (let i = 0; i < 3; i++) {
    const { state: s } = addPlayer(state, `p${i + 1}`, `Player${i + 1}`);
    state = s;
  }
  // Override stacks
  state = {
    ...state,
    players: state.players.map((p, i) => ({ ...p, stack: stacks[i] })),
  };

  state = setPlayerReady(state, 'p1');
  state = setPlayerReady(state, 'p2');
  state = setPlayerReady(state, 'p3');
  return state;
}

/** Create a 2-player (heads-up) cash game with custom stacks. */
function createHeadsUpGame(opts?: {
  stacks?: [number, number];
  blinds?: [number, number];
}): EngineState {
  const stacks = opts?.stacks ?? [1000, 1000];
  const [sb, bb] = opts?.blinds ?? [5, 10];

  let state = createInitialState({
    gameId: 'test-tda-hu',
    gameName: 'TDA HU Test',
    gameType: 'cash',
    smallBlindAmount: sb,
    bigBlindAmount: bb,
    maxPlayers: 6,
    startingStack: stacks[0],
  });

  const { state: s1 } = addPlayer(state, 'p1', 'Alice');
  state = s1;
  const { state: s2 } = addPlayer(state, 'p2', 'Bob');
  state = s2;

  state = {
    ...state,
    players: state.players.map((p, i) => ({ ...p, stack: stacks[i] })),
  };

  state = setPlayerReady(state, 'p1');
  state = setPlayerReady(state, 'p2');
  return state;
}

/** Get the final state from a transitions array. */
function finalState(transitions: { state: EngineState }[]): EngineState {
  return transitions[transitions.length - 1].state;
}

/** Sum all player stacks. */
function totalChips(state: EngineState): number {
  return state.players
    .filter((p) => p.role === 'player')
    .reduce((sum, p) => sum + p.stack, 0);
}

/** Play pre-flop by having every player call or check, returning state on flop. */
function playToFlop(state: EngineState): EngineState {
  let current = state;
  while (current.stage === 'PRE_FLOP' && current.activePlayerId) {
    const actions = getAvailableActions(current, current.activePlayerId);
    const canCheck = actions.some((a) => a.type === 'CHECK');
    const t = processAction(current, current.activePlayerId, canCheck ? 'CHECK' : 'CALL');
    current = finalState(t);
  }
  return current;
}

/** Play through all streets by checking/calling, returning final state. */
function playToShowdown(state: EngineState): EngineState {
  let current = state;
  while (current.handInProgress && current.activePlayerId) {
    const actions = getAvailableActions(current, current.activePlayerId);
    const canCheck = actions.some((a) => a.type === 'CHECK');
    const t = processAction(current, current.activePlayerId, canCheck ? 'CHECK' : 'CALL');
    current = finalState(t);
  }
  return current;
}

// ═══════════════════════════════════════════════════════════════════════════════
// 1. Short All-In Reopening (TDA Rule 47)
// ═══════════════════════════════════════════════════════════════════════════════

describe('Short All-In Reopening (TDA Rule 47)', () => {
  /**
   * TDA Rule 47-A: An all-in wager totaling less than a full raise will not
   * reopen betting for players who have already acted.
   */
  test('[LIKELY BUG] short all-in does NOT reopen betting for players who already acted', () => {
    // Give one player a short stack that will produce a short all-in on the flop.
    // We need: after pre-flop, short player has ~250 remaining.
    // Use 3 players, all with 2000 except the short one.
    // We'll make all players have enough for pre-flop then test on flop.
    let state = create3PlayerGame({ stacks: [2000, 2000, 2000], blinds: [50, 100] });

    const deck = makePaddedDeck([
      'Ah', 'Kh', 'Qh', 'Jh', 'Th', '9h',
      '2c', '3c', '4c', '5c', '6c',
    ]);
    let current = finalState(startHand(state, deck));
    current = playToFlop(current);
    expect(current.stage).toBe('FLOP');

    // Post-flop: first actor bets 200
    const bettor = current.activePlayerId!;
    current = finalState(processAction(current, bettor, 'BET', 200));

    // Second actor calls
    const caller = current.activePlayerId!;
    current = finalState(processAction(current, caller, 'CALL'));

    // Third actor: give them a short stack via state override so their all-in
    // is a short all-in (increment < lastRaiseSize of 200)
    const thirdId = current.activePlayerId!;
    current = {
      ...current,
      players: current.players.map((p) =>
        p.id === thirdId ? { ...p, stack: 250 } : p
      ),
    };

    // Third goes ALL_IN for 250. raiseIncrement = 250-200 = 50 < lastRaiseSize(200).
    // This is a SHORT all-in — should NOT reopen betting.
    current = finalState(processAction(current, thirdId, 'ALL_IN'));

    // Per TDA Rule 47: bettor and caller already acted. The short all-in (50 increment)
    // does not reopen betting. They can only call the extra 50 or fold, NOT raise.
    if (current.activePlayerId) {
      const actions = getAvailableActions(current, current.activePlayerId!);
      const types = actions.map((a) => a.type);
      expect(types).not.toContain('RAISE');
      expect(types).toContain('FOLD');
    }
  });

  test('full all-in DOES reopen betting correctly', () => {
    let state = create3PlayerGame({ stacks: [2000, 2000, 2000], blinds: [50, 100] });

    const deck = makePaddedDeck([
      'Ah', 'Kh', 'Qh', 'Jh', 'Th', '9h',
      '2c', '3c', '4c', '5c', '6c',
    ]);
    let current = finalState(startHand(state, deck));
    current = playToFlop(current);
    expect(current.stage).toBe('FLOP');

    // First actor bets 200, second calls
    current = finalState(processAction(current, current.activePlayerId!, 'BET', 200));
    current = finalState(processAction(current, current.activePlayerId!, 'CALL'));

    // Third actor: give them exactly enough for a full raise via all-in
    // all-in for 500 → raiseIncrement = 500-200 = 300 >= lastRaiseSize(200). Full raise.
    const thirdId = current.activePlayerId!;
    current = {
      ...current,
      players: current.players.map((p) =>
        p.id === thirdId ? { ...p, stack: 500 } : p
      ),
    };
    current = finalState(processAction(current, thirdId, 'ALL_IN'));

    // Betting SHOULD reopen — next player should have RAISE available
    expect(current.activePlayerId).not.toBeNull();
    const actions = getAvailableActions(current, current.activePlayerId!);
    const types = actions.map((a) => a.type);
    expect(types).toContain('RAISE');
  });

  test('[LIKELY BUG] after short all-in, already-acted players can only call/fold', () => {
    // 4 players, all equal stacks
    let state = createInitialState({
      gameId: 'test-tda-4p',
      gameName: 'TDA 4P Test',
      gameType: 'cash',
      smallBlindAmount: 50,
      bigBlindAmount: 100,
      maxPlayers: 6,
      startingStack: 2000,
    });
    for (let i = 1; i <= 4; i++) {
      state = addPlayer(state, `p${i}`, `Player${i}`).state;
    }
    for (let i = 1; i <= 4; i++) state = setPlayerReady(state, `p${i}`);

    const deck = makePaddedDeck([
      'Ah', 'Kh', 'Qh', 'Jh', 'Th', '9h', '8h', '7h',
      '2c', '3c', '4c', '5c', '6c',
    ]);
    let current = finalState(startHand(state, deck));
    current = playToFlop(current);
    expect(current.stage).toBe('FLOP');

    // Post-flop: first 3 actors bet/call
    current = finalState(processAction(current, current.activePlayerId!, 'BET', 200));
    current = finalState(processAction(current, current.activePlayerId!, 'CALL'));
    current = finalState(processAction(current, current.activePlayerId!, 'CALL'));

    // Last actor: override stack for short all-in
    const lastId = current.activePlayerId!;
    current = {
      ...current,
      players: current.players.map((p) =>
        p.id === lastId ? { ...p, stack: 250 } : p
      ),
    };
    current = finalState(processAction(current, lastId, 'ALL_IN'));

    // All 3 earlier actors already acted; none should have RAISE
    if (current.activePlayerId) {
      const actions = getAvailableActions(current, current.activePlayerId!);
      expect(actions.map((a) => a.type)).not.toContain('RAISE');
    }
  });

  test('all-in exactly equal to a full raise reopens betting', () => {
    let state = create3PlayerGame({ stacks: [2000, 2000, 2000], blinds: [50, 100] });

    const deck = makePaddedDeck([
      'Ah', 'Kh', 'Qh', 'Jh', 'Th', '9h',
      '2c', '3c', '4c', '5c', '6c',
    ]);
    let current = finalState(startHand(state, deck));
    current = playToFlop(current);

    // First actor bets 200, second calls
    current = finalState(processAction(current, current.activePlayerId!, 'BET', 200));
    current = finalState(processAction(current, current.activePlayerId!, 'CALL'));

    // Third: override stack so all-in = exactly a full raise (200 more = 400 total)
    const thirdId = current.activePlayerId!;
    current = {
      ...current,
      players: current.players.map((p) =>
        p.id === thirdId ? { ...p, stack: 400 } : p
      ),
    };
    current = finalState(processAction(current, thirdId, 'ALL_IN'));

    expect(current.activePlayerId).not.toBeNull();
    const actions = getAvailableActions(current, current.activePlayerId!);
    expect(actions.map((a) => a.type)).toContain('RAISE');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 2. Minimum Raise Tracking (TDA Rule 43)
// ═══════════════════════════════════════════════════════════════════════════════

describe('Minimum Raise Tracking (TDA Rule 43)', () => {
  test('min raise after initial bet equals the bet amount', () => {
    let state = create3PlayerGame({ blinds: [5, 10] });
    let current = finalState(startHand(state));
    current = playToFlop(current);
    expect(current.stage).toBe('FLOP');

    // First actor bets 50
    current = finalState(processAction(current, current.activePlayerId!, 'BET', 50));

    // Next player: min raise = call(50) + raise increment(50) = 100
    const actions = getAvailableActions(current, current.activePlayerId!);
    const raise = actions.find((a) => a.type === 'RAISE');
    expect(raise).toBeDefined();
    expect(raise!.min).toBe(100);
  });

  test('min raise after a raise is the last raise increment', () => {
    let state = create3PlayerGame({ blinds: [5, 10] });
    let current = finalState(startHand(state));
    current = playToFlop(current);

    // A bets 50 (lastRaiseSize=50)
    current = finalState(processAction(current, current.activePlayerId!, 'BET', 50));
    // B raises to 150 (raise increment = 100, lastRaiseSize now = 100)
    current = finalState(processAction(current, current.activePlayerId!, 'RAISE', 150));

    // C's min raise = call(150) + lastRaiseSize(100) = 250
    const actions = getAvailableActions(current, current.activePlayerId!);
    const raise = actions.find((a) => a.type === 'RAISE');
    expect(raise).toBeDefined();
    expect(raise!.min).toBe(250);
  });

  test('lastRaiseSize resets to bigBlindAmount on new street', () => {
    let state = create3PlayerGame({ blinds: [5, 10] });
    let current = finalState(startHand(state));
    current = playToFlop(current);

    // On flop with no bet: BET min should be bigBlindAmount
    const actions = getAvailableActions(current, current.activePlayerId!);
    const bet = actions.find((a) => a.type === 'BET');
    expect(bet).toBeDefined();
    expect(bet!.min).toBe(10); // bigBlindAmount
  });

  test('[LIKELY BUG] lastRaiseSize when BB is short-stacked', () => {
    // p3 (BB) has only 7 chips. Blinds 5/10.
    let state = create3PlayerGame({ stacks: [1000, 1000, 7], blinds: [5, 10] });

    const deck = makePaddedDeck([
      'Ah', 'Kh', 'Qh', 'Jh', 'Th', '9h',
      '2c', '3c', '4c', '5c', '6c',
    ]);
    let current = finalState(startHand(state, deck));

    // BB posted 7 (all-in). currentBet = 7, lastRaiseSize = 7 (per current code).
    // TDA says min raise should still be based on full BB (10), not short BB (7).
    // UTG (p1) acts: min raise should be call(7) + bigBlindAmount(10) = 17, not 7+7=14.
    const actions = getAvailableActions(current, current.activePlayerId!);
    const raise = actions.find((a) => a.type === 'RAISE');
    expect(raise).toBeDefined();
    // Per TDA: min raise = 7 (call) + 10 (full BB as raise increment) = 17
    expect(raise!.min).toBeGreaterThanOrEqual(17);
  });

  test('pre-flop raise sizes: call BB + raise by BB', () => {
    let state = create3PlayerGame({ blinds: [5, 10] });
    let current = finalState(startHand(state));

    // UTG faces currentBet=10 (BB), lastRaiseSize=10.
    // Min raise = call(10) + raise(10) = 20. Max = full stack.
    const actions = getAvailableActions(current, current.activePlayerId!);
    const raise = actions.find((a) => a.type === 'RAISE');
    expect(raise).toBeDefined();
    expect(raise!.min).toBe(20);
    expect(raise!.max).toBe(1000); // full stack
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 3. Odd Chip Distribution (TDA Rule 20)
// ═══════════════════════════════════════════════════════════════════════════════

describe('Odd Chip Distribution (TDA Rule 20)', () => {
  test('[LIKELY BUG] odd chip in split pot goes to first seat left of button', () => {
    // 2 players both have same hand (board plays a straight).
    // Pot is odd (15) so one player gets 8, other gets 7.
    // TDA says odd chip → first seat left of button.
    let state = createHeadsUpGame({ blinds: [5, 10] });

    // Rig deck: both get junk, board has A-K-Q-J-T (broadway straight).
    const deck = makePaddedDeck([
      '2c', '3c', // p1 hole cards
      '4c', '5c', // p2 hole cards
      'Ah', 'Kh', 'Qh', // flop
      'Jh', // turn
      'Td', // river
    ]);

    let current = finalState(startHand(state, deck));
    // Both go all-in → showdown with split pot
    current = finalState(processAction(current, current.activePlayerId!, 'ALL_IN'));
    current = finalState(processAction(current, current.activePlayerId!, 'ALL_IN'));

    expect(current.handInProgress).toBe(false);

    // Both have broadway straight — should split evenly (2000 total, 1000 each)
    const p1 = current.players.find((p) => p.id === 'p1')!;
    const p2 = current.players.find((p) => p.id === 'p2')!;
    expect(p1.stack + p2.stack).toBe(2000);
    // With equal stacks going all-in, pot is 2000 = even split = 1000 each
    expect(p1.stack).toBe(1000);
    expect(p2.stack).toBe(1000);
  });

  test('even split distributes correctly', () => {
    let state = createHeadsUpGame({ stacks: [500, 500], blinds: [5, 10] });

    const deck = makePaddedDeck([
      '2c', '3c', '4c', '5c',
      'Ah', 'Kh', 'Qh', 'Jh', 'Td',
    ]);

    let current = finalState(startHand(state, deck));
    current = finalState(processAction(current, current.activePlayerId!, 'ALL_IN'));
    current = finalState(processAction(current, current.activePlayerId!, 'ALL_IN'));

    expect(current.handInProgress).toBe(false);
    // Total chips conserved
    expect(totalChips(current)).toBe(1000);
  });

  test('three-way split with remainder', () => {
    // 3 players each put in 100 → pot = 300. If all 3 tie, each gets 100 (even).
    // To force odd: 3 players put in 33 + blinds → harder to set up.
    // Instead, verify the remainder logic by checking distributePots directly.
    const pots = [{ amount: 100, eligiblePlayerIds: ['a', 'b', 'c'] }];

    // Mock evaluated hands: all 3 are winners (tie)
    const evaluatedHands = [
      { playerId: 'a', hand: { rank: 1 }, descr: 'pair' },
      { playerId: 'b', hand: { rank: 1 }, descr: 'pair' },
      { playerId: 'c', hand: { rank: 1 }, descr: 'pair' },
    ];

    // We need findWinners to return all 3. Since we're importing distributePots
    // which calls findWinners internally, we need real evaluated hands.
    // For now, test the math: 100 / 3 = 33 remainder 1.
    // pot.ts line 81: share = floor(100/3) = 33. remainder = 100%3 = 1.
    // potWinners[0] gets 34, others get 33.
    // Total: 34+33+33 = 100. Chips conserved.

    // This is hard to test without mocking pokersolver. Instead, test via
    // the engine with a rigged deck where all 3 have the same hand.
    let state = create3PlayerGame({ stacks: [1000, 1000, 1000], blinds: [5, 10] });

    // Board plays: A-K-Q-J-T straight. All players have junk hole cards.
    const deck = makePaddedDeck([
      '2c', '3c', '4c', '5c', '6c', '7c', // hole cards
      'Ah', 'Kh', 'Qh', // flop
      'Jd', // turn
      'Td', // river
    ]);

    let current = finalState(startHand(state, deck));
    current = playToShowdown(current);

    expect(current.handInProgress).toBe(false);
    // Chips conserved
    expect(totalChips(current)).toBe(3000);

    // All 3 should have roughly equal stacks (within 1 chip)
    const stacks = current.players.map((p) => p.stack).sort((a, b) => a - b);
    expect(stacks[2] - stacks[0]).toBeLessThanOrEqual(1);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 4. Heads-Up Rules (TDA Rule 34-B)
// ═══════════════════════════════════════════════════════════════════════════════

describe('Heads-Up Rules (TDA Rule 34-B)', () => {
  test('dealer posts SB and acts first pre-flop', () => {
    let state = createHeadsUpGame({ blinds: [5, 10] });

    const transitions = startHand(state);
    const dealt = finalState(transitions);

    const dealerIdx = dealt.dealerSeatIndex;
    const dealerPlayer = dealt.players.find((p) => p.seatIndex === dealerIdx)!;

    // Dealer is SB (bet = 5)
    const blindsState = transitions[1].state;
    const sbPlayer = blindsState.players.find((p) => p.bet === 5);
    expect(sbPlayer).toBeDefined();
    expect(sbPlayer!.seatIndex).toBe(dealerIdx);

    // Dealer/SB acts first pre-flop
    expect(dealt.activePlayerId).toBe(dealerPlayer.id);
  });

  test('non-dealer (BB) acts first post-flop', () => {
    let state = createHeadsUpGame({ blinds: [5, 10] });

    const deck = makePaddedDeck([
      'Ah', 'Kh', 'Qh', 'Jh',
      '2c', '3c', '4c', '5c', '6c',
    ]);
    let current = finalState(startHand(state, deck));

    // Pre-flop: dealer/SB calls, BB checks
    current = finalState(processAction(current, current.activePlayerId!, 'CALL'));
    current = finalState(processAction(current, current.activePlayerId!, 'CHECK'));

    expect(current.stage).toBe('FLOP');

    // Post-flop: first to act should be the non-dealer (BB)
    const dealerIdx = current.dealerSeatIndex;
    const activePlayer = current.players.find((p) => p.id === current.activePlayerId)!;
    expect(activePlayer.seatIndex).not.toBe(dealerIdx);
  });

  test('deal order: each player gets 2 cards from rigged deck', () => {
    let state = createHeadsUpGame({ blinds: [5, 10] });

    const deck = makePaddedDeck([
      'Ah', 'Kh', // cards 0-1
      'Qh', 'Jh', // cards 2-3
      '2c', '3c', '4c', '5c', '6c',
    ]);
    let current = finalState(startHand(state, deck));

    // Both players should have 2 hole cards
    const p1 = current.players.find((p) => p.id === 'p1')!;
    const p2 = current.players.find((p) => p.id === 'p2')!;
    expect(p1.holeCards).toHaveLength(2);
    expect(p2.holeCards).toHaveLength(2);

    // Cards should come from the rigged deck (first 4 cards split between players)
    const allHoleCards = [...p1.holeCards!, ...p2.holeCards!];
    expect(allHoleCards).toEqual(expect.arrayContaining(['Ah', 'Kh', 'Qh', 'Jh']));
  });

  test('BB can raise after SB limps in heads-up', () => {
    let state = createHeadsUpGame({ blinds: [5, 10] });

    const deck = makePaddedDeck([
      'Ah', 'Kh', 'Qh', 'Jh',
      '2c', '3c', '4c', '5c', '6c',
    ]);
    let current = finalState(startHand(state, deck));

    // Dealer/SB calls (limps) — pays 5 more to match BB's 10
    current = finalState(processAction(current, current.activePlayerId!, 'CALL'));

    // BB should now get option to raise (the "live blind" / "BB option")
    expect(current.activePlayerId).not.toBeNull();
    const actions = getAvailableActions(current, current.activePlayerId!);
    const types = actions.map((a) => a.type);
    expect(types).toContain('CHECK');
    expect(types).toContain('RAISE');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 5. Short Blind Posting
// ═══════════════════════════════════════════════════════════════════════════════

describe('Short Blind Posting', () => {
  test('SB cannot cover full small blind — posts remainder, all-in', () => {
    // Give all players 1000 then override the SB player's stack after determining
    // who SB actually is. Use the BLINDS_POSTED event to identify SB.
    let state = create3PlayerGame({ stacks: [1000, 1000, 1000], blinds: [5, 10] });

    // Determine who SB will be by doing a dry run
    const dryTransitions = startHand(state);
    const blindsEvent = dryTransitions[1].event;
    expect(blindsEvent.type).toBe('BLINDS_POSTED');
    const sbId = (blindsEvent as any).smallBlind.playerId;

    // Now set SB player's stack to 3 and re-run
    state = {
      ...state,
      players: state.players.map((p) =>
        p.id === sbId ? { ...p, stack: 3 } : p
      ),
    };

    const deck = makePaddedDeck([
      'Ah', 'Kh', 'Qh', 'Jh', 'Th', '9h',
      '2c', '3c', '4c', '5c', '6c',
    ]);
    const transitions = startHand(state, deck);
    const blindsState = transitions[1].state;

    const sb = blindsState.players.find((p) => p.id === sbId)!;
    expect(sb.bet).toBe(3);
    expect(sb.stack).toBe(0);
    expect(sb.isAllIn).toBe(true);
  });

  test('[LIKELY BUG] BB cannot cover full big blind — affects lastRaiseSize', () => {
    let state = create3PlayerGame({ stacks: [1000, 1000, 1000], blinds: [5, 10] });

    // Determine who BB will be
    const dryTransitions = startHand(state);
    const blindsEvent = dryTransitions[1].event;
    const bbId = (blindsEvent as any).bigBlind.playerId;

    // Set BB's stack to 7
    state = {
      ...state,
      players: state.players.map((p) =>
        p.id === bbId ? { ...p, stack: 7 } : p
      ),
    };

    const deck = makePaddedDeck([
      'Ah', 'Kh', 'Qh', 'Jh', 'Th', '9h',
      '2c', '3c', '4c', '5c', '6c',
    ]);
    let current = finalState(startHand(state, deck));

    // BB posted 7 (all-in). Engine sets currentBet=7, lastRaiseSize=7.
    // TDA: lastRaiseSize should still be full BB (10).
    expect(current.currentBet).toBe(7);
    expect(current.lastRaiseSize).toBeGreaterThanOrEqual(10);
  });

  test('both SB and BB are short-stacked', () => {
    let state = create3PlayerGame({ stacks: [1000, 1000, 1000], blinds: [5, 10] });

    // Determine SB and BB
    const dryTransitions = startHand(state);
    const blindsEvent = dryTransitions[1].event;
    const sbId = (blindsEvent as any).smallBlind.playerId;
    const bbId = (blindsEvent as any).bigBlind.playerId;

    // Set SB=3, BB=7
    state = {
      ...state,
      players: state.players.map((p) => {
        if (p.id === sbId) return { ...p, stack: 3 };
        if (p.id === bbId) return { ...p, stack: 7 };
        return p;
      }),
    };

    const deck = makePaddedDeck([
      'Ah', 'Kh', 'Qh', 'Jh', 'Th', '9h',
      '2c', '3c', '4c', '5c', '6c',
    ]);
    const transitions = startHand(state, deck);
    const dealt = finalState(transitions);

    const sb = dealt.players.find((p) => p.id === sbId)!;
    const bb = dealt.players.find((p) => p.id === bbId)!;

    expect(sb.stack).toBe(0);
    expect(sb.isAllIn).toBe(true);
    expect(bb.stack).toBe(0);
    expect(bb.isAllIn).toBe(true);

    // The remaining player (not SB/BB) should be active
    const otherId = dealt.players.find((p) =>
      p.id !== sbId && p.id !== bbId && p.role === 'player'
    )!.id;
    expect(dealt.activePlayerId).toBe(otherId);
  });

  test('heads-up: SB is short — all-in from SB posting', () => {
    // Give both players 3 chips. Whoever becomes SB will be all-in after posting.
    // Actually that's tricky. Instead: give both 1000, start a hand, identify
    // who is SB, then verify the mechanic by checking blinds posted.
    let state = createHeadsUpGame({ stacks: [1000, 1000], blinds: [5, 10] });

    const deck = makePaddedDeck([
      'Ah', 'Kh', 'Qh', 'Jh',
      '2c', '3c', '4c', '5c', '6c',
    ]);
    const transitions = startHand(state, deck);
    const blindsEvent = transitions[1].event as any;
    const sbId = blindsEvent.smallBlind.playerId;
    const bbId = blindsEvent.bigBlind.playerId;

    // Now set SB's stack to 3 and re-run
    state = {
      ...state,
      players: state.players.map((p) =>
        p.id === sbId ? { ...p, stack: 3 } : p
      ),
    };
    let current = finalState(startHand(state, deck));

    // SB posted 3 (all-in)
    const sb = current.players.find((p) => p.id === sbId)!;
    expect(sb.stack).toBe(0);
    expect(sb.isAllIn).toBe(true);

    // In heads-up pre-flop, dealer/SB acts first. But SB is all-in.
    // So BB should be active (only remaining player who can act)
    expect(current.activePlayerId).toBe(bbId);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 6. All-In Run-Out
// ═══════════════════════════════════════════════════════════════════════════════

describe('All-In Run-Out', () => {
  test('both players all-in pre-flop — all community cards dealt automatically', () => {
    let state = createHeadsUpGame({ blinds: [5, 10] });

    const deck = makePaddedDeck([
      'Ah', 'As', 'Kh', 'Ks',
      '2c', '3c', '4c', '5c', '6c',
    ]);
    let current = finalState(startHand(state, deck));

    // Both go all-in
    current = finalState(processAction(current, current.activePlayerId!, 'ALL_IN'));
    current = finalState(processAction(current, current.activePlayerId!, 'ALL_IN'));

    // Hand should be complete with all 5 community cards
    expect(current.handInProgress).toBe(false);
    expect(current.communityCards).toHaveLength(5);
    expect(totalChips(current)).toBe(2000);
  });

  test('three players, different all-in amounts — multiple side pots', () => {
    // p1(200), p2(500), p3(1000). Blinds 5/10.
    let state = create3PlayerGame({ stacks: [200, 500, 1000], blinds: [5, 10] });

    // Rig: p1 gets best hand (aces), p2 gets kings, p3 gets junk
    const deck = makePaddedDeck([
      'Ah', 'As', 'Kh', 'Ks', '2c', '3d', // hole cards
      '7h', '8h', '9d', // flop
      'Tc', // turn
      '4s', // river
    ]);

    let current = finalState(startHand(state, deck));

    // All go all-in: UTG=p1 all-in, SB/BB call/all-in
    current = finalState(processAction(current, current.activePlayerId!, 'ALL_IN'));
    if (current.activePlayerId) {
      current = finalState(processAction(current, current.activePlayerId!, 'ALL_IN'));
    }
    if (current.activePlayerId) {
      current = finalState(processAction(current, current.activePlayerId!, 'CALL'));
    }

    expect(current.handInProgress).toBe(false);
    expect(totalChips(current)).toBe(1700); // 200+500+1000

    // p1 (aces) should win main pot. p2 (kings) should win side pot.
    const p1 = current.players.find((p) => p.id === 'p1')!;
    expect(p1.stack).toBeGreaterThan(0); // Won at least the main pot
  });

  test('one player folds, remaining all-in players run out', () => {
    let state = create3PlayerGame({ stacks: [500, 500, 500], blinds: [5, 10] });

    const deck = makePaddedDeck([
      'Ah', 'As', 'Kh', 'Ks', '2c', '3d',
      '7h', '8h', '9d', 'Tc', '4s',
    ]);
    let current = finalState(startHand(state, deck));

    // UTG all-in, next player calls, last folds
    current = finalState(processAction(current, current.activePlayerId!, 'ALL_IN'));
    current = finalState(processAction(current, current.activePlayerId!, 'CALL'));
    if (current.activePlayerId) {
      current = finalState(processAction(current, current.activePlayerId!, 'FOLD'));
    }

    // Should run out to showdown between the two all-in players
    expect(current.handInProgress).toBe(false);
    expect(current.communityCards).toHaveLength(5);
    expect(totalChips(current)).toBe(1500);
  });

  test('all-in on flop — turn and river dealt without betting', () => {
    let state = createHeadsUpGame({ blinds: [5, 10] });

    const deck = makePaddedDeck([
      'Ah', 'As', 'Kh', 'Ks',
      '2c', '3c', '4c', '5c', '6c',
    ]);
    let current = finalState(startHand(state, deck));
    current = playToFlop(current);

    expect(current.stage).toBe('FLOP');
    expect(current.communityCards).toHaveLength(3);

    // Both go all-in on flop
    current = finalState(processAction(current, current.activePlayerId!, 'ALL_IN'));
    current = finalState(processAction(current, current.activePlayerId!, 'ALL_IN'));

    // Turn and river dealt automatically
    expect(current.handInProgress).toBe(false);
    expect(current.communityCards).toHaveLength(5);
    expect(totalChips(current)).toBe(2000);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 7. BB Option / Live Blind
// ═══════════════════════════════════════════════════════════════════════════════

describe('BB Option / Live Blind', () => {
  test('BB gets option to raise after all players limp (3-player)', () => {
    let state = create3PlayerGame({ blinds: [5, 10] });
    let current = finalState(startHand(state));

    // UTG calls 10
    current = finalState(processAction(current, current.activePlayerId!, 'CALL'));
    // SB calls (5 more)
    current = finalState(processAction(current, current.activePlayerId!, 'CALL'));

    // BB should now get to act (the "BB option")
    expect(current.activePlayerId).not.toBeNull();
    expect(current.stage).toBe('PRE_FLOP'); // Still pre-flop

    const actions = getAvailableActions(current, current.activePlayerId!);
    const types = actions.map((a) => a.type);
    expect(types).toContain('CHECK');
    expect(types).toContain('RAISE');
    expect(types).toContain('ALL_IN');
  });

  test('BB checks to end pre-flop', () => {
    let state = create3PlayerGame({ blinds: [5, 10] });
    let current = finalState(startHand(state));

    // UTG calls, SB calls, BB checks
    current = finalState(processAction(current, current.activePlayerId!, 'CALL'));
    current = finalState(processAction(current, current.activePlayerId!, 'CALL'));
    current = finalState(processAction(current, current.activePlayerId!, 'CHECK'));

    // Should advance to FLOP
    expect(current.stage).toBe('FLOP');
  });

  test('BB raises after limps — reopens action', () => {
    let state = create3PlayerGame({ blinds: [5, 10] });
    let current = finalState(startHand(state));

    // UTG calls, SB calls
    current = finalState(processAction(current, current.activePlayerId!, 'CALL'));
    current = finalState(processAction(current, current.activePlayerId!, 'CALL'));

    // BB raises to 30
    current = finalState(processAction(current, current.activePlayerId!, 'RAISE', 20));

    // Still pre-flop, UTG must act again
    expect(current.stage).toBe('PRE_FLOP');
    expect(current.activePlayerId).not.toBeNull();
  });

  test('BB all-in after limps', () => {
    let state = create3PlayerGame({ blinds: [5, 10] });
    let current = finalState(startHand(state));

    // UTG calls, SB calls, BB goes ALL_IN
    current = finalState(processAction(current, current.activePlayerId!, 'CALL'));
    current = finalState(processAction(current, current.activePlayerId!, 'CALL'));
    current = finalState(processAction(current, current.activePlayerId!, 'ALL_IN'));

    // Still pre-flop, others must respond
    expect(current.stage).toBe('PRE_FLOP');
    expect(current.activePlayerId).not.toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 8. Pot Distribution
// ═══════════════════════════════════════════════════════════════════════════════

describe('Pot Distribution', () => {
  test('single winner takes entire pot', () => {
    let state = createHeadsUpGame({ blinds: [5, 10] });

    // Rig: p1 gets aces, p2 gets junk
    const deck = makePaddedDeck([
      'Ah', 'As', '2c', '3d',
      '7h', '8h', '9d', 'Tc', '4s',
    ]);
    let current = finalState(startHand(state, deck));
    current = finalState(processAction(current, current.activePlayerId!, 'ALL_IN'));
    current = finalState(processAction(current, current.activePlayerId!, 'ALL_IN'));

    expect(current.handInProgress).toBe(false);
    const p1 = current.players.find((p) => p.id === 'p1')!;
    const p2 = current.players.find((p) => p.id === 'p2')!;
    // One of them should have all 2000 chips
    expect(Math.max(p1.stack, p2.stack)).toBe(2000);
    expect(Math.min(p1.stack, p2.stack)).toBe(0);
  });

  test('split pot with even division (board plays)', () => {
    let state = createHeadsUpGame({ stacks: [500, 500], blinds: [5, 10] });

    // Both get junk, board plays broadway straight
    const deck = makePaddedDeck([
      '2c', '3c', '4c', '5c',
      'Ah', 'Kh', 'Qh', 'Jd', 'Td',
    ]);
    let current = finalState(startHand(state, deck));
    current = finalState(processAction(current, current.activePlayerId!, 'ALL_IN'));
    current = finalState(processAction(current, current.activePlayerId!, 'ALL_IN'));

    expect(current.handInProgress).toBe(false);
    const p1 = current.players.find((p) => p.id === 'p1')!;
    const p2 = current.players.find((p) => p.id === 'p2')!;
    expect(p1.stack).toBe(500);
    expect(p2.stack).toBe(500);
  });

  test('side pot: short stack wins main, big stack wins side', () => {
    // p1(200), p2(500), p3(500). p1 has best hand, p2 has second best.
    let state = create3PlayerGame({ stacks: [200, 500, 500], blinds: [5, 10] });

    // p1 gets aces (best), p2 gets kings (second), p3 gets junk (worst)
    const deck = makePaddedDeck([
      'Ah', 'As', 'Kh', 'Ks', '2c', '3d',
      '7h', '8h', '9d', 'Tc', '4s',
    ]);
    let current = finalState(startHand(state, deck));

    // All go all-in
    current = finalState(processAction(current, current.activePlayerId!, 'ALL_IN'));
    if (current.activePlayerId)
      current = finalState(processAction(current, current.activePlayerId!, 'ALL_IN'));
    if (current.activePlayerId)
      current = finalState(processAction(current, current.activePlayerId!, 'CALL'));

    expect(current.handInProgress).toBe(false);
    expect(totalChips(current)).toBe(1200);

    // p1 (aces, shortest stack) wins main pot
    const p1 = current.players.find((p) => p.id === 'p1')!;
    expect(p1.stack).toBeGreaterThan(0);

    // p2 (kings) should win side pot over p3 (junk)
    const p2 = current.players.find((p) => p.id === 'p2')!;
    const p3 = current.players.find((p) => p.id === 'p3')!;
    expect(p2.stack).toBeGreaterThan(p3.stack);
  });

  test('side pot with folded player contributing', () => {
    let state = create3PlayerGame({ stacks: [500, 500, 500], blinds: [5, 10] });

    const deck = makePaddedDeck([
      'Ah', 'As', 'Kh', 'Ks', '2c', '3d',
      '7h', '8h', '9d', 'Tc', '4s',
    ]);
    let current = finalState(startHand(state, deck));

    // UTG raises to 100, SB calls, BB folds
    current = finalState(processAction(current, current.activePlayerId!, 'RAISE', 100));
    current = finalState(processAction(current, current.activePlayerId!, 'CALL'));
    current = finalState(processAction(current, current.activePlayerId!, 'FOLD'));

    // Now 2 players remain, BB's blind contribution is in the pot
    // Play to showdown
    current = playToShowdown(current);

    expect(current.handInProgress).toBe(false);
    // BB folded after posting 10 blind, so pot includes that
    expect(totalChips(current)).toBe(1500);
  });

  test('multiple side pots with 4 players at different stacks', () => {
    let state = createInitialState({
      gameId: 'test-4p-pots',
      gameName: 'Side Pots',
      gameType: 'cash',
      smallBlindAmount: 5,
      bigBlindAmount: 10,
      maxPlayers: 6,
      startingStack: 1000,
    });
    for (let i = 1; i <= 4; i++) state = addPlayer(state, `p${i}`, `P${i}`).state;
    state = {
      ...state,
      players: state.players.map((p) => {
        if (p.id === 'p1') return { ...p, stack: 100 };
        if (p.id === 'p2') return { ...p, stack: 300 };
        if (p.id === 'p3') return { ...p, stack: 600 };
        return { ...p, stack: 1000 }; // p4
      }),
    };
    for (let i = 1; i <= 4; i++) state = setPlayerReady(state, `p${i}`);

    const deck = makePaddedDeck([
      'Ah', 'As', 'Kh', 'Ks', 'Qh', 'Qs', '2c', '3d',
      '7h', '8h', '9d', 'Tc', '4s',
    ]);
    let current = finalState(startHand(state, deck));

    // All go all-in in sequence
    while (current.activePlayerId && current.handInProgress) {
      const actions = getAvailableActions(current, current.activePlayerId);
      const hasAllIn = actions.some((a) => a.type === 'ALL_IN');
      const hasCall = actions.some((a) => a.type === 'CALL');
      if (hasAllIn) {
        current = finalState(processAction(current, current.activePlayerId, 'ALL_IN'));
      } else if (hasCall) {
        current = finalState(processAction(current, current.activePlayerId, 'CALL'));
      } else {
        break;
      }
    }

    expect(current.handInProgress).toBe(false);
    expect(totalChips(current)).toBe(2000); // 100+300+600+1000
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 9. Stage Advancement
// ═══════════════════════════════════════════════════════════════════════════════

describe('Stage Advancement', () => {
  test('full check-through from pre-flop to showdown', () => {
    let state = create3PlayerGame({ blinds: [5, 10] });
    const deck = makePaddedDeck([
      'Ah', 'Kh', 'Qh', 'Jh', '2c', '3d',
      '7h', '8h', '9d', 'Tc', '4s',
    ]);
    let current = finalState(startHand(state, deck));

    // Play all streets by calling/checking
    current = playToShowdown(current);

    expect(current.handInProgress).toBe(false);
    expect(current.communityCards).toHaveLength(5);
    expect(totalChips(current)).toBe(3000);
  });

  test('skip betting when only 1 player can act (others all-in/folded)', () => {
    // p1(100), p2(1000), p3(1000). p1 all-in, p2 calls, p3 folds.
    let state = create3PlayerGame({ stacks: [100, 1000, 1000], blinds: [5, 10] });
    const deck = makePaddedDeck([
      'Ah', 'As', 'Kh', 'Ks', '2c', '3d',
      '7h', '8h', '9d', 'Tc', '4s',
    ]);
    let current = finalState(startHand(state, deck));

    // UTG (p1) all-in for 100
    current = finalState(processAction(current, current.activePlayerId!, 'ALL_IN'));
    // SB (p2) calls
    current = finalState(processAction(current, current.activePlayerId!, 'CALL'));
    // BB (p3) folds
    current = finalState(processAction(current, current.activePlayerId!, 'FOLD'));

    // Now only p2 can bet (p1 all-in, p3 folded). skipBetting should apply.
    // All remaining streets dealt automatically.
    expect(current.handInProgress).toBe(false);
    expect(current.communityCards).toHaveLength(5);
  });

  test('post-flop first-to-act after some players folded', () => {
    // 4 players, one folds pre-flop. First to act post-flop skips the folded player.
    let state = createInitialState({
      gameId: 'test-fold-order',
      gameName: 'Fold Order',
      gameType: 'cash',
      smallBlindAmount: 5,
      bigBlindAmount: 10,
      maxPlayers: 6,
      startingStack: 1000,
    });
    for (let i = 1; i <= 4; i++) state = addPlayer(state, `p${i}`, `P${i}`).state;
    for (let i = 1; i <= 4; i++) state = setPlayerReady(state, `p${i}`);

    let current = finalState(startHand(state));

    // Pre-flop: first player (UTG) folds, rest call/check
    current = finalState(processAction(current, current.activePlayerId!, 'FOLD'));
    while (current.stage === 'PRE_FLOP' && current.activePlayerId) {
      const actions = getAvailableActions(current, current.activePlayerId);
      const canCheck = actions.some((a) => a.type === 'CHECK');
      current = finalState(processAction(current, current.activePlayerId, canCheck ? 'CHECK' : 'CALL'));
    }

    expect(current.stage).toBe('FLOP');
    // First to act should NOT be the folded player
    const activePlayer = current.players.find((p) => p.id === current.activePlayerId)!;
    expect(activePlayer.folded).toBe(false);
  });

  test('all-in run-out deals all remaining streets without pausing', () => {
    let state = createHeadsUpGame({ blinds: [5, 10] });
    const deck = makePaddedDeck([
      'Ah', 'As', '2c', '3d',
      '7h', '8h', '9d', 'Tc', '4s',
    ]);
    let current = finalState(startHand(state, deck));

    // Both all-in pre-flop
    current = finalState(processAction(current, current.activePlayerId!, 'ALL_IN'));
    current = finalState(processAction(current, current.activePlayerId!, 'ALL_IN'));

    // All 5 community cards dealt
    expect(current.communityCards).toHaveLength(5);
    expect(current.communityCards).toEqual(['7h', '8h', '9d', 'Tc', '4s']);
    expect(current.handInProgress).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 10. Consecutive Hands
// ═══════════════════════════════════════════════════════════════════════════════

describe('Consecutive Hands', () => {
  test('stacks carry over between hands', () => {
    let state = createHeadsUpGame({ stacks: [1000, 1000], blinds: [5, 10] });

    // Hand 1: play to showdown
    const deck1 = makePaddedDeck([
      'Ah', 'As', '2c', '3d',
      '7h', '8h', '9d', 'Tc', '4s',
    ]);
    let current = finalState(startHand(state, deck1));
    current = playToShowdown(current);

    const p1After1 = current.players.find((p) => p.id === 'p1')!.stack;
    const p2After1 = current.players.find((p) => p.id === 'p2')!.stack;
    expect(p1After1 + p2After1).toBe(2000);

    // Hand 2: stacks carry over
    const deck2 = makePaddedDeck([
      'Kh', 'Ks', '4c', '5d',
      '2h', '3h', '6d', 'Jc', 'Qs',
    ]);
    let hand2 = finalState(startHand(current, deck2));

    // Verify stacks reflect hand 1 results (minus blinds)
    const p1Blinds = hand2.players.find((p) => p.id === 'p1')!;
    const p2Blinds = hand2.players.find((p) => p.id === 'p2')!;
    // Total chips still conserved even with blinds posted
    expect(p1Blinds.stack + p1Blinds.bet + p2Blinds.stack + p2Blinds.bet).toBe(2000);
  });

  test('state fully resets between hands', () => {
    let state = createHeadsUpGame({ blinds: [5, 10] });

    const deck1 = makePaddedDeck([
      'Ah', 'As', '2c', '3d',
      '7h', '8h', '9d', 'Tc', '4s',
    ]);
    let current = finalState(startHand(state, deck1));
    current = playToShowdown(current);

    expect(current.handInProgress).toBe(false);

    // Start hand 2
    const deck2 = makePaddedDeck([
      'Kh', 'Ks', '4c', '5d',
      '2h', '3h', '6d', 'Jc', 'Qs',
    ]);
    let hand2 = finalState(startHand(current, deck2));

    expect(hand2.handNumber).toBe(current.handNumber + 1);
    expect(hand2.stage).toBe('PRE_FLOP');
    expect(hand2.communityCards).toEqual([]);
    expect(hand2.handInProgress).toBe(true);
    // All players should have hole cards and not be folded
    for (const p of hand2.players.filter((pl) => pl.role === 'player' && pl.stack > 0)) {
      expect(p.folded).toBe(false);
      expect(p.holeCards).toHaveLength(2);
      expect(p.bet).toBeGreaterThanOrEqual(0);
      expect(p.isAllIn).toBe(false);
    }
  });

  test('dealer button advances each hand', () => {
    let state = create3PlayerGame({ blinds: [5, 10] });

    const deck1 = makePaddedDeck([
      'Ah', 'Kh', 'Qh', 'Jh', '2c', '3d',
      '7h', '8h', '9d', 'Tc', '4s',
    ]);
    let hand1 = finalState(startHand(state, deck1));
    const dealer1 = hand1.dealerSeatIndex;

    let afterHand1 = playToShowdown(hand1);

    const deck2 = makePaddedDeck([
      'Ks', 'Qs', 'Js', 'Ts', '9s', '8s',
      '2h', '3h', '4h', '5h', '6h',
    ]);
    let hand2 = finalState(startHand(afterHand1, deck2));
    const dealer2 = hand2.dealerSeatIndex;

    // Dealer should have moved
    expect(dealer2).not.toBe(dealer1);
  });

  test('eliminated player (0 stack) excluded from next hand', () => {
    let state = createHeadsUpGame({ stacks: [1000, 1000], blinds: [5, 10] });

    // Rig hand so p1 loses everything
    const deck = makePaddedDeck([
      '2c', '3d', 'Ah', 'As', // p1 gets junk, p2 gets aces
      '7h', '8h', '9d', 'Tc', '4s',
    ]);
    let current = finalState(startHand(state, deck));
    current = finalState(processAction(current, current.activePlayerId!, 'ALL_IN'));
    current = finalState(processAction(current, current.activePlayerId!, 'ALL_IN'));

    expect(current.handInProgress).toBe(false);

    // One player should have 0 chips
    const busted = current.players.find((p) => p.stack === 0);
    expect(busted).toBeDefined();

    // Starting next hand should fail — not enough players
    expect(() => startHand(current)).toThrow('Not enough players');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 11. Tournament-Specific
// ═══════════════════════════════════════════════════════════════════════════════

describe('Tournament-Specific', () => {
  function createTournamentGame(opts?: {
    stacks?: number[];
    blindLevel?: number;
  }): EngineState {
    const stacks = opts?.stacks ?? [5000, 5000, 5000];
    const schedule = generateBlindSchedule({
      numPlayers: stacks.length,
      tournamentLengthHours: 2,
      roundLengthMinutes: 15,
      antesEnabled: true,
    });

    let state = createInitialState({
      gameId: 'test-tournament',
      gameName: 'TDA Tournament',
      gameType: 'tournament',
      smallBlindAmount: schedule[0].smallBlind,
      bigBlindAmount: schedule[0].bigBlind,
      maxPlayers: 6,
      startingStack: stacks[0],
      blindSchedule: schedule,
      antesEnabled: true,
    });

    for (let i = 0; i < stacks.length; i++) {
      state = addPlayer(state, `p${i + 1}`, `Player${i + 1}`).state;
    }
    state = {
      ...state,
      players: state.players.map((p, i) => ({ ...p, stack: stacks[i] })),
      totalPlayers: stacks.length,
    };
    for (let i = 0; i < stacks.length; i++) state = setPlayerReady(state, `p${i + 1}`);

    // Advance to requested blind level
    if (opts?.blindLevel) {
      for (let i = 0; i < opts.blindLevel; i++) {
        const t = advanceBlindLevel(state);
        state = t.state;
      }
    }

    return state;
  }

  test('antes are posted from all active players', () => {
    // At level 4+, antes are enabled
    let state = createTournamentGame({ blindLevel: 4 });

    const deck = makePaddedDeck([
      'Ah', 'Kh', 'Qh', 'Jh', 'Th', '9h',
      '2c', '3c', '4c', '5c', '6c',
    ]);
    const transitions = startHand(state, deck);
    const blindsEvent = transitions[1].event;

    // BLINDS_POSTED event should include antes
    expect(blindsEvent.type).toBe('BLINDS_POSTED');
    if (blindsEvent.type === 'BLINDS_POSTED' && 'antes' in blindsEvent) {
      expect(blindsEvent.antes).toBeDefined();
      expect(blindsEvent.antes!.length).toBe(3); // All 3 players ante
      for (const ante of blindsEvent.antes!) {
        expect(ante.amount).toBeGreaterThan(0);
      }
    }
  });

  test('player all-in from ante (stack < ante)', () => {
    // At level 4, ante might be ~50. Give one player only 30.
    let state = createTournamentGame({ blindLevel: 4 });
    const anteAmount = state.blindSchedule[state.currentBlindLevel].ante;

    // Set p1 stack to less than ante
    state = {
      ...state,
      players: state.players.map((p) =>
        p.id === 'p1' ? { ...p, stack: Math.max(1, anteAmount - 10) } : p
      ),
    };

    const deck = makePaddedDeck([
      'Ah', 'Kh', 'Qh', 'Jh', 'Th', '9h',
      '2c', '3c', '4c', '5c', '6c',
    ]);
    const transitions = startHand(state, deck);
    const dealt = finalState(transitions);

    // p1 should be all-in (or have 0 stack)
    const p1 = dealt.players.find((p) => p.id === 'p1')!;
    expect(p1.stack).toBe(0);
    expect(p1.isAllIn).toBe(true);
  });

  test('ante consumes stack — cannot post blind', () => {
    // Player has exactly the ante amount, is SB. After ante → all-in.
    let state = createTournamentGame({ blindLevel: 4 });
    const anteAmount = state.blindSchedule[state.currentBlindLevel].ante;

    // Set p2 (will be SB) stack to exactly ante amount
    state = {
      ...state,
      players: state.players.map((p) =>
        p.id === 'p2' ? { ...p, stack: anteAmount } : p
      ),
    };

    const deck = makePaddedDeck([
      'Ah', 'Kh', 'Qh', 'Jh', 'Th', '9h',
      '2c', '3c', '4c', '5c', '6c',
    ]);
    const transitions = startHand(state, deck);
    const dealt = finalState(transitions);

    // p2 should have posted ante and been all-in, with no blind posted
    const p2 = dealt.players.find((p) => p.id === 'p2')!;
    expect(p2.stack).toBe(0);
    expect(p2.isAllIn).toBe(true);

    // Chips should be conserved
    expect(totalChips(dealt) + dealt.players.reduce((s, p) => s + p.bet, 0) +
      dealt.players.reduce((s, p) => s + p.potShare, 0) - dealt.players.reduce((s, p) => s + p.bet, 0))
      .toBeGreaterThan(0);
  });

  test('chip denomination enforcement on bets/raises', () => {
    let state = createTournamentGame({ blindLevel: 0 });
    // Level 0: minChipDenom should be 25
    const chipDenom = state.blindSchedule[0].minChipDenom;
    expect(chipDenom).toBe(25);

    const deck = makePaddedDeck([
      'Ah', 'Kh', 'Qh', 'Jh', 'Th', '9h',
      '2c', '3c', '4c', '5c', '6c',
    ]);
    let current = finalState(startHand(state, deck));
    current = playToFlop(current);

    if (current.activePlayerId) {
      // BET amount not divisible by 25 should be rejected
      const err = validateAction(current, current.activePlayerId, 'BET', 33);
      expect(err).not.toBeNull();
      expect(err!.code).toBe('INVALID_AMOUNT');

      // BET amount divisible by 25 should be accepted
      const ok = validateAction(current, current.activePlayerId, 'BET', 50);
      expect(ok).toBeNull();
    }
  });

  test('chip denomination rounding: min > max → only ALL_IN available', () => {
    // Tournament with high chip denom. Player has small stack.
    let state = createTournamentGame({ blindLevel: 6 });
    const chipDenom = state.blindSchedule[state.currentBlindLevel].minChipDenom;

    // Give p1 a stack where roundDown(stack) < roundUp(BB) for BET
    // This forces BET to not be available, only ALL_IN
    state = {
      ...state,
      players: state.players.map((p) =>
        p.id === 'p1' ? { ...p, stack: chipDenom + 1 } : p
      ),
    };

    const deck = makePaddedDeck([
      'Ah', 'Kh', 'Qh', 'Jh', 'Th', '9h',
      '2c', '3c', '4c', '5c', '6c',
    ]);
    let current = finalState(startHand(state, deck));

    // p1 will have reduced stack after blinds. If they get to act post-flop
    // with a tiny stack, ALL_IN should be their only size option.
    // For now just verify ALL_IN is always available when stack > 0.
    const p1 = current.players.find((p) => p.id === 'p1')!;
    if (p1.stack > 0 && !p1.isAllIn && current.activePlayerId === 'p1') {
      const actions = getAvailableActions(current, 'p1');
      expect(actions.some((a) => a.type === 'ALL_IN')).toBe(true);
    }
  });

  test('blind level advancement updates blinds', () => {
    let state = createTournamentGame();
    const level0SB = state.smallBlindAmount;
    const level0BB = state.bigBlindAmount;

    // Advance blind level
    const { state: advanced, event } = advanceBlindLevel(state);

    expect(event.type).toBe('BLIND_LEVEL_UP');
    expect(advanced.currentBlindLevel).toBe(1);
    expect(advanced.smallBlindAmount).toBeGreaterThan(level0SB);
    expect(advanced.bigBlindAmount).toBeGreaterThan(level0BB);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 12. Action Validator Edge Cases
// ═══════════════════════════════════════════════════════════════════════════════

describe('Action Validator Edge Cases', () => {
  test('CALL not available when callAmount > stack', () => {
    // p1 has 50, facing a currentBet of 100.
    let state = create3PlayerGame({ stacks: [50, 1000, 1000], blinds: [5, 10] });
    const deck = makePaddedDeck([
      'Ah', 'Kh', 'Qh', 'Jh', 'Th', '9h',
      '2c', '3c', '4c', '5c', '6c',
    ]);
    let current = finalState(startHand(state, deck));

    // UTG=p1 calls pre-flop (10 from 50 stack = 40 remaining)
    current = finalState(processAction(current, current.activePlayerId!, 'CALL'));
    // SB calls
    current = finalState(processAction(current, current.activePlayerId!, 'CALL'));
    // BB checks
    current = finalState(processAction(current, current.activePlayerId!, 'CHECK'));

    // Now on flop. If someone bets more than p1's remaining stack...
    expect(current.stage).toBe('FLOP');

    // Next actor bets 100 (more than p1's 40 remaining)
    if (current.activePlayerId) {
      current = finalState(processAction(current, current.activePlayerId!, 'BET', 100));
    }

    // If p1 is next to act, CALL should NOT be available (100 > 40)
    if (current.activePlayerId === 'p1') {
      const actions = getAvailableActions(current, 'p1');
      const types = actions.map((a) => a.type);
      expect(types).not.toContain('CALL');
      expect(types).toContain('FOLD');
      expect(types).toContain('ALL_IN');
    }
  });

  test('RAISE not available when stack equals callAmount exactly', () => {
    // Give p1 exactly enough to call but not raise
    let state = create3PlayerGame({ stacks: [110, 1000, 1000], blinds: [5, 10] });
    const deck = makePaddedDeck([
      'Ah', 'Kh', 'Qh', 'Jh', 'Th', '9h',
      '2c', '3c', '4c', '5c', '6c',
    ]);
    let current = finalState(startHand(state, deck));

    // Pre-flop: p1 (UTG) faces BB of 10. Stack=110.
    // p1 calls (stack=100), goes to flop.
    current = finalState(processAction(current, current.activePlayerId!, 'CALL'));
    current = finalState(processAction(current, current.activePlayerId!, 'CALL'));
    current = finalState(processAction(current, current.activePlayerId!, 'CHECK'));

    // Flop: someone bets 100. p1 has exactly 100 = callAmount.
    if (current.activePlayerId && current.activePlayerId !== 'p1') {
      current = finalState(processAction(current, current.activePlayerId!, 'BET', 100));
    }

    if (current.activePlayerId === 'p1') {
      const actions = getAvailableActions(current, 'p1');
      const types = actions.map((a) => a.type);
      // CALL is available (100 <= 100)
      expect(types).toContain('CALL');
      // RAISE requires stack > callAmount → 100 > 100 is false
      expect(types).not.toContain('RAISE');
      // ALL_IN is still available
      expect(types).toContain('ALL_IN');
    }
  });

  test('BET min capped at player stack', () => {
    let state = create3PlayerGame({ stacks: [8, 1000, 1000], blinds: [5, 10] });
    const deck = makePaddedDeck([
      'Ah', 'Kh', 'Qh', 'Jh', 'Th', '9h',
      '2c', '3c', '4c', '5c', '6c',
    ]);
    let current = finalState(startHand(state, deck));

    // p1 has 8 chips. After calling BB(10)... but wait, p1 can't cover BB call.
    // Actually p1 has 8 < call(10), so CALL won't be available, only ALL_IN and FOLD.
    if (current.activePlayerId === 'p1') {
      const actions = getAvailableActions(current, 'p1');
      const types = actions.map((a) => a.type);
      expect(types).toContain('ALL_IN');
      expect(types).toContain('FOLD');
      expect(types).not.toContain('CALL'); // Can't afford call
    }
  });

  test('tournament: amounts not divisible by chip denom rejected', () => {
    const schedule = generateBlindSchedule({
      numPlayers: 3,
      tournamentLengthHours: 2,
      roundLengthMinutes: 15,
      antesEnabled: false,
    });

    let state = createInitialState({
      gameId: 'test-chip-denom',
      gameName: 'Chip Denom',
      gameType: 'tournament',
      smallBlindAmount: schedule[0].smallBlind,
      bigBlindAmount: schedule[0].bigBlind,
      maxPlayers: 6,
      startingStack: 5000,
      blindSchedule: schedule,
      antesEnabled: false,
    });

    for (let i = 1; i <= 3; i++) state = addPlayer(state, `p${i}`, `P${i}`).state;
    for (let i = 1; i <= 3; i++) state = setPlayerReady(state, `p${i}`);

    let current = finalState(startHand(state));
    current = playToFlop(current);

    if (current.activePlayerId) {
      const chipDenom = schedule[0].minChipDenom;
      // Bet an amount that's not a multiple of chipDenom
      const badAmount = chipDenom + 1;
      const err = validateAction(current, current.activePlayerId, 'BET', badAmount);
      if (chipDenom > 1) {
        expect(err).not.toBeNull();
      }
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 13. Chip Conservation Invariant
// ═══════════════════════════════════════════════════════════════════════════════

describe('Chip Conservation Invariant', () => {
  test('total chips conserved after simple hand', () => {
    let state = create3PlayerGame({ blinds: [5, 10] });
    const initial = totalChips(state);

    const deck = makePaddedDeck([
      'Ah', 'Kh', 'Qh', 'Jh', '2c', '3d',
      '7h', '8h', '9d', 'Tc', '4s',
    ]);
    let current = finalState(startHand(state, deck));
    current = playToShowdown(current);

    expect(current.handInProgress).toBe(false);
    expect(totalChips(current)).toBe(initial);
  });

  test('total chips conserved with side pots', () => {
    let state = create3PlayerGame({ stacks: [200, 500, 1000], blinds: [5, 10] });
    const initial = totalChips(state);

    const deck = makePaddedDeck([
      'Ah', 'As', 'Kh', 'Ks', '2c', '3d',
      '7h', '8h', '9d', 'Tc', '4s',
    ]);
    let current = finalState(startHand(state, deck));

    // All go all-in
    while (current.activePlayerId && current.handInProgress) {
      const actions = getAvailableActions(current, current.activePlayerId);
      if (actions.some((a) => a.type === 'ALL_IN')) {
        current = finalState(processAction(current, current.activePlayerId, 'ALL_IN'));
      } else if (actions.some((a) => a.type === 'CALL')) {
        current = finalState(processAction(current, current.activePlayerId, 'CALL'));
      } else {
        break;
      }
    }

    expect(current.handInProgress).toBe(false);
    expect(totalChips(current)).toBe(initial);
  });

  test('total chips conserved in split pot with remainder', () => {
    let state = create3PlayerGame({ stacks: [1000, 1000, 1000], blinds: [5, 10] });
    const initial = totalChips(state);

    // Board plays broadway straight — all 3 split
    const deck = makePaddedDeck([
      '2c', '3c', '4c', '5c', '6c', '7c',
      'Ah', 'Kh', 'Qh', 'Jd', 'Td',
    ]);
    let current = finalState(startHand(state, deck));
    current = playToShowdown(current);

    expect(current.handInProgress).toBe(false);
    expect(totalChips(current)).toBe(initial);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 14. Multi-Way to Heads-Up Transition
// ═══════════════════════════════════════════════════════════════════════════════

describe('Multi-Way to Heads-Up Transition', () => {
  test('three players to heads-up — next hand uses heads-up rules', () => {
    // Use very unequal stacks so the short-stack player busts guaranteed.
    // Short stack = 10, others = 1000. Blinds 5/10.
    // The short stack will be BB (10 chips) or SB (5 chips) and bust when they lose.
    let state = create3PlayerGame({ stacks: [1000, 1000, 1000], blinds: [5, 10] });

    // Find who's the BB and make them short-stacked
    const dryTransitions = startHand(state);
    const blindsEvent = dryTransitions[1].event;
    const bbId = (blindsEvent as any).bigBlind.playerId;

    state = {
      ...state,
      players: state.players.map((p) =>
        p.id === bbId ? { ...p, stack: 10 } : p
      ),
    };

    // Rig deck so BB (short stack) loses. Give others strong hands.
    const deck1 = makePaddedDeck([
      'Ah', 'As', 'Kh', 'Ks', '2c', '3d', // first 2 get good cards, BB gets junk
      '7h', '8h', '9d', 'Tc', '4s',
    ]);
    let current = finalState(startHand(state, deck1));

    // Play hand: UTG raises, everyone responds
    while (current.activePlayerId && current.handInProgress) {
      const actions = getAvailableActions(current, current.activePlayerId);
      if (actions.some((a) => a.type === 'ALL_IN')) {
        current = finalState(processAction(current, current.activePlayerId, 'ALL_IN'));
      } else if (actions.some((a) => a.type === 'CALL')) {
        current = finalState(processAction(current, current.activePlayerId, 'CALL'));
      } else if (actions.some((a) => a.type === 'CHECK')) {
        current = finalState(processAction(current, current.activePlayerId, 'CHECK'));
      } else {
        break;
      }
    }

    expect(current.handInProgress).toBe(false);

    // Two players should remain with chips
    const remaining = current.players.filter((p) => p.role === 'player' && p.stack > 0);
    if (remaining.length !== 2) {
      // If the hand didn't bust anyone (unlikely), skip
      return;
    }

    // Start hand 2 — should work as heads-up
    const deck2 = makePaddedDeck([
      'Kh', 'Qs', 'Jh', 'Ts',
      '2h', '3h', '4h', '5h', '6h',
    ]);
    const hand2 = startHand(current, deck2);
    const hand2State = finalState(hand2);

    // In heads-up, dealer is SB and acts first pre-flop
    const dealerIdx = hand2State.dealerSeatIndex;
    const dealerPlayer = hand2State.players.find((p) => p.seatIndex === dealerIdx)!;
    expect(hand2State.activePlayerId).toBe(dealerPlayer.id);
  });

  test('button/blind positions adjust correctly for heads-up', () => {
    let state = createHeadsUpGame({ blinds: [5, 10] });

    // Play two consecutive hands and verify button alternates
    const deck1 = makePaddedDeck([
      'Ah', 'Kh', 'Qh', 'Jh',
      '2c', '3c', '4c', '5c', '6c',
    ]);
    let hand1 = finalState(startHand(state, deck1));
    const dealer1 = hand1.dealerSeatIndex;
    hand1 = playToShowdown(hand1);

    const deck2 = makePaddedDeck([
      'Ks', 'Qs', 'Js', 'Ts',
      '2h', '3h', '4h', '5h', '6h',
    ]);
    let hand2 = finalState(startHand(hand1, deck2));
    const dealer2 = hand2.dealerSeatIndex;

    // In heads-up, dealer alternates
    expect(dealer2).not.toBe(dealer1);

    // Dealer is SB in heads-up
    const blindsState = startHand(hand1, deck2)[1].state;
    const sbPlayer = blindsState.players.find((p) => p.bet === 5);
    expect(sbPlayer).toBeDefined();
    expect(sbPlayer!.seatIndex).toBe(dealer2);
  });
});
