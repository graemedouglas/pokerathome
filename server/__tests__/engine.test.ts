import { createDeck, shuffle, deal } from '../src/engine/deck';
import { calculatePots, distributePots } from '../src/engine/pot';
import { getAvailableActions, validateAction } from '../src/engine/action-validator';
import {
  createInitialState,
  addPlayer,
  setPlayerReady,
  startHand,
  processAction,
  toClientGameState,
  type EngineState,
  type EnginePlayer,
} from '../src/engine/game';

// ═══════════════════════════════════════════════════════════════════════════════
// Deck
// ═══════════════════════════════════════════════════════════════════════════════

describe('Deck', () => {
  test('createDeck produces 52 unique cards', () => {
    const deck = createDeck();
    expect(deck).toHaveLength(52);
    expect(new Set(deck).size).toBe(52);
  });

  test('all cards match the card notation format', () => {
    const deck = createDeck();
    const pattern = /^[2-9TJQKA][hdcs]$/;
    for (const card of deck) {
      expect(card).toMatch(pattern);
    }
  });

  test('shuffle returns all 52 cards in a different order', () => {
    const deck = createDeck();
    const shuffled = shuffle(deck);
    expect(shuffled).toHaveLength(52);
    expect(new Set(shuffled).size).toBe(52);
    // Extremely unlikely to be same order after shuffle
    expect(shuffled).not.toEqual(deck);
  });

  test('deal removes cards from the top', () => {
    const deck = createDeck();
    const { cards, remaining } = deal(deck, 5);
    expect(cards).toHaveLength(5);
    expect(remaining).toHaveLength(47);
    expect(cards).toEqual(deck.slice(0, 5));
    expect(remaining).toEqual(deck.slice(5));
  });

  test('deal throws if not enough cards', () => {
    expect(() => deal(['Ah', 'Kh'], 3)).toThrow();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Pot calculation
// ═══════════════════════════════════════════════════════════════════════════════

describe('Pot calculation', () => {
  test('single pot with equal contributions', () => {
    const players = [
      { id: 'a', potShare: 100, folded: false },
      { id: 'b', potShare: 100, folded: false },
      { id: 'c', potShare: 100, folded: false },
    ];
    const { pot, pots } = calculatePots(players);
    expect(pot).toBe(300);
    expect(pots).toHaveLength(1);
    expect(pots[0].amount).toBe(300);
    expect(pots[0].eligiblePlayerIds).toEqual(expect.arrayContaining(['a', 'b', 'c']));
  });

  test('side pot when one player is all-in for less', () => {
    const players = [
      { id: 'a', potShare: 50, folded: false },  // all-in for 50
      { id: 'b', potShare: 100, folded: false },
      { id: 'c', potShare: 100, folded: false },
    ];
    const { pot, pots } = calculatePots(players);
    expect(pot).toBe(250);
    expect(pots).toHaveLength(2);
    // Main pot: 50 * 3 = 150, eligible: a, b, c
    expect(pots[0].amount).toBe(150);
    expect(pots[0].eligiblePlayerIds).toEqual(expect.arrayContaining(['a', 'b', 'c']));
    // Side pot: 50 * 2 = 100, eligible: b, c
    expect(pots[1].amount).toBe(100);
    expect(pots[1].eligiblePlayerIds).toEqual(expect.arrayContaining(['b', 'c']));
    expect(pots[1].eligiblePlayerIds).not.toContain('a');
  });

  test('folded player contributes to pot but cannot win', () => {
    const players = [
      { id: 'a', potShare: 100, folded: true },
      { id: 'b', potShare: 100, folded: false },
      { id: 'c', potShare: 100, folded: false },
    ];
    const { pot, pots } = calculatePots(players);
    expect(pot).toBe(300);
    // All 300 goes to one pot, but only b and c are eligible
    expect(pots[0].eligiblePlayerIds).toEqual(expect.arrayContaining(['b', 'c']));
    expect(pots[0].eligiblePlayerIds).not.toContain('a');
  });

  test('multiple side pots with folded players', () => {
    const players = [
      { id: 'a', potShare: 30, folded: true },
      { id: 'b', potShare: 50, folded: false },  // all-in
      { id: 'c', potShare: 100, folded: false },
      { id: 'd', potShare: 100, folded: false },
    ];
    const { pot, pots } = calculatePots(players);
    expect(pot).toBe(280);
    // Tier 30: 30*4 = 120, eligible: b, c, d
    // Tier 50: 20*3 = 60, eligible: b, c, d (merged with above since same eligible)
    // Actually: tier 30 contributors >= 30: a,b,c,d (4). amount = 30*4=120. eligible (non-folded): b,c,d
    // tier 50: contributors >= 50: b,c,d (3). amount = 20*3 = 60. eligible: b,c,d. Same eligible -> merge
    // tier 100: contributors >= 100: c,d (2). amount = 50*2 = 100. eligible: c,d
    // After merge: pot0 = 180 (b,c,d), pot1 = 100 (c,d)
    expect(pots).toHaveLength(2);
    expect(pots[0].amount).toBe(180);
    expect(pots[1].amount).toBe(100);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Game state machine
// ═══════════════════════════════════════════════════════════════════════════════

function createTestGame(): EngineState {
  let state = createInitialState({
    gameId: 'test-game',
    gameName: 'Test',
    gameType: 'cash',
    smallBlindAmount: 5,
    bigBlindAmount: 10,
    maxPlayers: 6,
    startingStack: 1000,
  });

  const p1 = addPlayer(state, 'player-1', 'Alice');
  state = p1.state;
  const p2 = addPlayer(state, 'player-2', 'Bob');
  state = p2.state;
  const p3 = addPlayer(state, 'player-3', 'Charlie');
  state = p3.state;

  state = setPlayerReady(state, 'player-1');
  state = setPlayerReady(state, 'player-2');
  state = setPlayerReady(state, 'player-3');

  return state;
}

describe('Game state machine', () => {
  test('startHand produces correct event sequence', () => {
    const state = createTestGame();
    const transitions = startHand(state);

    expect(transitions.length).toBeGreaterThanOrEqual(3);
    expect(transitions[0].event.type).toBe('HAND_START');
    expect(transitions[1].event.type).toBe('BLINDS_POSTED');
    expect(transitions[2].event.type).toBe('DEAL');
  });

  test('startHand increments hand number', () => {
    const state = createTestGame();
    const transitions = startHand(state);
    expect(transitions[0].state.handNumber).toBe(1);
  });

  test('blinds are posted correctly', () => {
    const state = createTestGame();
    const transitions = startHand(state);
    const blindsState = transitions[1].state;

    // Find the players who posted blinds
    const sbPlayer = blindsState.players.find((p) => p.bet === 5);
    const bbPlayer = blindsState.players.find((p) => p.bet === 10);
    expect(sbPlayer).toBeDefined();
    expect(bbPlayer).toBeDefined();
    expect(sbPlayer!.stack).toBe(995);
    expect(bbPlayer!.stack).toBe(990);
  });

  test('hole cards are dealt to all active players', () => {
    const state = createTestGame();
    const transitions = startHand(state);
    const dealState = transitions[2].state;

    for (const player of dealState.players) {
      if (player.role === 'player') {
        expect(player.holeCards).toHaveLength(2);
      }
    }
  });

  test('active player is set after deal', () => {
    const state = createTestGame();
    const transitions = startHand(state);
    const dealState = transitions[2].state;
    expect(dealState.activePlayerId).not.toBeNull();
  });

  test('client state hides opponent hole cards', () => {
    const state = createTestGame();
    const transitions = startHand(state);
    const dealState = transitions[2].state;

    const clientState = toClientGameState(dealState, 'player-1');
    const self = clientState.players.find((p) => p.id === 'player-1');
    const opponent = clientState.players.find((p) => p.id !== 'player-1');

    expect(self!.holeCards).not.toBeNull();
    expect(opponent!.holeCards).toBeNull();
  });

  test('fold action reduces non-folded player count', () => {
    const state = createTestGame();
    const transitions = startHand(state);
    const dealState = transitions[transitions.length - 1].state;
    const activeId = dealState.activePlayerId!;

    const actionTransitions = processAction(dealState, activeId, 'FOLD');
    const afterFold = actionTransitions[0].state;
    const foldedPlayer = afterFold.players.find((p) => p.id === activeId);
    expect(foldedPlayer!.folded).toBe(true);
  });

  test('everyone folds to one player — hand ends without showdown', () => {
    const state = createTestGame();
    const handTransitions = startHand(state);
    let current = handTransitions[handTransitions.length - 1].state;

    // Fold all but one
    for (let i = 0; i < 2; i++) {
      const activeId = current.activePlayerId;
      if (!activeId) break;
      const transitions = processAction(current, activeId, 'FOLD');
      current = transitions[transitions.length - 1].state;
    }

    // Should have ended
    expect(current.handInProgress).toBe(false);

    // Winner should have received pot
    const nonFolded = current.players.filter((p) => !p.folded);
    expect(nonFolded).toHaveLength(1);
    // Winner got blinds back + opponent blinds
    expect(nonFolded[0].stack).toBeGreaterThan(1000);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Action validator
// ═══════════════════════════════════════════════════════════════════════════════

describe('Action validator', () => {
  test('pre-flop active player has expected actions', () => {
    const state = createTestGame();
    const transitions = startHand(state);
    const dealState = transitions[transitions.length - 1].state;
    const activeId = dealState.activePlayerId!;

    const actions = getAvailableActions(dealState, activeId);
    const types = actions.map((a) => a.type);

    expect(types).toContain('FOLD');
    expect(types).toContain('CALL');
    expect(types).toContain('RAISE');
    expect(types).toContain('ALL_IN');
    // No CHECK pre-flop (there's a bet to match)
    expect(types).not.toContain('CHECK');
    // No BET pre-flop (blinds already opened)
    expect(types).not.toContain('BET');
  });

  test('CALL amount equals big blind minus current bet', () => {
    const state = createTestGame();
    const transitions = startHand(state);
    const dealState = transitions[transitions.length - 1].state;
    const activeId = dealState.activePlayerId!;

    const actions = getAvailableActions(dealState, activeId);
    const callAction = actions.find((a) => a.type === 'CALL');
    expect(callAction!.amount).toBe(10); // BB = 10, player bet = 0
  });

  test('RAISE min accounts for last raise size', () => {
    const state = createTestGame();
    const transitions = startHand(state);
    const dealState = transitions[transitions.length - 1].state;
    const activeId = dealState.activePlayerId!;

    const actions = getAvailableActions(dealState, activeId);
    const raiseAction = actions.find((a) => a.type === 'RAISE');
    // Call 10 + min raise 10 (BB) = 20
    expect(raiseAction!.min).toBe(20);
  });

  test('validateAction rejects invalid action type', () => {
    const state = createTestGame();
    const transitions = startHand(state);
    const dealState = transitions[transitions.length - 1].state;
    const activeId = dealState.activePlayerId!;

    const error = validateAction(dealState, activeId, 'CHECK');
    expect(error).not.toBeNull();
    expect(error!.code).toBe('INVALID_ACTION');
  });

  test('validateAction accepts valid CALL', () => {
    const state = createTestGame();
    const transitions = startHand(state);
    const dealState = transitions[transitions.length - 1].state;
    const activeId = dealState.activePlayerId!;

    const error = validateAction(dealState, activeId, 'CALL');
    expect(error).toBeNull();
  });

  test('validateAction returns INVALID_AMOUNT for out-of-range raise', () => {
    const state = createTestGame();
    const transitions = startHand(state);
    const dealState = transitions[transitions.length - 1].state;
    const activeId = dealState.activePlayerId!;

    const error = validateAction(dealState, activeId, 'RAISE', 1);
    expect(error).not.toBeNull();
    expect(error!.code).toBe('INVALID_AMOUNT');
  });
});
