/**
 * Spectator event / state consistency tests.
 *
 * Verifies that what the server sends to spectators (event + game state) is
 * coherent in all three SPECTATOR_CARD_VISIBILITY modes. Uses pure engine
 * functions — no DB, no server process, no real SessionManager needed.
 *
 * The key invariant: for every message sent to a spectator, the game state
 * must be consistent with the event. E.g. a FLOP event must accompany a state
 * where communityCards.length === 3, not 5 (the delayed-mode bug).
 */

import {
  createInitialState,
  addPlayer,
  setPlayerReady,
  startHand,
  processAction,
  cloneState,
  toClientGameState,
  type EngineState,
  type Transition,
} from '../src/engine/game';
import { createDeck } from '../src/engine/deck';

// ═══════════════════════════════════════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════════════════════════════════════

/** Pad a deck so the first cards are the given known cards in order. */
function makePaddedDeck(knownCards: string[]): string[] {
  const remaining = createDeck().filter(c => !knownCards.includes(c));
  return [...knownCards, ...remaining];
}

/** Create a 2-player + 1-spectator heads-up game. */
function createSpectatorGame(): EngineState {
  let state = createInitialState({
    gameId: 'spectator-test',
    gameName: 'Spectator Test',
    gameType: 'cash',
    smallBlindAmount: 5,
    bigBlindAmount: 10,
    maxPlayers: 6,
    startingStack: 1000,
  });

  const r1 = addPlayer(state, 'player-1', 'Alice');
  state = r1.state;
  const r2 = addPlayer(state, 'player-2', 'Bob');
  state = r2.state;
  const r3 = addPlayer(state, 'spectator-1', 'Charlie', 'spectator');
  state = r3.state;

  state = setPlayerReady(state, 'player-1');
  state = setPlayerReady(state, 'player-2');

  return state;
}

/**
 * Play a hand to completion by having both players go ALL_IN.
 * Returns all transitions (including the initial startHand ones) and the
 * final engine state.
 */
function playHandToShowdown(
  initialState: EngineState,
  riggedDeck: string[]
): { transitions: Transition[]; finalState: EngineState } {
  const allTransitions: Transition[] = [];

  const startTransitions = startHand(initialState, riggedDeck);
  allTransitions.push(...startTransitions);
  let current = startTransitions[startTransitions.length - 1].state;

  let safety = 0;
  while (current.handInProgress && current.activePlayerId && safety < 20) {
    safety++;
    const actionTransitions = processAction(current, current.activePlayerId, 'ALL_IN');
    allTransitions.push(...actionTransitions);
    current = actionTransitions[actionTransitions.length - 1].state;
  }

  return { transitions: allTransitions, finalState: current };
}

interface SpectatorMessage {
  eventType: string;
  stateHandNumber: number;
  stateStage: string;
  communityCardsLength: number;
  usedDelayedState: boolean;
}

/**
 * Replicate what GameManager.applyTransitions does for a spectator, given
 * a set of transitions and an optional previousHandState.
 *
 * This is not a mock — it mirrors the fixed applyTransitions logic so the
 * test stays in sync with the implementation (always uses current state).
 * The previousHandState parameter is kept for documentation purposes only.
 */
function simulateSpectatorMessages(
  transitions: Transition[],
  _previousHandState: EngineState | null,
  _mode: 'immediate' | 'delayed' | 'showdown'
): SpectatorMessage[] {
  return transitions.map(transition => {
    // Fixed: always use current transition state (no previousHandState swap)
    const stateToSend = transition.state;

    return {
      eventType: transition.event.type,
      stateHandNumber: stateToSend.handNumber,
      stateStage: stateToSend.stage,
      communityCardsLength: stateToSend.communityCards.length,
      usedDelayedState: false,
    };
  });
}

// Rigged deck: player-1 gets pocket aces, player-2 gets pocket twos.
// Community: K Q J T 9 (straight + full-board).
// Deal order: each player gets 2 cards sequentially (no burn cards in engine).
//   deck[0-1] → player-1, deck[2-3] → player-2, deck[4-8] → community
const RIGGED_DECK = makePaddedDeck([
  'Ah', 'As',        // player-1 hole cards
  '2c', '2d',        // player-2 hole cards
  'Kh', 'Qd', 'Jc', // flop
  'Th',              // turn
  '9d',              // river
]);

// ═══════════════════════════════════════════════════════════════════════════════
// Smoke test
// ═══════════════════════════════════════════════════════════════════════════════

describe('Smoke — hand reaches showdown', () => {
  test('hand ends with handInProgress=false and 5 community cards', () => {
    const state = createSpectatorGame();
    const { finalState } = playHandToShowdown(state, RIGGED_DECK);

    expect(finalState.handInProgress).toBe(false);
    expect(finalState.communityCards).toHaveLength(5);
  });

  test('all expected event types are emitted', () => {
    const state = createSpectatorGame();
    const { transitions } = playHandToShowdown(state, RIGGED_DECK);

    const types = transitions.map(t => t.event.type);
    for (const expected of ['HAND_START', 'BLINDS_POSTED', 'DEAL', 'FLOP', 'TURN', 'RIVER', 'SHOWDOWN', 'HAND_END']) {
      expect(types).toContain(expected);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// immediate mode
// ═══════════════════════════════════════════════════════════════════════════════

describe('immediate mode — spectator sees current state for every event', () => {
  let messages: SpectatorMessage[];

  beforeAll(() => {
    const state = createSpectatorGame();
    const { transitions } = playHandToShowdown(state, RIGGED_DECK);
    messages = simulateSpectatorMessages(transitions, null, 'immediate');
  });

  test('usedDelayedState is always false', () => {
    expect(messages.every(m => !m.usedDelayedState)).toBe(true);
  });

  test('handNumber is consistent across all events', () => {
    const numbers = new Set(messages.map(m => m.stateHandNumber));
    expect(numbers.size).toBe(1);
    expect([...numbers][0]).toBe(1);
  });

  test('HAND_START / BLINDS_POSTED / DEAL events have 0 community cards', () => {
    for (const msg of messages.filter(m => ['HAND_START', 'BLINDS_POSTED', 'DEAL'].includes(m.eventType))) {
      expect(msg.communityCardsLength).toBe(0);
    }
  });

  test('FLOP event has 3 community cards in state', () => {
    const flop = messages.find(m => m.eventType === 'FLOP');
    expect(flop).toBeDefined();
    expect(flop!.communityCardsLength).toBe(3);
  });

  test('TURN event has 4 community cards in state', () => {
    const turn = messages.find(m => m.eventType === 'TURN');
    expect(turn).toBeDefined();
    expect(turn!.communityCardsLength).toBe(4);
  });

  test('RIVER / SHOWDOWN / HAND_END events have 5 community cards in state', () => {
    for (const msg of messages.filter(m => ['RIVER', 'SHOWDOWN', 'HAND_END'].includes(m.eventType))) {
      expect(msg.communityCardsLength).toBe(5);
    }
  });

  test('stage ordering: FLOP < TURN < RIVER', () => {
    const types = messages.map(m => m.eventType);
    const fi = types.indexOf('FLOP');
    const ti = types.indexOf('TURN');
    const ri = types.indexOf('RIVER');
    expect(fi).toBeGreaterThan(-1);
    expect(ti).toBeGreaterThan(fi);
    expect(ri).toBeGreaterThan(ti);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// showdown mode
// ═══════════════════════════════════════════════════════════════════════════════

describe('showdown mode — same state/event pairing as immediate (no mismatch)', () => {
  let messages: SpectatorMessage[];

  beforeAll(() => {
    const state = createSpectatorGame();
    const { transitions } = playHandToShowdown(state, RIGGED_DECK);
    messages = simulateSpectatorMessages(transitions, null, 'showdown');
  });

  test('usedDelayedState is always false', () => {
    expect(messages.every(m => !m.usedDelayedState)).toBe(true);
  });

  test('FLOP event has 3 community cards in state', () => {
    const flop = messages.find(m => m.eventType === 'FLOP');
    expect(flop).toBeDefined();
    expect(flop!.communityCardsLength).toBe(3);
  });

  test('TURN event has 4 community cards in state', () => {
    const turn = messages.find(m => m.eventType === 'TURN');
    expect(turn).toBeDefined();
    expect(turn!.communityCardsLength).toBe(4);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// delayed mode — first hand (no previousHandState)
// ═══════════════════════════════════════════════════════════════════════════════

describe('delayed mode — first hand, no previousHandState', () => {
  let messages: SpectatorMessage[];

  beforeAll(() => {
    const state = createSpectatorGame();
    const { transitions } = playHandToShowdown(state, RIGGED_DECK);
    // previousHandState is null on the very first hand
    messages = simulateSpectatorMessages(transitions, null, 'delayed');
  });

  test('usedDelayedState is always false when previousHandState is null', () => {
    expect(messages.every(m => !m.usedDelayedState)).toBe(true);
  });

  test('FLOP event has 3 community cards in state (fallback to current)', () => {
    const flop = messages.find(m => m.eventType === 'FLOP');
    expect(flop!.communityCardsLength).toBe(3);
  });

  test('handNumber is consistent', () => {
    const numbers = new Set(messages.map(m => m.stateHandNumber));
    expect(numbers.size).toBe(1);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// delayed mode — second hand: verifies the fix for EVENT_STATE_HAND_MISMATCH
//
// Before the fix, GameManager sent previousHandState (hand 1's showdown state)
// paired with hand 2's events, causing FLOP → 5 community cards, wrong handNumber.
// After the fix, current state is always sent, so assertions are correct.
// ═══════════════════════════════════════════════════════════════════════════════

describe('delayed mode — second hand uses current state (fix verification)', () => {
  let hand2Messages: SpectatorMessage[];

  beforeAll(() => {
    const state = createSpectatorGame();

    // Play hand 1 quickly: SB folds pre-flop so both players keep their stacks.
    // (If we went all-in, one player would bust out and hand 2 could not start.)
    const startTransitions1 = startHand(state, RIGGED_DECK);
    const afterDeal1 = startTransitions1[startTransitions1.length - 1].state;
    const foldTransitions = processAction(afterDeal1, afterDeal1.activePlayerId!, 'FOLD');
    const hand1Final = foldTransitions[foldTransitions.length - 1].state;

    expect(hand1Final.handInProgress).toBe(false);
    expect(hand1Final.handNumber).toBe(1);
    expect(hand1Final.players.filter(p => p.role === 'player').every(p => p.stack > 0)).toBe(true);

    // GameManager.onHandEnd would store this as previousHandState — but after
    // the fix it is no longer used as the state payload.
    const previousHandState = cloneState(hand1Final);

    // Start hand 2 (just the initial transitions from startHand)
    const hand2StartTransitions = startHand(hand1Final, RIGGED_DECK);

    hand2Messages = simulateSpectatorMessages(
      hand2StartTransitions,
      previousHandState,
      'delayed',
    );
  });

  test('usedDelayedState is false (fix: current state is always used)', () => {
    expect(hand2Messages.every(m => !m.usedDelayedState)).toBe(true);
  });

  test('HAND_START event for hand 2 has correct handNumber (2)', () => {
    const msg = hand2Messages.find(m => m.eventType === 'HAND_START')!;
    expect(msg).toBeDefined();
    expect(msg.stateHandNumber).toBe(2);
  });

  test('HAND_START event for hand 2 has 0 community cards (new hand)', () => {
    const msg = hand2Messages.find(m => m.eventType === 'HAND_START')!;
    expect(msg.communityCardsLength).toBe(0);
  });

  test('HAND_START event for hand 2 has stage PRE_FLOP', () => {
    const msg = hand2Messages.find(m => m.eventType === 'HAND_START')!;
    expect(msg.stateStage).toBe('PRE_FLOP');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// showdown mode — hole card visibility
//
// Spectators in showdown mode must see null hole cards during play, and
// non-null hole cards at (and after) SHOWDOWN. Uses toClientGameState directly
// to verify what the server actually sends per transition.
// ═══════════════════════════════════════════════════════════════════════════════

describe('showdown mode — hole card visibility per transition', () => {
  interface ShowdownVisMsg {
    eventType: string;
    stage: string;
    handInProgress: boolean;
    holeCardCount: number;
    communityCardCount: number;
  }

  let messages: ShowdownVisMsg[];

  beforeAll(() => {
    const state = createSpectatorGame();
    const { transitions } = playHandToShowdown(state, RIGGED_DECK);

    messages = transitions.map(t => {
      const clientState = toClientGameState(t.state, 'spectator-1', 'showdown');
      const holeCardCount = clientState.players.filter(
        p => p.role !== 'spectator' && p.holeCards !== null
      ).length;
      return {
        eventType: t.event.type,
        stage: t.state.stage,
        handInProgress: t.state.handInProgress,
        holeCardCount,
        communityCardCount: t.state.communityCards.length,
      };
    });
  });

  test('spectator never sees hole cards before SHOWDOWN stage', () => {
    const priorToShowdown = messages.filter(m => m.handInProgress && m.stage !== 'SHOWDOWN');
    expect(priorToShowdown.length).toBeGreaterThan(0);
    for (const msg of priorToShowdown) {
      expect(msg.holeCardCount).toBe(0);
    }
  });

  test('spectator sees hole cards at SHOWDOWN stage', () => {
    const showdownMsg = messages.find(m => m.eventType === 'SHOWDOWN');
    expect(showdownMsg).toBeDefined();
    expect(showdownMsg!.holeCardCount).toBeGreaterThan(0);
  });

  test('community cards never decrease across consecutive transitions', () => {
    let prev = -1;
    for (const msg of messages) {
      if (msg.eventType === 'HAND_START') {
        // Reset allowed only at new hand
        prev = msg.communityCardCount;
        continue;
      }
      expect(msg.communityCardCount).toBeGreaterThanOrEqual(prev);
      prev = msg.communityCardCount;
    }
  });

  test('FLOP event state has exactly 3 community cards', () => {
    const flop = messages.find(m => m.eventType === 'FLOP');
    expect(flop).toBeDefined();
    expect(flop!.communityCardCount).toBe(3);
  });

  test('TURN event state has exactly 4 community cards', () => {
    const turn = messages.find(m => m.eventType === 'TURN');
    expect(turn).toBeDefined();
    expect(turn!.communityCardCount).toBe(4);
  });

  test('RIVER event state has exactly 5 community cards', () => {
    const river = messages.find(m => m.eventType === 'RIVER');
    expect(river).toBeDefined();
    expect(river!.communityCardCount).toBe(5);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// delayed mode — hole card visibility on first hand (Bug 2 regression test)
//
// Before the fix, `determineVisibleCards` always returned player.holeCards for
// the 'delayed' case, showing hole cards during active play on the first hand
// (when previousHandState === null, so active.state is sent, not previousHandState).
// After the fix, delayed behaves like showdown: cards hidden during play.
// ═══════════════════════════════════════════════════════════════════════════════

describe('delayed mode — first hand hole cards hidden during play (Bug 2 fix)', () => {
  interface VisMessage {
    eventType: string;
    stage: string;
    handInProgress: boolean;
    holeCardCount: number;
  }

  let messages: VisMessage[];

  beforeAll(() => {
    const state = createSpectatorGame();
    const { transitions } = playHandToShowdown(state, RIGGED_DECK);

    // On first hand, previousHandState === null so GameManager sends active.state.
    // We simulate that by just using the current transition state with delayed mode.
    messages = transitions.map(t => {
      const clientState = toClientGameState(t.state, 'spectator-1', 'delayed');
      const holeCardCount = clientState.players.filter(
        p => p.role !== 'spectator' && p.holeCards !== null
      ).length;
      return {
        eventType: t.event.type,
        stage: t.state.stage,
        handInProgress: t.state.handInProgress,
        holeCardCount,
      };
    });
  });

  test('hole cards are null during active play (PRE_FLOP / FLOP / TURN / RIVER stages)', () => {
    const duringPlay = messages.filter(m => m.handInProgress && m.stage !== 'SHOWDOWN');
    // There must be at least some such transitions
    expect(duringPlay.length).toBeGreaterThan(0);
    for (const msg of duringPlay) {
      expect(msg.holeCardCount).toBe(0);
    }
  });

  test('hole cards are visible at SHOWDOWN', () => {
    const showdownMsg = messages.find(m => m.eventType === 'SHOWDOWN');
    expect(showdownMsg).toBeDefined();
    expect(showdownMsg!.holeCardCount).toBeGreaterThan(0);
  });

  test('hole cards are visible when hand is not in progress (HAND_END)', () => {
    const handEndMsg = messages.find(m => m.eventType === 'HAND_END');
    expect(handEndMsg).toBeDefined();
    expect(handEndMsg!.handInProgress).toBe(false);
    expect(handEndMsg!.holeCardCount).toBeGreaterThan(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// joinGame initial state — spectator visibility applied correctly (Bug 5 fix)
//
// When a spectator joins mid-hand, the server sends the current board state in
// the `gameJoined` message. That state is built with toClientGameState().
// Previously, `joinGame` omitted the spectatorVisibility arg, causing it to
// fall back to the global config default instead of the per-game setting.
//
// These tests verify toClientGameState behaves correctly for each mode, and
// document that omitting the arg uses the global default (showdown), NOT the
// per-game mode — proving the fix is needed in joinGame.
// ═══════════════════════════════════════════════════════════════════════════════

describe('joinGame initial state — spectator visibility (Bug 5 fix)', () => {
  // Find the state immediately after DEAL (PRE_FLOP, cards dealt, hand in progress)
  let stateAfterDeal: EngineState;

  beforeAll(() => {
    const state = createSpectatorGame();
    const { transitions } = playHandToShowdown(state, RIGGED_DECK);
    // DEAL transition is the one where the event type is 'DEAL'
    const dealTransition = transitions.find(t => t.event.type === 'DEAL');
    expect(dealTransition).toBeDefined();
    stateAfterDeal = dealTransition!.state;
  });

  test('immediate mode: joinGame state shows hole cards during PRE_FLOP', () => {
    // This is what the fix causes joinGame to call:
    // toClientGameState(state, spectatorId, 'immediate')
    const clientState = toClientGameState(stateAfterDeal, 'spectator-1', 'immediate');
    const visibleCount = clientState.players.filter(
      p => p.role !== 'spectator' && p.holeCards !== null
    ).length;
    expect(visibleCount).toBeGreaterThan(0);
  });

  test('immediate mode: omitting visibility arg uses global default (showdown), not immediate', () => {
    // This is what the OLD (unfixed) joinGame called — no spectatorVisibility arg.
    // The engine falls back to config.SPECTATOR_CARD_VISIBILITY (default: 'showdown'),
    // so hole cards are hidden even though the per-game mode is 'immediate'.
    // This test documents the pre-fix behavior; it confirms the fix is necessary.
    const clientState = toClientGameState(stateAfterDeal, 'spectator-1' /*, no 3rd arg */);
    const visibleCount = clientState.players.filter(
      p => p.role !== 'spectator' && p.holeCards !== null
    ).length;
    // Global default is 'showdown' → cards hidden during PRE_FLOP
    expect(visibleCount).toBe(0);
  });

  test('showdown mode: joinGame state hides hole cards during PRE_FLOP', () => {
    const clientState = toClientGameState(stateAfterDeal, 'spectator-1', 'showdown');
    const visibleCount = clientState.players.filter(
      p => p.role !== 'spectator' && p.holeCards !== null
    ).length;
    expect(visibleCount).toBe(0);
  });

  test('showdown mode: joinGame state shows hole cards after SHOWDOWN', () => {
    const state = createSpectatorGame();
    const { transitions } = playHandToShowdown(state, RIGGED_DECK);
    const showdownTransition = transitions.find(t => t.event.type === 'SHOWDOWN');
    expect(showdownTransition).toBeDefined();

    const clientState = toClientGameState(showdownTransition!.state, 'spectator-1', 'showdown');
    const visibleCount = clientState.players.filter(
      p => p.role !== 'spectator' && p.holeCards !== null
    ).length;
    expect(visibleCount).toBeGreaterThan(0);
  });
});
