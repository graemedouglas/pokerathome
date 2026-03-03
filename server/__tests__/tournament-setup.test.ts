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

  test('sitting-out player checks when possible, folds when facing a bet', () => {
    let state = startTournamentHand();

    // Set up: player-1 is sitting out
    state = setPlayerSittingOut(state, 'player-1', true);

    const activeId = state.activePlayerId!;

    if (activeId === 'player-1') {
      // player-1 is active — check-or-fold based on bet
      const canCheck = state.players.find(p => p.id === activeId)!.bet >= state.currentBet;
      const action = canCheck ? 'CHECK' : 'FOLD';
      const transitions = processAction(state, activeId, action);
      const finalState = transitions[transitions.length - 1].state;
      const player = finalState.players.find(p => p.id === 'player-1')!;
      if (canCheck) {
        expect(player.folded).toBe(false); // checked, still in hand
      } else {
        expect(player.folded).toBe(true); // folded because facing bet
      }
    } else {
      // player-2 is active first; have them act, then player-1 should check-or-fold
      const p2Player = state.players.find(p => p.id === activeId)!;
      const p2Action = p2Player.bet >= state.currentBet ? 'CHECK' : 'CALL';
      const transitions = processAction(state, activeId, p2Action);
      state = transitions[transitions.length - 1].state;

      // Now player-1 should be active (if hand is still in progress)
      if (state.handInProgress && state.activePlayerId === 'player-1') {
        const p1 = state.players.find(p => p.id === 'player-1')!;
        const canCheck = p1.bet >= state.currentBet;
        const action = canCheck ? 'CHECK' : 'FOLD';
        const foldTransitions = processAction(state, 'player-1', action);
        const finalState = foldTransitions[foldTransitions.length - 1].state;
        const player = finalState.players.find(p => p.id === 'player-1')!;
        if (canCheck) {
          expect(player.folded).toBe(false);
        } else {
          expect(player.folded).toBe(true);
        }
      }
    }
  });

  test('player returning from sit-out is marked active for next hand', () => {
    let state = startTournamentHand();

    // Sit out player-1
    state = setPlayerSittingOut(state, 'player-1', true);
    expect(state.players.find(p => p.id === 'player-1')!.sittingOut).toBe(true);

    // Player returns — should be marked as no longer sitting out
    state = setPlayerSittingOut(state, 'player-1', false);
    expect(state.players.find(p => p.id === 'player-1')!.sittingOut).toBe(false);
  });

  test('player returning mid-hand as active player can still act (race condition regression)', () => {
    // Regression: if autoFoldSittingOutPlayers is scheduled via setTimeout(0)
    // but the player clicks "I'm Back" before it fires, the player should
    // remain the active player with sittingOut=false and be able to act.
    let state = startTournamentHand();

    // Sit out player-1
    state = setPlayerSittingOut(state, 'player-1', true);

    // If player-1 is active, simulate the race: they return before auto-fold
    if (state.activePlayerId === 'player-1') {
      state = setPlayerSittingOut(state, 'player-1', false);
      const p1 = state.players.find(p => p.id === 'player-1')!;
      expect(p1.sittingOut).toBe(false);
      expect(state.activePlayerId).toBe('player-1');
      expect(p1.folded).toBe(false);

      // Player should be able to take an action
      const canCheck = p1.bet >= state.currentBet;
      const action = canCheck ? 'CHECK' : 'CALL';
      const transitions = processAction(state, 'player-1', action);
      expect(transitions.length).toBeGreaterThan(0);
    } else {
      // player-2 acts first; process their action to get player-1 as active
      const p2 = state.players.find(p => p.id === state.activePlayerId!)!;
      const p2Action = p2.bet >= state.currentBet ? 'CHECK' : 'CALL';
      const transitions = processAction(state, state.activePlayerId!, p2Action);
      state = transitions[transitions.length - 1].state;

      if (state.handInProgress && state.activePlayerId === 'player-1') {
        // Player returns before auto-fold
        state = setPlayerSittingOut(state, 'player-1', false);
        expect(state.players.find(p => p.id === 'player-1')!.sittingOut).toBe(false);
        expect(state.activePlayerId).toBe('player-1');

        // Player should be able to act
        const p1 = state.players.find(p => p.id === 'player-1')!;
        const canCheck = p1.bet >= state.currentBet;
        const action = canCheck ? 'CHECK' : 'CALL';
        const t2 = processAction(state, 'player-1', action);
        expect(t2.length).toBeGreaterThan(0);
      }
    }
  });

  test('player who returned mid-hand is dealt into next hand with sittingOut=false', () => {
    // Regression: sittingOut=false must survive through startHand into the next hand.
    let state = startTournamentHand();

    // Sit out, then return mid-hand
    state = setPlayerSittingOut(state, 'player-1', true);
    state = setPlayerSittingOut(state, 'player-1', false);

    // Play out the hand to completion
    let safety = 20;
    while (state.handInProgress && safety-- > 0) {
      const activeId = state.activePlayerId!;
      const active = state.players.find(p => p.id === activeId)!;
      const canCheck = active.bet >= state.currentBet;
      const action = canCheck ? 'CHECK' : 'CALL';
      const transitions = processAction(state, activeId, action);
      state = transitions[transitions.length - 1].state;
    }
    expect(state.handInProgress).toBe(false);

    // Start next hand — player-1 should be dealt in (not folded)
    const nextTransitions = startHand(state);
    const nextState = nextTransitions[nextTransitions.length - 1].state;
    const p1 = nextState.players.find(p => p.id === 'player-1')!;
    expect(p1.sittingOut).toBe(false);
    expect(p1.folded).toBe(false);
    expect(p1.holeCards).not.toBeNull();
  });

  test('tournament: sitting-out player is dealt in but auto-checked/folded', () => {
    // In tournaments, sitting-out players ARE dealt cards and pay blinds,
    // but auto-check when they can, or auto-fold when facing a bet.
    let state = makeTournamentState();
    state = setPlayerReady(state, 'player-1');
    state = setPlayerReady(state, 'player-2');

    // Sit out player-1 BEFORE the hand starts
    state = setPlayerSittingOut(state, 'player-1', true);

    const transitions = startHand(state);
    state = transitions[transitions.length - 1].state;
    expect(state.handInProgress).toBe(true);

    // Tournament: sitting-out player should NOT be folded at hand start
    const p1 = state.players.find(p => p.id === 'player-1')!;
    expect(p1.folded).toBe(false);
    expect(p1.sittingOut).toBe(true);
    expect(p1.holeCards).not.toBeNull(); // dealt in

    // Auto-act for player-1 whenever they're active
    let safety = 20;
    while (state.handInProgress && safety-- > 0) {
      const activeId = state.activePlayerId!;
      const active = state.players.find(p => p.id === activeId)!;
      if (active.sittingOut) {
        const canCheck = active.bet >= state.currentBet;
        const action = canCheck ? 'CHECK' : 'FOLD';
        const t = processAction(state, activeId, action);
        state = t[t.length - 1].state;
      } else {
        // Other player acts normally
        const canCheck = active.bet >= state.currentBet;
        const action = canCheck ? 'CHECK' : 'CALL';
        const t = processAction(state, activeId, action);
        state = t[t.length - 1].state;
      }
    }
    // Hand should complete without errors
    expect(state.handInProgress).toBe(false);
  });

  test('tournament: player who returns between hands plays normally', () => {
    // Sit out during hand N, return between hands, verify dealt into hand N+1 normally.
    let state = makeTournamentState();
    state = setPlayerReady(state, 'player-1');
    state = setPlayerReady(state, 'player-2');

    // Start hand 1
    let transitions = startHand(state);
    state = transitions[transitions.length - 1].state;

    // Player-1 sits out mid-hand
    state = setPlayerSittingOut(state, 'player-1', true);

    // Play out hand 1 to completion
    let safety = 20;
    while (state.handInProgress && safety-- > 0) {
      const activeId = state.activePlayerId!;
      const active = state.players.find(p => p.id === activeId)!;
      if (active.sittingOut) {
        const canCheck = active.bet >= state.currentBet;
        const action = canCheck ? 'CHECK' : 'FOLD';
        const t = processAction(state, activeId, action);
        state = t[t.length - 1].state;
      } else {
        const canCheck = active.bet >= state.currentBet;
        const action = canCheck ? 'CHECK' : 'CALL';
        const t = processAction(state, activeId, action);
        state = t[t.length - 1].state;
      }
    }
    expect(state.handInProgress).toBe(false);

    // Player-1 returns between hands
    state = setPlayerSittingOut(state, 'player-1', false);
    expect(state.players.find(p => p.id === 'player-1')!.sittingOut).toBe(false);

    // Start hand 2 — player-1 should be dealt in normally
    transitions = startHand(state);
    state = transitions[transitions.length - 1].state;
    const p1 = state.players.find(p => p.id === 'player-1')!;
    expect(p1.sittingOut).toBe(false);
    expect(p1.folded).toBe(false);
    expect(p1.holeCards).not.toBeNull();
  });

  test('tournament: player who returns mid-hand can act on their next turn', () => {
    // Sit out, get auto-checked (not folded), return, verify can act on next turn.
    let state = makeTournamentState();
    state = setPlayerReady(state, 'player-1');
    state = setPlayerReady(state, 'player-2');

    const transitions = startHand(state);
    state = transitions[transitions.length - 1].state;

    // Player-1 sits out
    state = setPlayerSittingOut(state, 'player-1', true);

    // Auto-check for player-1 if they're active and can check
    let autoActed = false;
    let safety = 10;
    while (state.handInProgress && state.activePlayerId && safety-- > 0) {
      const activeId = state.activePlayerId;
      const active = state.players.find(p => p.id === activeId)!;

      if (active.sittingOut) {
        const canCheck = active.bet >= state.currentBet;
        if (canCheck) {
          // Auto-check — player stays in the hand
          const t = processAction(state, activeId, 'CHECK');
          state = t[t.length - 1].state;
          autoActed = true;

          // Now return from sit-out
          state = setPlayerSittingOut(state, 'player-1', false);
          const p1 = state.players.find(p => p.id === 'player-1')!;
          expect(p1.sittingOut).toBe(false);
          expect(p1.folded).toBe(false); // auto-checked, not folded
        } else {
          // Facing a bet — auto-fold
          const t = processAction(state, activeId, 'FOLD');
          state = t[t.length - 1].state;
          autoActed = true;
          break; // player is folded, can't test returning
        }
      } else {
        // Non-sitting-out player acts
        const canCheck = active.bet >= state.currentBet;
        const action = canCheck ? 'CHECK' : 'CALL';
        const t = processAction(state, activeId, action);
        state = t[t.length - 1].state;

        // If player-1 becomes active again after returning, verify they can act
        if (state.handInProgress && state.activePlayerId === 'player-1') {
          const p1 = state.players.find(p => p.id === 'player-1')!;
          if (!p1.sittingOut && !p1.folded) {
            const p1CanCheck = p1.bet >= state.currentBet;
            const p1Action = p1CanCheck ? 'CHECK' : 'CALL';
            const p1t = processAction(state, 'player-1', p1Action);
            expect(p1t.length).toBeGreaterThan(0);
            break;
          }
        }
      }
    }

    expect(autoActed).toBe(true);
  });

  test('tournament: sitting out while active triggers immediate auto-action', () => {
    // When a player sits out while they ARE the active player in a tournament,
    // the engine should allow auto-check/fold. This test verifies the engine state
    // supports this (the setTimeout scheduling is in game-manager, not the engine).
    let state = makeTournamentState();
    state = setPlayerReady(state, 'player-1');
    state = setPlayerReady(state, 'player-2');

    const transitions = startHand(state);
    state = transitions[transitions.length - 1].state;

    const activeId = state.activePlayerId!;

    // Sit out the active player
    state = setPlayerSittingOut(state, activeId, true);
    const active = state.players.find(p => p.id === activeId)!;
    expect(active.sittingOut).toBe(true);
    expect(active.folded).toBe(false); // not folded yet — waiting for auto-action
    expect(state.activePlayerId).toBe(activeId); // still the active player

    // Auto-action should work: check if possible, fold if facing a bet
    const canCheck = active.bet >= state.currentBet;
    const defaultAction = canCheck ? 'CHECK' : 'FOLD';
    const autoTransitions = processAction(state, activeId, defaultAction);
    expect(autoTransitions.length).toBeGreaterThan(0);

    const postActionState = autoTransitions[autoTransitions.length - 1].state;
    const postActive = postActionState.players.find(p => p.id === activeId)!;
    expect(postActive.sittingOut).toBe(true); // still sitting out
    if (canCheck) {
      expect(postActive.folded).toBe(false); // checked, still in hand
    } else {
      expect(postActive.folded).toBe(true); // folded because facing bet
    }
  });
});

describe('cash game sit-out', () => {
  function makeCashConfig(overrides: Partial<GameConfig> = {}): GameConfig {
    return {
      gameId: 'test-cash',
      gameName: 'Test Cash',
      gameType: 'cash',
      smallBlindAmount: 25,
      bigBlindAmount: 50,
      maxPlayers: 6,
      startingStack: 5000,
      ...overrides,
    };
  }

  function makeCashState(): EngineState {
    let state = createInitialState(makeCashConfig());
    state = addPlayer(state, 'player-1', 'Alice').state;
    state = addPlayer(state, 'player-2', 'Bob').state;
    return state;
  }

  function startCashHand(): EngineState {
    let state = makeCashState();
    state = setPlayerReady(state, 'player-1');
    state = setPlayerReady(state, 'player-2');
    const transitions = startHand(state);
    return transitions[transitions.length - 1].state;
  }

  test('sitting-out player is excluded from cash game hand (folded at start)', () => {
    let state = makeCashState();
    state = setPlayerReady(state, 'player-1');
    state = setPlayerReady(state, 'player-2');
    state = setPlayerSittingOut(state, 'player-1', true);

    // In cash games, sitting-out players need 3+ total players to start a hand
    // (sitting-out players are excluded from active count)
    // With only 2 players and 1 sitting out, startHand would throw.
    // Add a third player so the hand can start.
    state = addPlayer(state, 'player-3', 'Charlie').state;
    state = setPlayerReady(state, 'player-3');

    const transitions = startHand(state);
    const handState = transitions[transitions.length - 1].state;

    // player-1 should be folded (excluded from the hand)
    const p1 = handState.players.find(p => p.id === 'player-1')!;
    expect(p1.folded).toBe(true);
    expect(p1.sittingOut).toBe(true);
    expect(p1.holeCards).toBeNull();
  });

  test('cash game: sitting out mid-hand with no bet → CHECK', () => {
    let state = startCashHand();
    const activeId = state.activePlayerId!;
    const activePlayer = state.players.find(p => p.id === activeId)!;

    // Get to a point where the active player can check
    if (activePlayer.bet < state.currentBet) {
      const callTransitions = processAction(state, activeId, 'CALL');
      state = callTransitions[callTransitions.length - 1].state;
    }

    const checkerId = state.activePlayerId!;
    const checker = state.players.find(p => p.id === checkerId)!;
    expect(checker.bet).toBeGreaterThanOrEqual(state.currentBet);

    // Sit out — should check (same logic as tournament)
    state = setPlayerSittingOut(state, checkerId, true);
    const canCheck = checker.bet >= state.currentBet;
    expect(canCheck).toBe(true);

    const transitions = processAction(state, checkerId, 'CHECK');
    const finalState = transitions[transitions.length - 1].state;
    const updated = finalState.players.find(p => p.id === checkerId)!;
    expect(updated.folded).toBe(false);
    expect(updated.sittingOut).toBe(true);
  });

  test('cash game: sitting out mid-hand facing a bet → FOLD', () => {
    let state = startCashHand();
    const activeId = state.activePlayerId!;
    const activePlayer = state.players.find(p => p.id === activeId)!;

    // Ensure the active player faces a bet
    if (activePlayer.bet >= state.currentBet) {
      const raiseTransitions = processAction(state, activeId, 'RAISE', state.currentBet * 2);
      state = raiseTransitions[raiseTransitions.length - 1].state;
    }

    const facingBetId = state.activePlayerId!;
    const facingBetPlayer = state.players.find(p => p.id === facingBetId)!;
    expect(facingBetPlayer.bet).toBeLessThan(state.currentBet);

    // Sit out — should fold
    state = setPlayerSittingOut(state, facingBetId, true);
    const transitions = processAction(state, facingBetId, 'FOLD');
    const finalState = transitions[transitions.length - 1].state;
    const updated = finalState.players.find(p => p.id === facingBetId)!;
    expect(updated.folded).toBe(true);
    expect(updated.sittingOut).toBe(true);
  });

  test('cash game: startHand throws with <2 active (non-sitting-out) players', () => {
    // Regression: when one player sits out in a 2-player cash game,
    // startHand should throw — game-manager must catch this and pause.
    let state = makeCashState();
    state = setPlayerReady(state, 'player-1');
    state = setPlayerReady(state, 'player-2');
    state = setPlayerSittingOut(state, 'player-1', true);

    // Only 1 active player — startHand should throw
    expect(() => startHand(state)).toThrow('Not enough players to start a hand');
  });

  test('cash game: startHand throws when both players are sitting out', () => {
    // Regression: when both players sit out, startHand throws.
    // Game-manager must enter waitingForPlayers state instead of silently failing.
    let state = makeCashState();
    state = setPlayerReady(state, 'player-1');
    state = setPlayerReady(state, 'player-2');
    state = setPlayerSittingOut(state, 'player-1', true);
    state = setPlayerSittingOut(state, 'player-2', true);

    expect(() => startHand(state)).toThrow('Not enough players to start a hand');

    // Unsit both — startHand should succeed
    state = setPlayerSittingOut(state, 'player-1', false);
    state = setPlayerSittingOut(state, 'player-2', false);
    const transitions = startHand(state);
    expect(transitions.length).toBeGreaterThan(0);
    const handState = transitions[transitions.length - 1].state;
    expect(handState.handInProgress).toBe(true);
  });

  test('cash game: 3-player game continues when 1 player sits out', () => {
    // With 3 players, sitting out 1 leaves 2 active — hand should still start
    let state = createInitialState(makeCashConfig());
    state = addPlayer(state, 'player-1', 'Alice').state;
    state = addPlayer(state, 'player-2', 'Bob').state;
    state = addPlayer(state, 'player-3', 'Charlie').state;
    state = setPlayerReady(state, 'player-1');
    state = setPlayerReady(state, 'player-2');
    state = setPlayerReady(state, 'player-3');
    state = setPlayerSittingOut(state, 'player-1', true);

    const transitions = startHand(state);
    const handState = transitions[transitions.length - 1].state;
    expect(handState.handInProgress).toBe(true);

    // player-1 should be folded (excluded)
    const p1 = handState.players.find(p => p.id === 'player-1')!;
    expect(p1.folded).toBe(true);
    expect(p1.sittingOut).toBe(true);
    expect(p1.holeCards).toBeNull();

    // player-2 and player-3 should be active
    const p2 = handState.players.find(p => p.id === 'player-2')!;
    const p3 = handState.players.find(p => p.id === 'player-3')!;
    expect(p2.folded).toBe(false);
    expect(p3.folded).toBe(false);
  });

  test('player returning from sit-out mid-hand does not corrupt game state', () => {
    // Regression: when a player un-sits-out during an active hand,
    // the game state should remain consistent and the active player can still act.
    let state = createInitialState(makeCashConfig());
    state = addPlayer(state, 'player-1', 'Alice').state;
    state = addPlayer(state, 'player-2', 'Bob').state;
    state = addPlayer(state, 'player-3', 'Charlie').state;
    state = setPlayerReady(state, 'player-1');
    state = setPlayerReady(state, 'player-2');
    state = setPlayerReady(state, 'player-3');

    // Start hand, then sit out player-1 (they get auto-excluded next hand, but
    // mid-hand they're still folded/dealt in this hand)
    const transitions = startHand(state);
    state = transitions[transitions.length - 1].state;
    expect(state.handInProgress).toBe(true);

    // Sit out player-1 mid-hand
    state = setPlayerSittingOut(state, 'player-1', true);
    const p1 = state.players.find(p => p.id === 'player-1')!;
    expect(p1.sittingOut).toBe(true);

    // Player-1 returns mid-hand
    state = setPlayerSittingOut(state, 'player-1', false);
    const p1After = state.players.find(p => p.id === 'player-1')!;
    expect(p1After.sittingOut).toBe(false);

    // Game state should still be valid — active player can act
    expect(state.handInProgress).toBe(true);
    expect(state.activePlayerId).toBeTruthy();

    // The active player should be able to take an action without errors
    const activeId = state.activePlayerId!;
    const activePlayer = state.players.find(p => p.id === activeId)!;
    const canCheck = activePlayer.bet >= state.currentBet;
    const action = canCheck ? 'CHECK' : 'CALL';
    const actionTransitions = processAction(state, activeId, action);
    expect(actionTransitions.length).toBeGreaterThan(0);
  });

  test('cash game: player who returns mid-hand can act on their next turn', () => {
    // Regression: player sits out, is auto-checked (not folded), returns mid-hand,
    // and should get a normal turn when play comes back to them.
    let state = createInitialState(makeCashConfig());
    state = addPlayer(state, 'player-1', 'Alice').state;
    state = addPlayer(state, 'player-2', 'Bob').state;
    state = addPlayer(state, 'player-3', 'Charlie').state;
    state = setPlayerReady(state, 'player-1');
    state = setPlayerReady(state, 'player-2');
    state = setPlayerReady(state, 'player-3');

    const transitions = startHand(state);
    state = transitions[transitions.length - 1].state;
    expect(state.handInProgress).toBe(true);

    // Find a player who can check (not facing a bet)
    // Process actions until we find one who can check, then sit them out
    let sitOutPlayerId: string | null = null;
    let safety = 10;
    while (state.handInProgress && state.activePlayerId && safety-- > 0) {
      const activeId = state.activePlayerId;
      const active = state.players.find(p => p.id === activeId)!;
      const canCheck = active.bet >= state.currentBet;

      if (canCheck && !sitOutPlayerId) {
        // This player can check — sit them out, auto-check, then return
        sitOutPlayerId = activeId;
        state = setPlayerSittingOut(state, activeId, true);

        // Auto-check for the sitting out player
        const checkTransitions = processAction(state, activeId, 'CHECK');
        state = checkTransitions[checkTransitions.length - 1].state;

        // Player returns immediately
        state = setPlayerSittingOut(state, sitOutPlayerId, false);
        const returned = state.players.find(p => p.id === sitOutPlayerId)!;
        expect(returned.sittingOut).toBe(false);
        expect(returned.folded).toBe(false); // still in the hand
      } else {
        // Other player acts normally
        const action = canCheck ? 'CHECK' : 'CALL';
        const actionTransitions = processAction(state, activeId, action);
        state = actionTransitions[actionTransitions.length - 1].state;
      }

      // If the returned player becomes active again, verify they can act
      if (sitOutPlayerId && state.handInProgress && state.activePlayerId === sitOutPlayerId) {
        const p = state.players.find(p2 => p2.id === sitOutPlayerId)!;
        expect(p.sittingOut).toBe(false);
        expect(p.folded).toBe(false);
        // Player can act normally
        const pCanCheck = p.bet >= state.currentBet;
        const pAction = pCanCheck ? 'CHECK' : 'CALL';
        const pTransitions = processAction(state, sitOutPlayerId, pAction);
        expect(pTransitions.length).toBeGreaterThan(0);
        break; // test passed
      }
    }

    // Verify we actually tested the sit-out/return scenario
    expect(sitOutPlayerId).not.toBeNull();
  });

  test('cash game: sitting out player misses hand, returns for next', () => {
    // Regression: player sits out between hands, is excluded from next hand,
    // returns between hands, and is dealt into the hand after that.
    let state = createInitialState(makeCashConfig());
    state = addPlayer(state, 'player-1', 'Alice').state;
    state = addPlayer(state, 'player-2', 'Bob').state;
    state = addPlayer(state, 'player-3', 'Charlie').state;
    state = setPlayerReady(state, 'player-1');
    state = setPlayerReady(state, 'player-2');
    state = setPlayerReady(state, 'player-3');

    // Start hand 1 — all players dealt in
    let transitions = startHand(state);
    state = transitions[transitions.length - 1].state;
    expect(state.handInProgress).toBe(true);

    // Player-1 sits out mid-hand
    state = setPlayerSittingOut(state, 'player-1', true);

    // Play out the hand to completion
    let safety = 20;
    while (state.handInProgress && safety-- > 0) {
      const activeId = state.activePlayerId!;
      const active = state.players.find(p => p.id === activeId)!;
      if (active.sittingOut) {
        // Auto-action for sitting-out player
        const canCheck = active.bet >= state.currentBet;
        const action = canCheck ? 'CHECK' : 'FOLD';
        const t = processAction(state, activeId, action);
        state = t[t.length - 1].state;
      } else {
        const canCheck = active.bet >= state.currentBet;
        const action = canCheck ? 'CHECK' : 'CALL';
        const t = processAction(state, activeId, action);
        state = t[t.length - 1].state;
      }
    }
    expect(state.handInProgress).toBe(false);

    // Hand 2 — player-1 still sitting out, should be excluded (folded at start)
    transitions = startHand(state);
    state = transitions[transitions.length - 1].state;
    const p1Hand2 = state.players.find(p => p.id === 'player-1')!;
    expect(p1Hand2.sittingOut).toBe(true);
    expect(p1Hand2.folded).toBe(true);
    expect(p1Hand2.holeCards).toBeNull();

    // Play out hand 2
    safety = 20;
    while (state.handInProgress && safety-- > 0) {
      const activeId = state.activePlayerId!;
      const active = state.players.find(p => p.id === activeId)!;
      const canCheck = active.bet >= state.currentBet;
      const action = canCheck ? 'CHECK' : 'CALL';
      const t = processAction(state, activeId, action);
      state = t[t.length - 1].state;
    }
    expect(state.handInProgress).toBe(false);

    // Player-1 returns between hands
    state = setPlayerSittingOut(state, 'player-1', false);
    const p1Returned = state.players.find(p => p.id === 'player-1')!;
    expect(p1Returned.sittingOut).toBe(false);

    // Hand 3 — player-1 should be dealt in
    transitions = startHand(state);
    state = transitions[transitions.length - 1].state;
    const p1Hand3 = state.players.find(p => p.id === 'player-1')!;
    expect(p1Hand3.sittingOut).toBe(false);
    expect(p1Hand3.folded).toBe(false);
    expect(p1Hand3.holeCards).not.toBeNull();
  });

  test('startHand on already-in-progress state double-increments handNumber', () => {
    // This confirms why the handInProgress guard in startNextHand is needed:
    // calling startHand on an active state would corrupt it by starting a new hand.
    let state = makeCashState();
    state = setPlayerReady(state, 'player-1');
    state = setPlayerReady(state, 'player-2');

    const transitions = startHand(state);
    const handState = transitions[transitions.length - 1].state;
    expect(handState.handInProgress).toBe(true);
    expect(handState.handNumber).toBe(1);

    // Calling startHand again would start hand 2 on top of hand 1 — corruption
    const transitions2 = startHand(handState);
    const hand2State = transitions2[transitions2.length - 1].state;
    expect(hand2State.handNumber).toBe(2); // double-incremented — this is the bug the guard prevents
  });
});
