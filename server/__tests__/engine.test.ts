import { createDeck, shuffle, deal } from '../src/engine/deck';
import { calculatePots, distributePots } from '../src/engine/pot';
import { getAvailableActions, validateAction } from '../src/engine/action-validator';
import {
  createInitialState,
  addPlayer,
  setPlayerReady,
  setPlayerUnready,
  startHand,
  processAction,
  toClientGameState,
  buildGameStatePayload,
  type EngineState,
  type EnginePlayer,
} from '../src/engine/game';
import { config } from '../src/config';

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

    const clientState = toClientGameState(withSpec, 'spec-1', 'immediate');
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

// ═══════════════════════════════════════════════════════════════════════════════
// Regression tests — specific bugs that were fixed
// ═══════════════════════════════════════════════════════════════════════════════

describe('All-in action handling', () => {
  function createHeadsUpGame(): EngineState {
    let state = createInitialState({
      gameId: 'test-allin',
      gameName: 'All-in Test',
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

  test('ALL_IN sets player stack to 0 and marks isAllIn', () => {
    // Use 3-player game so ALL_IN doesn't immediately complete the round
    const state = createTestGame();
    const transitions = startHand(state);
    let current = transitions[transitions.length - 1].state;

    const activeId = current.activePlayerId!;
    const stackBefore = current.players.find(p => p.id === activeId)!.stack;
    expect(stackBefore).toBeGreaterThan(0);

    const actionTransitions = processAction(current, activeId, 'ALL_IN');
    // Check the first transition (PLAYER_ACTION) — not the last, since
    // round completion may advance stages and alter stacks via winnings
    const afterAction = actionTransitions[0].state;
    const player = afterAction.players.find(p => p.id === activeId)!;
    expect(player.stack).toBe(0);
    expect(player.isAllIn).toBe(true);
  });

  test('ALL_IN is available when player cannot afford minimum raise', () => {
    // Give player-1 a small stack that can't cover call + min raise
    let state = createInitialState({
      gameId: 'test-short',
      gameName: 'Short Stack',
      gameType: 'cash',
      smallBlindAmount: 50,
      bigBlindAmount: 100,
      maxPlayers: 6,
      startingStack: 1000,
    });
    const p1 = addPlayer(state, 'player-1', 'Alice');
    state = p1.state;
    const p2 = addPlayer(state, 'player-2', 'Bob');
    state = p2.state;
    state = setPlayerReady(state, 'player-1');
    state = setPlayerReady(state, 'player-2');

    // Start with a rigged deck. Player-1 is dealer/SB in heads-up.
    const riggedDeck = [
      'Ah', 'As', 'Kh', 'Ks',
      '2c', '3c', '4c', '5c', '6c',
      ...createDeck().filter(c => !['Ah', 'As', 'Kh', 'Ks', '2c', '3c', '4c', '5c', '6c'].includes(c)),
    ];
    const transitions = startHand(state, riggedDeck);
    let current = transitions[transitions.length - 1].state;

    // Player-1 (dealer/SB in heads-up, first to act pre-flop) raises big
    const p1Id = current.activePlayerId!;
    let actionTransitions = processAction(current, p1Id, 'RAISE', 900);
    current = actionTransitions[actionTransitions.length - 1].state;

    // Player-2 (BB) now faces a 900 raise. They have 900 left after posting 100 BB.
    // callAmount = 900 (currentBet) - 100 (their bet) = 800
    // minRaise = 800 (call) + 800 (lastRaiseSize) = 1600 but stack is only 900
    // RAISE should NOT be available (minRaise > stack)
    // ALL_IN should be available
    const p2Id = current.activePlayerId!;
    expect(p2Id).not.toBe(p1Id);

    const actions = getAvailableActions(current, p2Id);
    const types = actions.map(a => a.type);
    expect(types).toContain('ALL_IN');
    expect(types).toContain('FOLD');
    // CALL should be available since 800 <= 900
    expect(types).toContain('CALL');
    // RAISE should NOT be available (can't afford min raise)
    expect(types).not.toContain('RAISE');

    // Sending ALL_IN should succeed
    const error = validateAction(current, p2Id, 'ALL_IN');
    expect(error).toBeNull();
  });

  test('ALL_IN loses entire stack when player loses the hand', () => {
    let state = createInitialState({
      gameId: 'test-allin-lose',
      gameName: 'All-in Lose',
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

    // Rig deck so player-1 (BB seat 0) wins decisively.
    // Heads-up: dealer advances from 0 to seat 1 (player-2).
    // SB = dealer = player-2, BB = player-1.
    // Deal order after blinds: player-1 first, player-2 second.
    const riggedDeck = [
      'Ah', 'As',  // player-1 hole cards (aces)
      '7c', '2d',  // player-2 hole cards (junk)
      '8s', '9c', 'Td',  // flop — no help for player-2
      '4h',  // turn
      '3s',  // river
      ...createDeck().filter(c =>
        !['Ah', 'As', '7c', '2d', '8s', '9c', 'Td', '4h', '3s'].includes(c)
      ),
    ];

    const transitions = startHand(state, riggedDeck);
    let current = transitions[transitions.length - 1].state;

    // Both players go all-in
    const firstId = current.activePlayerId!;
    let actionTransitions = processAction(current, firstId, 'ALL_IN');
    current = actionTransitions[actionTransitions.length - 1].state;

    if (current.activePlayerId) {
      actionTransitions = processAction(current, current.activePlayerId, 'ALL_IN');
      current = actionTransitions[actionTransitions.length - 1].state;
    }

    expect(current.handInProgress).toBe(false);

    // Chips are conserved
    const final1 = current.players.find(p => p.id === 'player-1')!;
    const final2 = current.players.find(p => p.id === 'player-2')!;
    expect(final1.stack + final2.stack).toBe(2000);

    // player-1 (AA) should beat player-2 (72o) on this board
    expect(final1.stack).toBe(2000);
    expect(final2.stack).toBe(0);
  });

  test('RAISE is available alongside ALL_IN with correct min/max', () => {
    const state = createTestGame();
    const transitions = startHand(state);
    const dealState = transitions[transitions.length - 1].state;
    const activeId = dealState.activePlayerId!;

    const actions = getAvailableActions(dealState, activeId);
    const raise = actions.find(a => a.type === 'RAISE');
    const allIn = actions.find(a => a.type === 'ALL_IN');

    expect(raise).toBeDefined();
    expect(allIn).toBeDefined();

    // RAISE min should be call + last raise, max should be full stack
    // Pre-flop: call=10 (BB), lastRaiseSize=10 (BB), so min raise=20
    expect(raise!.min).toBe(20);
    expect(raise!.max).toBe(1000); // Full stack

    // ALL_IN amount should be the full stack
    expect(allIn!.amount).toBe(1000);

    // Both should be independently valid
    expect(validateAction(dealState, activeId, 'RAISE', 20)).toBeNull();
    expect(validateAction(dealState, activeId, 'ALL_IN')).toBeNull();
  });
});

describe('Action request targeting', () => {
  test('actionRequest is only sent to the active player', () => {
    const state = createTestGame();
    const transitions = startHand(state);
    const dealState = transitions[transitions.length - 1].state;
    const activeId = dealState.activePlayerId!;
    const otherIds = dealState.players
      .filter(p => p.id !== activeId && p.role === 'player')
      .map(p => p.id);

    // Active player should get actionRequest
    const activePayload = buildGameStatePayload(
      dealState, { type: 'DEAL' }, activeId, 30000
    );
    expect(activePayload.actionRequest).toBeDefined();
    expect(activePayload.actionRequest!.availableActions.length).toBeGreaterThan(0);

    // Other players should NOT get actionRequest
    for (const otherId of otherIds) {
      const otherPayload = buildGameStatePayload(
        dealState, { type: 'DEAL' }, otherId, 30000
      );
      expect(otherPayload.actionRequest).toBeUndefined();
    }
  });

  test('actionRequest is not sent when activePlayerId is null', () => {
    const state = createTestGame();
    const transitions = startHand(state);
    // HAND_START transition has activePlayerId = null
    const handStartState = transitions[0].state;
    expect(handStartState.activePlayerId).toBeNull();

    const payload = buildGameStatePayload(
      handStartState, { type: 'HAND_START', handNumber: 1, dealerSeatIndex: 0 },
      'player-1', 30000
    );
    expect(payload.actionRequest).toBeUndefined();
  });
});

describe('Post-flop betting', () => {
  test('BET is available post-flop when no one has bet', () => {
    const state = createTestGame();
    const transitions = startHand(state);
    let current = transitions[transitions.length - 1].state;

    // Play pre-flop: everyone calls/checks to get to flop
    while (current.stage === 'PRE_FLOP' && current.activePlayerId) {
      const activeId = current.activePlayerId;
      const actions = getAvailableActions(current, activeId);
      const canCheck = actions.some(a => a.type === 'CHECK');
      const actionType = canCheck ? 'CHECK' : 'CALL';
      const actionTransitions = processAction(current, activeId, actionType);
      current = actionTransitions[actionTransitions.length - 1].state;
    }

    // Should be on flop now
    expect(current.stage).toBe('FLOP');
    expect(current.activePlayerId).not.toBeNull();

    // First to act post-flop should have BET (not RAISE), since no bet exists
    const actions = getAvailableActions(current, current.activePlayerId!);
    const types = actions.map(a => a.type);
    expect(types).toContain('BET');
    expect(types).toContain('CHECK');
    expect(types).not.toContain('RAISE'); // No bet to raise above
    expect(types).not.toContain('CALL'); // Nothing to call
  });

  test('BET action is valid post-flop', () => {
    const state = createTestGame();
    const transitions = startHand(state);
    let current = transitions[transitions.length - 1].state;

    while (current.stage === 'PRE_FLOP' && current.activePlayerId) {
      const activeId = current.activePlayerId;
      const actions = getAvailableActions(current, activeId);
      const canCheck = actions.some(a => a.type === 'CHECK');
      const actionTransitions = processAction(current, activeId, canCheck ? 'CHECK' : 'CALL');
      current = actionTransitions[actionTransitions.length - 1].state;
    }

    expect(current.stage).toBe('FLOP');
    const activeId = current.activePlayerId!;
    const actions = getAvailableActions(current, activeId);
    const bet = actions.find(a => a.type === 'BET');
    expect(bet).toBeDefined();

    // BET with min amount should be valid
    const error = validateAction(current, activeId, 'BET', bet!.min);
    expect(error).toBeNull();

    // Sending RAISE instead of BET should be INVALID
    const raiseError = validateAction(current, activeId, 'RAISE', bet!.min);
    expect(raiseError).not.toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Spectator Card Visibility
// ═══════════════════════════════════════════════════════════════════════════════

describe('Spectator card visibility', () => {
  function createTestState(): EngineState {
    let state = createInitialState({
      gameId: 'test-spectator',
      gameName: 'Spectator Test',
      gameType: 'cash',
      maxPlayers: 6,
      smallBlindAmount: 10,
      bigBlindAmount: 20,
      startingStack: 1000,
    });
    const p1 = addPlayer(state, 'player1', 'Player 1');
    state = p1.state;
    const p2 = addPlayer(state, 'player2', 'Player 2');
    state = p2.state;
    const spec = addPlayer(state, 'spectator1', 'Spectator 1', 'spectator');
    state = spec.state;

    state = setPlayerReady(state, 'player1', true);
    state = setPlayerReady(state, 'player2', true);

    const transitions = startHand(state);
    return transitions[transitions.length - 1].state;
  }

  test('player sees their own hole cards', () => {
    const state = createTestState();
    const clientState = toClientGameState(state, 'player1');
    const player1 = clientState.players.find(p => p.id === 'player1');
    expect(player1?.holeCards).not.toBeNull();
    expect(player1?.holeCards).toHaveLength(2);
  });

  test('player does not see opponent hole cards during hand', () => {
    const state = createTestState();
    const clientState = toClientGameState(state, 'player1');
    const player2 = clientState.players.find(p => p.id === 'player2');
    expect(player2?.holeCards).toBeNull();
  });

  test('player sees opponent cards at showdown (show-all mode)', () => {
    let state = createTestState();
    // Fast-forward to showdown by folding all but one player, then having them check down
    // For simplicity, we'll just set the stage to SHOWDOWN
    state = { ...state, stage: 'SHOWDOWN', showdownVisibility: 'show-all' };

    const clientState = toClientGameState(state, 'player1');
    const player2 = clientState.players.find(p => p.id === 'player2');
    expect(player2?.holeCards).not.toBeNull();
  });

  test('spectator card visibility depends on config', () => {
    const state = createTestState();
    const clientState = toClientGameState(state, 'spectator1');
    const player1 = clientState.players.find(p => p.id === 'player1');
    const player2 = clientState.players.find(p => p.id === 'player2');

    const mode = config.SPECTATOR_CARD_VISIBILITY;

    if (mode === 'immediate') {
      // Spectators see all cards immediately
      expect(player1?.holeCards).not.toBeNull();
      expect(player2?.holeCards).not.toBeNull();
    } else if (mode === 'showdown') {
      // Spectators only see cards at showdown
      if (state.stage === 'SHOWDOWN' || !state.handInProgress) {
        expect(player1?.holeCards).not.toBeNull();
        expect(player2?.holeCards).not.toBeNull();
      } else {
        expect(player1?.holeCards).toBeNull();
        expect(player2?.holeCards).toBeNull();
      }
    } else if (mode === 'delayed') {
      // In delayed mode, toClientGameState shows current hand cards
      // GameManager is responsible for passing previous hand state
      expect(player1?.holeCards).not.toBeNull();
      expect(player2?.holeCards).not.toBeNull();
    }
  });

  test('spectator sees their own "cards" as null (spectators have no cards)', () => {
    const state = createTestState();
    const clientState = toClientGameState(state, 'spectator1');
    const spectator = clientState.players.find(p => p.id === 'spectator1');
    expect(spectator?.holeCards).toBeNull();
  });

  test('non-spectator player does not see spectator cards (spectators have none)', () => {
    const state = createTestState();
    const clientState = toClientGameState(state, 'player1');
    const spectator = clientState.players.find(p => p.id === 'spectator1');
    expect(spectator?.holeCards).toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Player ready / unready
// ═══════════════════════════════════════════════════════════════════════════════

describe('Player ready/unready', () => {
  const makeGameConfig = () => ({
    gameId: 'test-ready',
    gameName: 'Ready Test',
    gameType: 'cash' as const,
    smallBlindAmount: 5,
    bigBlindAmount: 10,
    maxPlayers: 6,
    startingStack: 1000,
  });

  test('setPlayerReady sets isReady to true', () => {
    let state = createInitialState(makeGameConfig());
    state = addPlayer(state, 'p1', 'Alice').state;

    expect(state.players[0].isReady).toBe(false);
    state = setPlayerReady(state, 'p1');
    expect(state.players[0].isReady).toBe(true);
  });

  test('setPlayerUnready sets isReady to false', () => {
    let state = createInitialState(makeGameConfig());
    state = addPlayer(state, 'p1', 'Alice').state;

    state = setPlayerReady(state, 'p1');
    expect(state.players[0].isReady).toBe(true);

    state = setPlayerUnready(state, 'p1');
    expect(state.players[0].isReady).toBe(false);
  });

  test('unready after all-ready makes allReady false', () => {
    let state = createInitialState(makeGameConfig());
    state = addPlayer(state, 'p1', 'Alice').state;
    state = addPlayer(state, 'p2', 'Bob').state;

    state = setPlayerReady(state, 'p1');
    state = setPlayerReady(state, 'p2');

    const players = state.players.filter((p) => p.role === 'player');
    expect(players.every((p) => p.isReady)).toBe(true);

    state = setPlayerUnready(state, 'p1');

    const playersAfter = state.players.filter((p) => p.role === 'player');
    expect(playersAfter.every((p) => p.isReady)).toBe(false);
  });

  test('setPlayerUnready is idempotent', () => {
    let state = createInitialState(makeGameConfig());
    state = addPlayer(state, 'p1', 'Alice').state;

    expect(state.players[0].isReady).toBe(false);
    state = setPlayerUnready(state, 'p1');
    expect(state.players[0].isReady).toBe(false);
  });

  test('only affects the targeted player', () => {
    let state = createInitialState(makeGameConfig());
    state = addPlayer(state, 'p1', 'Alice').state;
    state = addPlayer(state, 'p2', 'Bob').state;

    state = setPlayerReady(state, 'p1');
    state = setPlayerReady(state, 'p2');
    state = setPlayerUnready(state, 'p1');

    expect(state.players.find((p) => p.id === 'p1')!.isReady).toBe(false);
    expect(state.players.find((p) => p.id === 'p2')!.isReady).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Unready message schema
// ═══════════════════════════════════════════════════════════════════════════════

describe('Unready message schema', () => {
  test('unready message parses correctly', () => {
    const { ClientMessage } = require('@pokerathome/schema');
    const result = ClientMessage.safeParse({ action: 'unready', payload: {} });
    expect(result.success).toBe(true);
    expect(result.data.action).toBe('unready');
  });

  test('unready message rejects extra payload fields', () => {
    const { ClientMessage } = require('@pokerathome/schema');
    const result = ClientMessage.safeParse({ action: 'unready', payload: { foo: 'bar' } });
    expect(result.success).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Sole-eligible pot refund (uncontested all-in excess)
// ═══════════════════════════════════════════════════════════════════════════════

describe('Sole-eligible pot refund', () => {
  const playerNames = ['Alice', 'Bob', 'Charlie', 'Diana', 'Eve', 'Frank'];

  /**
   * Helper: create an N-player game with custom stacks, rig the deck, force
   * everyone all-in, and return the final state + all transitions.
   */
  function runAllIn(stacks: number[], riggedDeck: string[]) {
    const n = stacks.length;
    if (n < 2 || n > 6) throw new Error('Need 2-6 players');

    let state = createInitialState({
      gameId: 'test-sole-pot',
      gameName: 'Sole Pot Test',
      gameType: 'cash',
      smallBlindAmount: 5,
      bigBlindAmount: 10,
      maxPlayers: 6,
      startingStack: stacks[0],
    });

    for (let i = 0; i < n; i++) {
      const result = addPlayer(state, `player-${i + 1}`, playerNames[i]);
      state = result.state;
    }

    // Set custom stacks
    for (let i = 0; i < n; i++) {
      state.players[i].stack = stacks[i];
    }

    for (let i = 0; i < n; i++) {
      state = setPlayerReady(state, `player-${i + 1}`);
    }

    const allTransitions: Array<{ state: EngineState; event: any }> = [];
    const transitions = startHand(state, riggedDeck);
    allTransitions.push(...transitions);
    let current = transitions[transitions.length - 1].state;

    // Force all players all-in
    while (current.activePlayerId && current.handInProgress) {
      const actionTransitions = processAction(current, current.activePlayerId, 'ALL_IN');
      allTransitions.push(...actionTransitions);
      current = actionTransitions[actionTransitions.length - 1].state;
    }

    return { finalState: current, transitions: allTransitions };
  }

  // Backward-compat alias for existing 3-way tests
  function run3WayAllIn(stacks: [number, number, number], riggedDeck: string[]) {
    return runAllIn(stacks, riggedDeck);
  }

  function findHandEndEvent(transitions: Array<{ event: any }>) {
    return transitions.find((t) => t.event.type === 'HAND_END')?.event;
  }

  // Deck layout for 3 players (dealt in array order):
  //   [p1-hole1, p1-hole2, p2-hole1, p2-hole2, p3-hole1, p3-hole2, flop1, flop2, flop3, turn, river, ...]
  // Board is scattered (no shared straights/flushes) so hole cards determine winner.
  const usedCards = ['Ah', 'Ad', 'Kh', 'Kd', '4c', '5d', '3h', '7s', 'Jc', 'Qd', '2s'];
  const filler = createDeck().filter((c) => !usedCards.includes(c));

  test('3-way all-in: losing player with sole-eligible pot is NOT listed as winner', () => {
    // Alice (500): pair of aces (best), Bob (300): pair of kings, Charlie (200): high card
    // Alice has 200 excess over Bob → refunded, not a "win"
    const riggedDeck = [
      'Ah', 'Ad', // Alice — pair of aces
      'Kh', 'Kd', // Bob — pair of kings
      '4c', '5d', // Charlie — high card
      '3h', '7s', 'Jc', // flop (scattered, no straights/flushes)
      'Qd',              // turn
      '2s',              // river
      ...filler,
    ];

    const { finalState, transitions } = run3WayAllIn([500, 300, 200], riggedDeck);
    const handEnd = findHandEndEvent(transitions);

    // Only Alice should be listed as winner (main pot + side pot)
    // Her excess over Bob should be silently refunded
    const winnerIds = handEnd.winners.map((w: any) => w.playerId);
    expect(winnerIds).toContain('player-1'); // Alice wins contested pots
    expect(winnerIds).not.toContain('player-2'); // Bob lost
    expect(winnerIds).not.toContain('player-3'); // Charlie lost

    // Total chips conserved
    const totalStacks = finalState.players.reduce((sum: number, p: any) => sum + p.stack, 0);
    expect(totalStacks).toBe(1000);
  });

  test('all-in excess is refunded correctly when biggest stack loses', () => {
    // Alice (500): worst hand, Bob (300): middle, Charlie (200): best
    // Alice's excess should be silently refunded
    const riggedDeck = [
      '4c', '5d', // Alice — high card (worst)
      'Kh', 'Kd', // Bob — pair of kings (middle)
      'Ah', 'Ad', // Charlie — pair of aces (best)
      '3h', '7s', 'Jc',
      'Qd',
      '2s',
      ...filler,
    ];

    const { finalState, transitions } = run3WayAllIn([500, 300, 200], riggedDeck);
    const handEnd = findHandEndEvent(transitions);

    // Charlie wins main pot, Bob wins side pot, Alice gets refund (NOT a winner)
    const winnerIds = handEnd.winners.map((w: any) => w.playerId);
    expect(winnerIds).not.toContain('player-1'); // Alice NOT a winner
    expect(winnerIds).toContain('player-2'); // Bob wins side pot
    expect(winnerIds).toContain('player-3'); // Charlie wins main pot

    const alice = finalState.players.find((p: any) => p.id === 'player-1')!;
    const bob = finalState.players.find((p: any) => p.id === 'player-2')!;
    const charlie = finalState.players.find((p: any) => p.id === 'player-3')!;

    // Alice's only chips are the silently refunded excess
    expect(alice.stack).toBeGreaterThan(0);
    expect(alice.stack).toBeLessThan(500); // Lost most of her stack
    // Total chips conserved
    expect(alice.stack + bob.stack + charlie.stack).toBe(1000);
  });

  test('no sole-eligible pot when all stacks are equal', () => {
    const riggedDeck = [
      'Ah', 'Ad', // Alice — pair of aces (wins)
      'Kh', 'Kd', // Bob
      '4c', '5d', // Charlie
      '3h', '7s', 'Jc',
      'Qd',
      '2s',
      ...filler,
    ];

    const { finalState, transitions } = run3WayAllIn([1000, 1000, 1000], riggedDeck);
    const handEnd = findHandEndEvent(transitions);

    // Single winner, single pot — no sole-eligible pots
    expect(handEnd.winners).toHaveLength(1);
    expect(handEnd.winners[0].playerId).toBe('player-1');
    expect(handEnd.winners[0].amount).toBe(3000);

    const alice = finalState.players.find((p: any) => p.id === 'player-1')!;
    expect(alice.stack).toBe(3000);
  });

  test('2-way all-in: bigger stack excess is refunded, not won', () => {
    let state = createInitialState({
      gameId: 'test-sole-2way',
      gameName: '2-Way Sole Pot',
      gameType: 'cash',
      smallBlindAmount: 5,
      bigBlindAmount: 10,
      maxPlayers: 6,
      startingStack: 800,
    });

    const p1 = addPlayer(state, 'player-1', 'Alice');
    state = p1.state;
    const p2 = addPlayer(state, 'player-2', 'Bob');
    state = p2.state;

    state.players[0].stack = 800;
    state.players[1].stack = 400;

    state = setPlayerReady(state, 'player-1');
    state = setPlayerReady(state, 'player-2');

    const riggedDeck = [
      'Ah', 'Ad', // Alice — pair of aces (wins)
      '4c', '5d', // Bob — high card
      '3h', '7s', 'Jc',
      'Qd',
      '2s',
      ...filler,
    ];

    const allTransitions: Array<{ state: EngineState; event: any }> = [];
    const transitions = startHand(state, riggedDeck);
    allTransitions.push(...transitions);
    let current = transitions[transitions.length - 1].state;

    while (current.activePlayerId && current.handInProgress) {
      const actionTransitions = processAction(current, current.activePlayerId, 'ALL_IN');
      allTransitions.push(...actionTransitions);
      current = actionTransitions[actionTransitions.length - 1].state;
    }

    const handEnd = findHandEndEvent(allTransitions);

    // Alice wins the contested pot only; excess is refunded silently
    expect(handEnd.winners).toHaveLength(1);
    expect(handEnd.winners[0].playerId).toBe('player-1');

    // Alice ends with all chips (she won the contested pot + got refund)
    const alice = current.players.find((p: any) => p.id === 'player-1')!;
    const bob = current.players.find((p: any) => p.id === 'player-2')!;
    expect(alice.stack).toBe(1200);
    expect(bob.stack).toBe(0);
  });

  test('4-way all-in with different stacks: sole-eligible pots are refunded', () => {
    // Stacks: Alice 800, Bob 600, Charlie 400, Diana 200
    // Hands (dealt in array order): Alice=AA, Bob=KK, Charlie=QQ, Diana=high card
    // Board: scattered, no shared hands
    const cards4 = ['Ah', 'Ad', 'Kh', 'Kd', 'Qh', 'Qd', '4c', '5d', '3h', '7s', 'Jc', '9s', '2s'];
    const filler4 = createDeck().filter((c) => !cards4.includes(c));
    const riggedDeck = [
      'Ah', 'Ad', // p1 Alice — aces (best)
      'Kh', 'Kd', // p2 Bob — kings
      'Qh', 'Qd', // p3 Charlie — queens
      '4c', '5d', // p4 Diana — high card (worst)
      '3h', '7s', 'Jc', // flop
      '9s',              // turn
      '2s',              // river
      ...filler4,
    ];

    const { finalState, transitions } = runAllIn([800, 600, 400, 200], riggedDeck);
    const handEnd = findHandEndEvent(transitions);

    // Alice wins all contested pots. Her 200 excess over Bob is refunded silently.
    // Pots: main (200*4=800), side1 (200*3=600), side2 (200*2=400), sole (200*1=200 refund)
    const winnerIds = handEnd.winners.map((w: any) => w.playerId);
    expect(winnerIds).toContain('player-1'); // Alice wins contested pots
    expect(winnerIds).not.toContain('player-2'); // Bob lost
    expect(winnerIds).not.toContain('player-3'); // Charlie lost
    expect(winnerIds).not.toContain('player-4'); // Diana lost

    // No sole-eligible pot in winners
    for (const w of handEnd.winners) {
      // Every winner entry should have eligiblePlayerIds > 1 (contested)
      expect(w.amount).toBeGreaterThan(0);
    }

    // Chips conserved
    const totalStacks = finalState.players.reduce((sum: number, p: any) => sum + p.stack, 0);
    expect(totalStacks).toBe(2000); // 800+600+400+200

    // Alice should have all chips
    const alice = finalState.players.find((p: any) => p.id === 'player-1')!;
    expect(alice.stack).toBe(2000);
  });

  test('4-way all-in: middle player with biggest stack loses, excess refunded', () => {
    // Alice 200, Bob 800 (biggest, worst hand), Charlie 400, Diana 600
    // Bob has high card (worst), Diana has aces (best)
    const cards4 = ['Ah', 'Ad', 'Kh', 'Kd', 'Qh', 'Qd', '4c', '5d', '3h', '7s', 'Jc', '9s', '2s'];
    const filler4 = createDeck().filter((c) => !cards4.includes(c));
    const riggedDeck = [
      'Qh', 'Qd', // p1 Alice (200) — queens
      '4c', '5d', // p2 Bob (800) — high card (worst)
      'Kh', 'Kd', // p3 Charlie (400) — kings
      'Ah', 'Ad', // p4 Diana (600) — aces (best)
      '3h', '7s', 'Jc',
      '9s',
      '2s',
      ...filler4,
    ];

    const { finalState, transitions } = runAllIn([200, 800, 400, 600], riggedDeck);
    const handEnd = findHandEndEvent(transitions);

    // Bob (biggest stack, worst hand) should NOT be in winners — his excess is refunded
    const winnerIds = handEnd.winners.map((w: any) => w.playerId);
    expect(winnerIds).not.toContain('player-2'); // Bob NOT a winner

    // Diana wins main pot (best hand), Charlie wins next side pot, Alice wins nothing
    expect(winnerIds).toContain('player-4'); // Diana wins

    // Chips conserved
    const totalStacks = finalState.players.reduce((sum: number, p: any) => sum + p.stack, 0);
    expect(totalStacks).toBe(2000);

    // Bob should only have his refunded excess (800 - 600 = 200)
    const bob = finalState.players.find((p: any) => p.id === 'player-2')!;
    expect(bob.stack).toBe(200);
  });

  test('6-way all-in with all different stacks: sole-eligible pot refunded', () => {
    // 6 players, all different stacks, all go all-in
    // Stacks: 1000, 800, 600, 400, 300, 100
    // Hands: p1=AA, p2=KK, p3=QQ, p4=JJ, p5=TT, p6=high card
    const cards6 = [
      'Ah', 'Ad', 'Kh', 'Kd', 'Qh', 'Qd', 'Jh', 'Jd', 'Th', 'Td',
      '4c', '5d', '3s', '7s', '9c', '8s', '2s',
    ];
    const filler6 = createDeck().filter((c) => !cards6.includes(c));
    const riggedDeck = [
      'Ah', 'Ad', // p1 (1000) — aces
      'Kh', 'Kd', // p2 (800) — kings
      'Qh', 'Qd', // p3 (600) — queens
      'Jh', 'Jd', // p4 (400) — jacks
      'Th', 'Td', // p5 (300) — tens
      '4c', '5d', // p6 (100) — high card
      '3s', '7s', '9c', // flop (scattered)
      '8s',             // turn
      '2s',             // river
      ...filler6,
    ];

    const { finalState, transitions } = runAllIn([1000, 800, 600, 400, 300, 100], riggedDeck);
    const handEnd = findHandEndEvent(transitions);

    // Alice (p1) has best hand and biggest stack.
    // Her 200 excess over Bob (1000-800) is a sole-eligible pot → refunded.
    // She wins all contested pots (main + 4 side pots).
    const winnerIds = handEnd.winners.map((w: any) => w.playerId);
    expect(winnerIds).toContain('player-1');
    // No other player should be a winner
    const uniqueWinners = [...new Set(winnerIds)];
    expect(uniqueWinners).toEqual(['player-1']);

    // Chips conserved: 1000+800+600+400+300+100 = 3200
    const totalStacks = finalState.players.reduce((sum: number, p: any) => sum + p.stack, 0);
    expect(totalStacks).toBe(3200);

    // Alice gets everything
    const alice = finalState.players.find((p: any) => p.id === 'player-1')!;
    expect(alice.stack).toBe(3200);
  });

  test('6-way all-in: biggest stack has worst hand, multiple side pot winners', () => {
    // p1 (1000) worst hand, p6 (100) best hand — maximum side pot chaos
    // Each player wins the main pot they're eligible for, p1's excess refunded
    const cards6 = [
      'Ah', 'Ad', 'Kh', 'Kd', 'Qh', 'Qd', 'Jh', 'Jd', 'Th', 'Td',
      '4c', '5d', '3s', '7s', '9c', '8s', '2s',
    ];
    const filler6 = createDeck().filter((c) => !cards6.includes(c));
    const riggedDeck = [
      '4c', '5d', // p1 (1000) — high card (worst)
      'Th', 'Td', // p2 (800) — tens
      'Jh', 'Jd', // p3 (600) — jacks
      'Qh', 'Qd', // p4 (400) — queens
      'Kh', 'Kd', // p5 (300) — kings
      'Ah', 'Ad', // p6 (100) — aces (best)
      '3s', '7s', '9c',
      '8s',
      '2s',
      ...filler6,
    ];

    const { finalState, transitions } = runAllIn([1000, 800, 600, 400, 300, 100], riggedDeck);
    const handEnd = findHandEndEvent(transitions);

    // p1 has the worst hand and biggest stack — should NOT be a winner
    const winnerIds = handEnd.winners.map((w: any) => w.playerId);
    expect(winnerIds).not.toContain('player-1'); // Worst hand, excess refunded

    // p6 (aces) wins main pot (all 6 eligible)
    expect(winnerIds).toContain('player-6');
    // p5 (kings) wins next side pot (p1-p5 eligible, p5 has best hand among them)
    expect(winnerIds).toContain('player-5');
    // p4 (queens) wins next side pot (p1-p4 eligible)
    expect(winnerIds).toContain('player-4');
    // p3 (jacks) wins next (p1-p3 eligible)
    expect(winnerIds).toContain('player-3');
    // p2 (tens) wins next (p1-p2 eligible)
    expect(winnerIds).toContain('player-2');

    // p1 should only have refunded excess (1000 - 800 = 200)
    const p1 = finalState.players.find((p: any) => p.id === 'player-1')!;
    expect(p1.stack).toBe(200);

    // Chips conserved
    const totalStacks = finalState.players.reduce((sum: number, p: any) => sum + p.stack, 0);
    expect(totalStacks).toBe(3200);
  });
});
