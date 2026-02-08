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

// ═══════════════════════════════════════════════════════════════════════════════
// Spectator support
// ═══════════════════════════════════════════════════════════════════════════════

describe('Spectator support', () => {
  test('spectator gets seatIndex >= maxPlayers', () => {
    let state = createInitialState({
      gameId: 'test-spec',
      gameName: 'Test',
      gameType: 'cash',
      smallBlindAmount: 5,
      bigBlindAmount: 10,
      maxPlayers: 6,
      startingStack: 1000,
    });

    const p1 = addPlayer(state, 'player-1', 'Alice');
    state = p1.state;
    const spec = addPlayer(state, 'spec-1', 'Spectator', 'spectator');
    state = spec.state;

    expect(spec.seatIndex).toBeGreaterThanOrEqual(6);
    const spectator = state.players.find((p) => p.id === 'spec-1')!;
    expect(spectator.role).toBe('spectator');
    expect(spectator.stack).toBe(0);
    expect(spectator.isReady).toBe(true);
  });

  test('spectator does not take a playing seat', () => {
    let state = createInitialState({
      gameId: 'test-spec2',
      gameName: 'Test',
      gameType: 'cash',
      smallBlindAmount: 5,
      bigBlindAmount: 10,
      maxPlayers: 2,
      startingStack: 1000,
    });

    const p1 = addPlayer(state, 'player-1', 'Alice');
    state = p1.state;
    const spec = addPlayer(state, 'spec-1', 'Spectator', 'spectator');
    state = spec.state;

    // Seat 1 should still be free for another player
    const p2 = addPlayer(state, 'player-2', 'Bob');
    state = p2.state;
    expect(p2.seatIndex).toBe(1);
  });

  test('spectator sees all hole cards via toClientGameState', () => {
    const state = createTestGame();
    const transitions = startHand(state);
    const dealState = transitions[transitions.length - 1].state;

    // Add a spectator to the dealt state
    const result = addPlayer(dealState, 'spec-1', 'Watcher', 'spectator');
    const withSpec = result.state;

    const clientState = toClientGameState(withSpec, 'spec-1');
    const otherPlayers = clientState.players.filter((p) => p.id !== 'spec-1' && p.role === 'player');

    for (const p of otherPlayers) {
      expect(p.holeCards).not.toBeNull();
      expect(p.holeCards).toHaveLength(2);
    }
  });

  test('PlayerJoinedEvent includes role for spectators', () => {
    let state = createInitialState({
      gameId: 'test-spec3',
      gameName: 'Test',
      gameType: 'cash',
      smallBlindAmount: 5,
      bigBlindAmount: 10,
      maxPlayers: 6,
      startingStack: 1000,
    });

    const result = addPlayer(state, 'spec-1', 'Watcher', 'spectator');
    expect(result.event.type).toBe('PLAYER_JOINED');
    if (result.event.type === 'PLAYER_JOINED') {
      expect(result.event.role).toBe('spectator');
    }
  });

  test('multiple spectators get unique seats', () => {
    let state = createInitialState({
      gameId: 'test-spec4',
      gameName: 'Test',
      gameType: 'cash',
      smallBlindAmount: 5,
      bigBlindAmount: 10,
      maxPlayers: 6,
      startingStack: 1000,
    });

    const s1 = addPlayer(state, 'spec-1', 'Spec1', 'spectator');
    state = s1.state;
    const s2 = addPlayer(state, 'spec-2', 'Spec2', 'spectator');
    state = s2.state;

    expect(s1.seatIndex).not.toBe(s2.seatIndex);
    expect(s1.seatIndex).toBeGreaterThanOrEqual(6);
    expect(s2.seatIndex).toBeGreaterThanOrEqual(6);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Rigged deck
// ═══════════════════════════════════════════════════════════════════════════════

describe('Rigged deck', () => {
  function createHeadsUpGame(): EngineState {
    let state = createInitialState({
      gameId: 'test-rigged',
      gameName: 'Rigged Test',
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
    state = setPlayerReady(state, 'player-1');
    state = setPlayerReady(state, 'player-2');
    return state;
  }

  test('startHand uses deckOverride when provided', () => {
    const state = createHeadsUpGame();

    // Rig the deck: player-1 gets AA, player-2 gets KK
    // Heads-up: dealer=player-1 (seat 0), SB=player-1, BB=player-2
    // Deal order: seat 0 (player-1) then seat 1 (player-2)
    const riggedDeck = [
      'Ah', 'As',  // player-1 hole cards
      'Kh', 'Ks',  // player-2 hole cards
      '2c', '3c', '4c',  // flop
      '5c',  // turn
      '6c',  // river
      // Pad rest with arbitrary cards
      ...createDeck().filter(c => !['Ah', 'As', 'Kh', 'Ks', '2c', '3c', '4c', '5c', '6c'].includes(c)),
    ];

    const transitions = startHand(state, riggedDeck);
    const dealState = transitions[transitions.length - 1].state;

    // Verify player-1 got AA
    const p1 = dealState.players.find(p => p.id === 'player-1')!;
    expect(p1.holeCards).toEqual(['Ah', 'As']);

    // Verify player-2 got KK
    const p2 = dealState.players.find(p => p.id === 'player-2')!;
    expect(p2.holeCards).toEqual(['Kh', 'Ks']);
  });

  test('rigged deck deals correct community cards', () => {
    const state = createHeadsUpGame();

    const riggedDeck = [
      'Th', 'Jh',  // player-1
      '2c', '3d',  // player-2
      'Ah', 'Kh', 'Qh',  // flop (royal flush draw for player-1)
      '9s',  // turn
      '8s',  // river
      ...createDeck().filter(c => !['Th', 'Jh', '2c', '3d', 'Ah', 'Kh', 'Qh', '9s', '8s'].includes(c)),
    ];

    const transitions = startHand(state, riggedDeck);
    let current = transitions[transitions.length - 1].state;

    // Get to the flop: active player is dealer (player-1) in heads-up preflop
    // Both players call/check through to see community cards
    const activeId = current.activePlayerId!;
    let actionTransitions = processAction(current, activeId, 'CALL');
    current = actionTransitions[actionTransitions.length - 1].state;

    // BB might need to check
    if (current.activePlayerId) {
      actionTransitions = processAction(current, current.activePlayerId, 'CHECK');
      current = actionTransitions[actionTransitions.length - 1].state;
    }

    // Should be on flop now
    expect(current.stage).toBe('FLOP');
    expect(current.communityCards).toEqual(['Ah', 'Kh', 'Qh']);
  });

  test('rigged deck produces predictable showdown', () => {
    const state = createHeadsUpGame();

    // Give player-1 pocket aces, player-2 pocket twos
    // Board is all high cards — player-1 wins
    const riggedDeck = [
      'Ah', 'As',  // player-1 — pair of aces
      '2c', '2d',  // player-2 — pair of twos
      'Kh', 'Qh', 'Jh',  // flop
      'Td',  // turn
      '9d',  // river
      ...createDeck().filter(c => !['Ah', 'As', '2c', '2d', 'Kh', 'Qh', 'Jh', 'Td', '9d'].includes(c)),
    ];

    const transitions = startHand(state, riggedDeck);
    let current = transitions[transitions.length - 1].state;

    // Play all-in to force showdown
    const activeId = current.activePlayerId!;
    let actionTransitions = processAction(current, activeId, 'ALL_IN');
    current = actionTransitions[actionTransitions.length - 1].state;

    if (current.activePlayerId) {
      actionTransitions = processAction(current, current.activePlayerId, 'ALL_IN');
      current = actionTransitions[actionTransitions.length - 1].state;
    }

    // Hand should have ended
    expect(current.handInProgress).toBe(false);

    // player-1 should have won (AA vs 22 on KQJT9 board = AA straight)
    // Actually, both have straights with the board, but let's check the winner
    const p1 = current.players.find(p => p.id === 'player-1')!;
    const p2 = current.players.find(p => p.id === 'player-2')!;
    // player-1 with Ah has ace-high straight (AKQJT), player-2 with 2c2d has KQJT9
    // player-1 should win
    expect(p1.stack).toBeGreaterThan(p2.stack);
  });

  test('startHand without deckOverride still works (shuffled)', () => {
    const state = createHeadsUpGame();
    const transitions = startHand(state);
    const dealState = transitions[transitions.length - 1].state;

    // Should still deal cards
    const p1 = dealState.players.find(p => p.id === 'player-1')!;
    expect(p1.holeCards).toHaveLength(2);
  });
});
