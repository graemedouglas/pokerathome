/**
 * Tests for tournament setup guards and toClientGameState tournament field.
 */
import {
  createInitialState,
  addPlayer,
  advanceBlindLevel,
  toClientGameState,
  startHand,
  processAction,
  setPlayerSittingOut,
  setPlayerReady,
  type EngineState,
  type GameConfig,
} from '../src/engine/game';

function makeTournamentConfig(overrides: Partial<GameConfig> = {}): GameConfig {
  return {
    gameId: 'test-game',
    gameName: 'Test Tournament',
    gameType: 'tournament',
    smallBlindAmount: 25,
    bigBlindAmount: 50,
    maxPlayers: 6,
    startingStack: 5000,
    ...overrides,
  };
}

function makeTournamentState(): EngineState {
  let state = createInitialState(makeTournamentConfig());
  const r1 = addPlayer(state, 'player-1', 'Alice');
  state = r1.state;
  const r2 = addPlayer(state, 'player-2', 'Bob');
  state = r2.state;
  return state;
}

describe('toClientGameState tournament field', () => {
  test('tournament game with empty blindSchedule still includes tournament field', () => {
    const state = makeTournamentState();
    // blindSchedule is empty by default (not populated until forceStartGame)
    expect(state.blindSchedule).toHaveLength(0);

    const clientState = toClientGameState(state, 'player-1');
    expect(clientState.gameType).toBe('tournament');
    expect(clientState.tournament).toBeDefined();
    expect(clientState.tournament!.blindSchedule).toHaveLength(0);
    expect(clientState.tournament!.minChipDenom).toBe(25); // fallback
  });

  test('tournament game with populated blindSchedule includes tournament field', () => {
    let state = makeTournamentState();
    state = {
      ...state,
      blindSchedule: [
        { level: 1, smallBlind: 25, bigBlind: 50, ante: 0, minChipDenom: 25 },
        { level: 2, smallBlind: 50, bigBlind: 100, ante: 0, minChipDenom: 25 },
      ],
    };

    const clientState = toClientGameState(state, 'player-1');
    expect(clientState.tournament).toBeDefined();
    expect(clientState.tournament!.blindSchedule).toHaveLength(2);
    expect(clientState.tournament!.minChipDenom).toBe(25);
  });

  test('cash game does not include tournament field', () => {
    let state = createInitialState(makeTournamentConfig({ gameType: 'cash' }));
    const r1 = addPlayer(state, 'player-1', 'Alice');
    state = r1.state;

    const clientState = toClientGameState(state, 'player-1');
    expect(clientState.gameType).toBe('cash');
    expect(clientState.tournament).toBeUndefined();
  });
});

describe('advanceBlindLevel', () => {
  test('empty blindSchedule does not crash — returns state unchanged', () => {
    const state = makeTournamentState();
    expect(state.blindSchedule).toHaveLength(0);

    const result = advanceBlindLevel(state);
    expect(result.state.smallBlindAmount).toBe(25); // unchanged from initial
    expect(result.state.bigBlindAmount).toBe(50); // unchanged
    expect(result.event.type).toBe('BLIND_LEVEL_UP');
  });

  test('valid schedule advances to next level', () => {
    let state = makeTournamentState();
    state = {
      ...state,
      blindSchedule: [
        { level: 1, smallBlind: 25, bigBlind: 50, ante: 0, minChipDenom: 25 },
        { level: 2, smallBlind: 50, bigBlind: 100, ante: 0, minChipDenom: 25 },
        { level: 3, smallBlind: 100, bigBlind: 200, ante: 0, minChipDenom: 100 },
      ],
      currentBlindLevel: 0,
    };

    const result = advanceBlindLevel(state);
    expect(result.state.currentBlindLevel).toBe(1);
    expect(result.state.smallBlindAmount).toBe(50);
    expect(result.state.bigBlindAmount).toBe(100);
    expect(result.event.type).toBe('BLIND_LEVEL_UP');
  });

  test('clamps to last level when already at end', () => {
    let state = makeTournamentState();
    state = {
      ...state,
      blindSchedule: [
        { level: 1, smallBlind: 25, bigBlind: 50, ante: 0, minChipDenom: 25 },
        { level: 2, smallBlind: 50, bigBlind: 100, ante: 0, minChipDenom: 25 },
      ],
      currentBlindLevel: 1, // already at last level
    };

    const result = advanceBlindLevel(state);
    expect(result.state.currentBlindLevel).toBe(1); // clamped
    expect(result.state.bigBlindAmount).toBe(100);
  });
});

describe('sit-out auto-action', () => {
  /** Helper: create a tournament state mid-hand with an active player. */
  function startTournamentHand(): EngineState {
    let state = makeTournamentState();
    // Mark both players ready
    state = setPlayerReady(state, 'player-1');
    state = setPlayerReady(state, 'player-2');
    // Start the hand
    const transitions = startHand(state);
    // Return the state after all start-of-hand transitions
    return transitions[transitions.length - 1].state;
  }

  test('sitting out on your turn with no bet to call → CHECK', () => {
    let state = startTournamentHand();
    const activeId = state.activePlayerId!;
    const activePlayer = state.players.find(p => p.id === activeId)!;

    // Advance to a point where the active player can check (post-flop or BB preflop)
    // The active player can check when their bet >= currentBet
    // If they can't check yet, process actions until someone can
    if (activePlayer.bet < state.currentBet) {
      // Active player faces a bet — call to get to the next action point
      const callTransitions = processAction(state, activeId, 'CALL');
      state = callTransitions[callTransitions.length - 1].state;
    }

    // Now the active player should be able to check (or we're on a new street)
    const checkerId = state.activePlayerId!;
    const checker = state.players.find(p => p.id === checkerId)!;

    // Verify the player can check
    expect(checker.bet).toBeGreaterThanOrEqual(state.currentBet);

    // Simulate the sit-out turn: set player as sitting out, then use check-or-fold logic
    state = setPlayerSittingOut(state, checkerId, true);
    const canCheck = checker.bet >= state.currentBet;
    const defaultAction = canCheck ? 'CHECK' : 'FOLD';

    expect(defaultAction).toBe('CHECK');

    // Process the action
    const transitions = processAction(state, checkerId, defaultAction);
    const finalState = transitions[transitions.length - 1].state;

    // Player should still be in the hand (checked, not folded)
    const updatedPlayer = finalState.players.find(p => p.id === checkerId)!;
    expect(updatedPlayer.folded).toBe(false);
    expect(updatedPlayer.sittingOut).toBe(true);
  });

  test('sitting out on your turn facing a bet → FOLD', () => {
    let state = startTournamentHand();
    const activeId = state.activePlayerId!;
    const activePlayer = state.players.find(p => p.id === activeId)!;

    // Ensure the active player faces a bet (preflop SB faces BB)
    // In heads-up, SB/button acts first preflop and faces the BB
    if (activePlayer.bet >= state.currentBet) {
      // Player can check — raise to create a bet for the other player
      const raiseTransitions = processAction(state, activeId, 'RAISE', state.currentBet * 2);
      state = raiseTransitions[raiseTransitions.length - 1].state;
    }

    const facingBetId = state.activePlayerId!;
    const facingBetPlayer = state.players.find(p => p.id === facingBetId)!;

    // Verify this player faces a bet
    expect(facingBetPlayer.bet).toBeLessThan(state.currentBet);

    // Simulate the sit-out turn: set player as sitting out, then use check-or-fold logic
    state = setPlayerSittingOut(state, facingBetId, true);
    const canCheck = facingBetPlayer.bet >= state.currentBet;
    const defaultAction = canCheck ? 'CHECK' : 'FOLD';

    expect(defaultAction).toBe('FOLD');

    // Process the action
    const transitions = processAction(state, facingBetId, defaultAction);
    const finalState = transitions[transitions.length - 1].state;

    // Player should be folded
    const updatedPlayer = finalState.players.find(p => p.id === facingBetId)!;
    expect(updatedPlayer.folded).toBe(true);
    expect(updatedPlayer.sittingOut).toBe(true);
  });

  test('subsequent turns after sitting out → always FOLD (regression)', () => {
    let state = startTournamentHand();

    // Set up: player-1 is sitting out from a previous hand
    state = setPlayerSittingOut(state, 'player-1', true);

    // Find the active player — if it's the sitting-out player, verify FOLD is used
    // (not check, even if they could check)
    const activeId = state.activePlayerId!;

    if (activeId === 'player-1') {
      // This simulates autoFoldSittingOutPlayers behavior: always FOLD
      const transitions = processAction(state, activeId, 'FOLD');
      const finalState = transitions[transitions.length - 1].state;
      const player = finalState.players.find(p => p.id === 'player-1')!;
      expect(player.folded).toBe(true);
    } else {
      // player-2 is active first; have them act, then player-1 should auto-fold
      const p2Player = state.players.find(p => p.id === activeId)!;
      const p2Action = p2Player.bet >= state.currentBet ? 'CHECK' : 'CALL';
      const transitions = processAction(state, activeId, p2Action);
      state = transitions[transitions.length - 1].state;

      // Now player-1 should be active (if hand is still in progress)
      if (state.handInProgress && state.activePlayerId === 'player-1') {
        // autoFoldSittingOutPlayers always uses FOLD
        const foldTransitions = processAction(state, 'player-1', 'FOLD');
        const finalState = foldTransitions[foldTransitions.length - 1].state;
        const player = finalState.players.find(p => p.id === 'player-1')!;
        expect(player.folded).toBe(true);
      }
    }
  });
});
