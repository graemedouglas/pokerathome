/**
 * Tests for tournament setup guards and toClientGameState tournament field.
 */
import {
  createInitialState,
  addPlayer,
  toClientGameState,
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
