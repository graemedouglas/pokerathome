/**
 * Tests for the showdown card visibility setting.
 *
 * Two modes:
 * - "standard" (default): Only reveal the last aggressor (called player) and winner(s)
 * - "show-all": Reveal all non-folded players' cards (legacy behavior)
 */

import { createDeck } from '../src/engine/deck';
import { getAvailableActions } from '../src/engine/action-validator';
import {
  createInitialState,
  addPlayer,
  setPlayerReady,
  startHand,
  processAction,
  toClientGameState,
  buildGameStatePayload,
  type EngineState,
  type Transition,
} from '../src/engine/game';

// ═══════════════════════════════════════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════════════════════════════════════

function makePaddedDeck(knownCards: string[]): string[] {
  const remaining = createDeck().filter((c) => !knownCards.includes(c));
  return [...knownCards, ...remaining];
}

function create3PlayerGame(opts?: {
  stacks?: [number, number, number];
  blinds?: [number, number];
  showdownVisibility?: 'standard' | 'show-all';
}): EngineState {
  const stacks = opts?.stacks ?? [1000, 1000, 1000];
  const [sb, bb] = opts?.blinds ?? [5, 10];

  let state = createInitialState({
    gameId: 'test-showdown-vis',
    gameName: 'Showdown Vis Test',
    gameType: 'cash',
    smallBlindAmount: sb,
    bigBlindAmount: bb,
    maxPlayers: 6,
    startingStack: stacks[0],
    showdownVisibility: opts?.showdownVisibility ?? 'standard',
  });

  for (let i = 0; i < 3; i++) {
    const { state: s } = addPlayer(state, `p${i + 1}`, `Player${i + 1}`);
    state = s;
  }
  state = {
    ...state,
    players: state.players.map((p, i) => ({ ...p, stack: stacks[i] })),
  };

  state = setPlayerReady(state, 'p1');
  state = setPlayerReady(state, 'p2');
  state = setPlayerReady(state, 'p3');
  return state;
}

function createHeadsUpGame(opts?: {
  stacks?: [number, number];
  blinds?: [number, number];
  showdownVisibility?: 'standard' | 'show-all';
}): EngineState {
  const stacks = opts?.stacks ?? [1000, 1000];
  const [sb, bb] = opts?.blinds ?? [5, 10];

  let state = createInitialState({
    gameId: 'test-showdown-vis-hu',
    gameName: 'Showdown Vis HU Test',
    gameType: 'cash',
    smallBlindAmount: sb,
    bigBlindAmount: bb,
    maxPlayers: 6,
    startingStack: stacks[0],
    showdownVisibility: opts?.showdownVisibility ?? 'standard',
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

function finalState(transitions: { state: EngineState }[]): EngineState {
  return transitions[transitions.length - 1].state;
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

/** Play through a specific stage by checking/calling. */
function playThroughStage(state: EngineState, stage: string): EngineState {
  let current = state;
  while (current.stage === stage && current.activePlayerId && current.handInProgress) {
    const actions = getAvailableActions(current, current.activePlayerId);
    const canCheck = actions.some((a) => a.type === 'CHECK');
    const t = processAction(current, current.activePlayerId, canCheck ? 'CHECK' : 'CALL');
    current = finalState(t);
  }
  return current;
}

/** Get visible hole cards for a specific player as seen by a viewer. */
function getVisibleCards(
  state: EngineState,
  targetPlayerId: string,
  viewerPlayerId: string,
): [string, string] | null {
  const clientState = toClientGameState(state, viewerPlayerId);
  const player = clientState.players.find((p) => p.id === targetPlayerId);
  return player?.holeCards as [string, string] | null;
}

// ═══════════════════════════════════════════════════════════════════════════════
// Tests
// ═══════════════════════════════════════════════════════════════════════════════

describe('Showdown Card Visibility', () => {
  // Deck layout: p1 gets Ah As (aces), p2 gets Kh Ks (kings), p3 gets 2c 3d (low)
  // Board: 7h 8d 9s Tc 4s — p1 wins with pair of aces
  const deck3P = makePaddedDeck([
    'Ah', 'Kh', '2c',   // hole card 1 for p1, p2, p3
    'As', 'Ks', '3d',   // hole card 2 for p1, p2, p3
    '7h', '8d', '9s',   // flop
    'Tc',                // turn
    '4s',                // river
  ]);

  // Heads-up deck: p1 gets Ah As (aces), p2 gets Kh Ks (kings)
  // Board: 7h 8d 9s Tc 4s — p1 wins with pair of aces
  const deckHU = makePaddedDeck([
    'Ah', 'Kh',          // hole card 1 for p1, p2
    'As', 'Ks',          // hole card 2 for p1, p2
    '7h', '8d', '9s',    // flop
    'Tc',                 // turn
    '4s',                 // river
  ]);

  test('show-all mode: all non-folded players cards visible at showdown', () => {
    let state = create3PlayerGame({ showdownVisibility: 'show-all' });
    let current = finalState(startHand(state, deck3P));

    // Play passively to showdown
    current = playToShowdown(current);

    expect(current.handInProgress).toBe(false);
    expect(current.stage).toBe('SHOWDOWN');

    // All non-folded players' cards should be visible to any player
    expect(getVisibleCards(current, 'p1', 'p2')).not.toBeNull();
    expect(getVisibleCards(current, 'p2', 'p1')).not.toBeNull();
    expect(getVisibleCards(current, 'p3', 'p1')).not.toBeNull();
  });

  test('standard mode: only winner visible when no aggressor on final street (all check)', () => {
    let state = create3PlayerGame({ showdownVisibility: 'standard' });
    let current = finalState(startHand(state, deck3P));

    // Play passively to showdown (all check/call through every street)
    current = playToShowdown(current);

    expect(current.handInProgress).toBe(false);
    expect(current.lastAggressorId).toBeNull();

    // p1 (Ah As) should be the winner — their cards should be visible
    expect(getVisibleCards(current, 'p1', 'p2')).not.toBeNull();

    // p2 and p3 are NOT the winner and NOT the aggressor — their cards should be hidden
    expect(getVisibleCards(current, 'p2', 'p1')).toBeNull();
    expect(getVisibleCards(current, 'p3', 'p1')).toBeNull();
  });

  test('standard mode: winner and last aggressor both visible', () => {
    let state = create3PlayerGame({ showdownVisibility: 'standard' });
    let current = finalState(startHand(state, deck3P));

    // Play through pre-flop passively
    current = playThroughStage(current, 'PRE_FLOP');
    // Play through flop passively
    current = playThroughStage(current, 'FLOP');
    // Play through turn passively
    current = playThroughStage(current, 'TURN');

    // On river: p2 bets (becomes last aggressor), others call
    expect(current.stage).toBe('RIVER');

    // Find the first active player and make them bet, then others call
    // In a 3-player game post-flop, first to act is left of dealer
    const firstToAct = current.activePlayerId!;
    current = finalState(processAction(current, firstToAct, 'BET', 20));
    // Record who bet
    const aggressor = firstToAct;

    // Remaining players call
    while (current.activePlayerId && current.handInProgress) {
      current = finalState(processAction(current, current.activePlayerId, 'CALL'));
    }

    expect(current.handInProgress).toBe(false);
    expect(current.lastAggressorId).toBe(aggressor);

    // Find the winner from HAND_END event
    const handEndEvent = current.handEvents.find((e) => e.type === 'HAND_END');
    expect(handEndEvent).toBeDefined();
    const winners = (handEndEvent as any).winners as Array<{ playerId: string }>;
    const winnerIds = [...new Set(winners.map((w) => w.playerId))];

    // Winner's cards visible
    for (const winnerId of winnerIds) {
      expect(getVisibleCards(current, winnerId, 'p1')).not.toBeNull();
    }

    // Aggressor's cards visible
    expect(getVisibleCards(current, aggressor, 'p1')).not.toBeNull();

    // Any non-winner, non-aggressor player's cards should be hidden
    for (const p of current.players.filter((pl) => pl.role === 'player' && !pl.folded)) {
      if (!winnerIds.includes(p.id) && p.id !== aggressor) {
        // Viewed by another player, cards should be hidden
        const viewer = current.players.find((v) => v.id !== p.id && v.role === 'player')!;
        expect(getVisibleCards(current, p.id, viewer.id)).toBeNull();
      }
    }
  });

  test('standard mode: aggressor resets per street (bet on turn, check through river)', () => {
    let state = create3PlayerGame({ showdownVisibility: 'standard' });
    let current = finalState(startHand(state, deck3P));

    // Play through pre-flop and flop passively
    current = playThroughStage(current, 'PRE_FLOP');
    current = playThroughStage(current, 'FLOP');

    // On turn: first player bets, others call
    expect(current.stage).toBe('TURN');
    const turnBettor = current.activePlayerId!;
    current = finalState(processAction(current, turnBettor, 'BET', 20));
    while (current.stage === 'TURN' && current.activePlayerId && current.handInProgress) {
      current = finalState(processAction(current, current.activePlayerId, 'CALL'));
    }

    // Now on river — aggressor should have been reset by sweepBets
    expect(current.stage).toBe('RIVER');

    // Play river passively (all check)
    current = playThroughStage(current, 'RIVER');

    expect(current.handInProgress).toBe(false);
    // lastAggressorId should be null since river was checked through
    expect(current.lastAggressorId).toBeNull();

    // Only winner's cards should be visible
    const handEndEvent = current.handEvents.find((e) => e.type === 'HAND_END');
    const winners = (handEndEvent as any).winners as Array<{ playerId: string }>;
    const winnerIds = [...new Set(winners.map((w) => w.playerId))];

    for (const p of current.players.filter((pl) => pl.role === 'player' && !pl.folded)) {
      const viewer = current.players.find((v) => v.id !== p.id && v.role === 'player')!;
      if (winnerIds.includes(p.id)) {
        expect(getVisibleCards(current, p.id, viewer.id)).not.toBeNull();
      } else {
        expect(getVisibleCards(current, p.id, viewer.id)).toBeNull();
      }
    }
  });

  test('standard mode: all-in as raise counts as aggressor', () => {
    // p2 has only 100 chips — enough to raise as all-in on river
    let state = createHeadsUpGame({
      stacks: [1000, 100],
      showdownVisibility: 'standard',
    });
    let current = finalState(startHand(state, deckHU));

    // Play through pre-flop, flop, turn passively
    current = playThroughStage(current, 'PRE_FLOP');
    current = playThroughStage(current, 'FLOP');
    current = playThroughStage(current, 'TURN');

    expect(current.stage).toBe('RIVER');

    // On river: first player to act goes all-in (this is a BET, which is aggressive)
    const allInPlayer = current.activePlayerId!;
    current = finalState(processAction(current, allInPlayer, 'ALL_IN'));

    // The all-in was a bet (no prior bet on river), so it's aggressive
    expect(current.lastAggressorId).toBe(allInPlayer);
  });

  test('standard mode: all-in as call does NOT set aggressor', () => {
    // p2 has only 5 chips — will go all-in as a call (can't even cover the BB)
    let state = createHeadsUpGame({
      stacks: [1000, 5],
      blinds: [5, 10],
      showdownVisibility: 'standard',
    });
    let current = finalState(startHand(state, deckHU));

    // p2 posted BB but only had 5 chips (short stack), so they're already all-in
    // The engine auto-marks them all-in when posting the blind
    // Let's verify p2 is all-in and lastAggressorId is null
    expect(current.lastAggressorId).toBeNull();
  });

  test('standard mode: player always sees their own cards at showdown', () => {
    let state = create3PlayerGame({ showdownVisibility: 'standard' });
    let current = finalState(startHand(state, deck3P));

    // Play passively to showdown
    current = playToShowdown(current);

    expect(current.handInProgress).toBe(false);

    // Each player should ALWAYS see their own cards regardless of visibility mode
    for (const p of current.players.filter((pl) => pl.role === 'player' && !pl.folded)) {
      expect(getVisibleCards(current, p.id, p.id)).not.toBeNull();
    }
  });

  test('standard mode works for spectators', () => {
    let state = create3PlayerGame({ showdownVisibility: 'standard' });

    // Add a spectator
    const { state: withSpec } = addPlayer(state, 'spectator-1', 'Spectator', 'spectator');
    state = withSpec;

    let current = finalState(startHand(state, deck3P));

    // Play passively to showdown (no aggressor)
    current = playToShowdown(current);

    expect(current.handInProgress).toBe(false);

    // For spectator with 'showdown' spectator visibility:
    // Only winner's cards should be visible
    const handEndEvent = current.handEvents.find((e) => e.type === 'HAND_END');
    const winners = (handEndEvent as any).winners as Array<{ playerId: string }>;
    const winnerIds = [...new Set(winners.map((w) => w.playerId))];

    for (const p of current.players.filter((pl) => pl.role === 'player' && !pl.folded)) {
      const visible = getVisibleCards(current, p.id, 'spectator-1');
      if (winnerIds.includes(p.id)) {
        expect(visible).not.toBeNull();
      } else {
        expect(visible).toBeNull();
      }
    }
  });

  test('standard mode: winner who is also the aggressor only shows once (no duplication issue)', () => {
    let state = createHeadsUpGame({ showdownVisibility: 'standard' });
    let current = finalState(startHand(state, deckHU));

    // Play through to river passively
    current = playThroughStage(current, 'PRE_FLOP');
    current = playThroughStage(current, 'FLOP');
    current = playThroughStage(current, 'TURN');

    expect(current.stage).toBe('RIVER');

    // p1 (who has aces and will win) bets on river
    // In HU post-flop, BB acts first, then dealer
    // We'll have whoever is active bet
    const bettor = current.activePlayerId!;
    current = finalState(processAction(current, bettor, 'BET', 50));
    // Other player calls
    current = finalState(processAction(current, current.activePlayerId!, 'CALL'));

    expect(current.handInProgress).toBe(false);

    // Find winner
    const handEndEvent = current.handEvents.find((e) => e.type === 'HAND_END');
    const winners = (handEndEvent as any).winners as Array<{ playerId: string }>;
    const winnerId = winners[0].playerId;

    // Both the winner and the non-winner should have expected visibility
    const viewer = current.players.find((p) => p.id !== winnerId && p.role === 'player')!;

    // Winner's cards: always visible
    expect(getVisibleCards(current, winnerId, viewer.id)).not.toBeNull();

    // Aggressor's cards: visible (even if not the winner)
    expect(getVisibleCards(current, bettor, viewer.id)).not.toBeNull();
  });

  test('internal SHOWDOWN event in handEvents still has all cards (for replays)', () => {
    let state = create3PlayerGame({ showdownVisibility: 'standard' });
    let current = finalState(startHand(state, deck3P));
    current = playToShowdown(current);

    // The raw SHOWDOWN event in handEvents should contain ALL non-folded players' cards
    // (filtering only applies to what buildGameStatePayload sends to clients)
    const showdownEvent = current.handEvents.find((e) => e.type === 'SHOWDOWN');
    expect(showdownEvent).toBeDefined();
    const results = (showdownEvent as any).results as Array<{ playerId: string; holeCards: [string, string] }>;

    expect(results).toHaveLength(3);
    for (const r of results) {
      expect(r.holeCards).not.toBeNull();
      expect(r.holeCards).toHaveLength(2);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Event filtering regression tests — verify buildGameStatePayload filters
// the SHOWDOWN event per-viewer so the client doesn't leak hidden cards.
// ═══════════════════════════════════════════════════════════════════════════════

describe('Showdown Event Filtering (buildGameStatePayload)', () => {
  const deck3P = makePaddedDeck([
    'Ah', 'Kh', '2c',   // hole card 1 for p1, p2, p3
    'As', 'Ks', '3d',   // hole card 2 for p1, p2, p3
    '7h', '8d', '9s',   // flop
    'Tc',                // turn
    '4s',                // river
  ]);

  /** Play to showdown capturing all transitions from processAction. */
  function playToShowdownWithTransitions(state: EngineState): {
    finalState: EngineState;
    allTransitions: Transition[];
  } {
    let current = state;
    const allTransitions: Transition[] = [];
    while (current.handInProgress && current.activePlayerId) {
      const actions = getAvailableActions(current, current.activePlayerId);
      const canCheck = actions.some((a) => a.type === 'CHECK');
      const transitions = processAction(current, current.activePlayerId, canCheck ? 'CHECK' : 'CALL');
      allTransitions.push(...transitions);
      current = transitions[transitions.length - 1].state;
    }
    return { finalState: current, allTransitions };
  }

  test('standard mode: filters SHOWDOWN event for non-revealed players (no aggressor)', () => {
    let state = create3PlayerGame({ showdownVisibility: 'standard' });
    const handTransitions = startHand(state, deck3P);
    let current = handTransitions[handTransitions.length - 1].state;

    const { finalState: final, allTransitions } = playToShowdownWithTransitions(current);

    // Find the SHOWDOWN transition
    const showdownTransition = allTransitions.find((t) => {
      const evt = t.state.handEvents.find((e) => e.type === 'SHOWDOWN');
      return evt !== undefined;
    });
    expect(showdownTransition).toBeDefined();

    // Find the showdown event from the transition
    const showdownEvent = final.handEvents.find((e) => e.type === 'SHOWDOWN')!;

    // Identify winners
    const handEndEvent = final.handEvents.find((e) => e.type === 'HAND_END')!;
    const winners = (handEndEvent as any).winners as Array<{ playerId: string }>;
    const winnerIds = new Set(winners.map((w) => w.playerId));

    // p1 (Ah As) should be the winner
    expect(winnerIds.has('p1')).toBe(true);

    // Build payload for a non-winner (p2)
    const p2Payload = buildGameStatePayload(final, showdownEvent, 'p2');
    const p2Results = (p2Payload.event as any).results as Array<{
      playerId: string;
      holeCards: [string, string] | null;
    }>;

    // p2 should see their own cards in the event
    expect(p2Results.find((r) => r.playerId === 'p2')!.holeCards).not.toBeNull();
    // p2 should see winner p1's cards
    expect(p2Results.find((r) => r.playerId === 'p1')!.holeCards).not.toBeNull();
    // p2 should NOT see p3's cards (not winner, not aggressor)
    expect(p2Results.find((r) => r.playerId === 'p3')!.holeCards).toBeNull();

    // Build payload for winner (p1)
    const p1Payload = buildGameStatePayload(final, showdownEvent, 'p1');
    const p1Results = (p1Payload.event as any).results as Array<{
      playerId: string;
      holeCards: [string, string] | null;
    }>;

    // p1 sees their own cards
    expect(p1Results.find((r) => r.playerId === 'p1')!.holeCards).not.toBeNull();
    // p1 should NOT see p2 or p3 (no aggressor, only winner visible)
    expect(p1Results.find((r) => r.playerId === 'p2')!.holeCards).toBeNull();
    expect(p1Results.find((r) => r.playerId === 'p3')!.holeCards).toBeNull();
  });

  test('standard mode: shows aggressor cards in SHOWDOWN event', () => {
    let state = create3PlayerGame({ showdownVisibility: 'standard' });
    let current = finalState(startHand(state, deck3P));

    // Play through to river
    current = playThroughStage(current, 'PRE_FLOP');
    current = playThroughStage(current, 'FLOP');
    current = playThroughStage(current, 'TURN');

    expect(current.stage).toBe('RIVER');

    // River: first player bets (aggressor), others call
    const aggressor = current.activePlayerId!;
    current = finalState(processAction(current, aggressor, 'BET', 20));
    while (current.activePlayerId && current.handInProgress) {
      current = finalState(processAction(current, current.activePlayerId, 'CALL'));
    }

    expect(current.lastAggressorId).toBe(aggressor);

    const showdownEvent = current.handEvents.find((e) => e.type === 'SHOWDOWN')!;
    const handEndEvent = current.handEvents.find((e) => e.type === 'HAND_END')!;
    const winners = (handEndEvent as any).winners as Array<{ playerId: string }>;
    const winnerIds = new Set(winners.map((w) => w.playerId));

    // Find a viewer who is neither winner nor aggressor
    const viewer = current.players.find(
      (p) => p.role === 'player' && !winnerIds.has(p.id) && p.id !== aggressor
    );

    if (viewer) {
      const payload = buildGameStatePayload(current, showdownEvent, viewer.id);
      const results = (payload.event as any).results as Array<{
        playerId: string;
        holeCards: [string, string] | null;
      }>;

      // Viewer sees their own cards
      expect(results.find((r) => r.playerId === viewer.id)!.holeCards).not.toBeNull();
      // Viewer sees aggressor's cards
      expect(results.find((r) => r.playerId === aggressor)!.holeCards).not.toBeNull();
      // Viewer sees winner's cards
      for (const winnerId of winnerIds) {
        expect(results.find((r) => r.playerId === winnerId)!.holeCards).not.toBeNull();
      }
    }
  });

  test('show-all mode: does not filter SHOWDOWN event', () => {
    let state = create3PlayerGame({ showdownVisibility: 'show-all' });
    let current = finalState(startHand(state, deck3P));
    current = playToShowdown(current);

    const showdownEvent = current.handEvents.find((e) => e.type === 'SHOWDOWN')!;

    // For every viewer, all results should have holeCards
    for (const viewer of ['p1', 'p2', 'p3']) {
      const payload = buildGameStatePayload(current, showdownEvent, viewer);
      const results = (payload.event as any).results as Array<{
        playerId: string;
        holeCards: [string, string] | null;
      }>;

      for (const r of results) {
        expect(r.holeCards).not.toBeNull();
        expect(r.holeCards).toHaveLength(2);
      }
    }
  });

  test('standard mode: HAND_END winners available during SHOWDOWN transition', () => {
    let state = create3PlayerGame({ showdownVisibility: 'standard' });
    const handTransitions = startHand(state, deck3P);
    let current = handTransitions[handTransitions.length - 1].state;

    // Play all streets, capturing the last processAction transitions
    let lastTransitions: Transition[] = [];
    while (current.handInProgress && current.activePlayerId) {
      const actions = getAvailableActions(current, current.activePlayerId);
      const canCheck = actions.some((a) => a.type === 'CHECK');
      lastTransitions = processAction(current, current.activePlayerId, canCheck ? 'CHECK' : 'CALL');
      current = lastTransitions[lastTransitions.length - 1].state;
    }

    // Find the SHOWDOWN transition (not HAND_END)
    const showdownTransition = lastTransitions.find(
      (t) => t.state.handEvents.some((e) => e.type === 'SHOWDOWN') && t.state.handInProgress
    );

    // If we found a mid-hand showdown transition, verify winner visibility
    // (If both transitions are in the same processAction call, the last action triggers showdown)
    if (showdownTransition) {
      const showdownState = showdownTransition.state;

      // HAND_END should be in handEvents even during SHOWDOWN transition
      const handEndEvent = showdownState.handEvents.find((e) => e.type === 'HAND_END');
      expect(handEndEvent).toBeDefined();

      // Winner's cards should be visible in the SHOWDOWN transition's state
      const winners = (handEndEvent as any).winners as Array<{ playerId: string }>;
      const winnerId = winners[0].playerId;
      const viewer = showdownState.players.find(
        (p) => p.id !== winnerId && p.role === 'player' && !p.folded
      )!;

      const clientState = toClientGameState(showdownState, viewer.id);
      const winnerInClient = clientState.players.find((p) => p.id === winnerId);
      expect(winnerInClient?.holeCards).not.toBeNull();
    } else {
      // Both transitions were returned — verify the first one has HAND_END
      const firstTransition = lastTransitions[0];
      if (firstTransition.state.handEvents.some((e) => e.type === 'SHOWDOWN')) {
        const handEndEvent = firstTransition.state.handEvents.find((e) => e.type === 'HAND_END');
        expect(handEndEvent).toBeDefined();
      }
    }
  });
});
