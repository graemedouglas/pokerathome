/**
 * Reconnection bug fix tests.
 *
 * Verifies that:
 * - Stale gameIds are cleared when a game completes
 * - handleIdentify cleans up stale gameIds on reconnect
 * - handleJoinGame auto-clears stale gameIds for completed games
 * - handleJoinGame sends alreadyInGame for active games
 * - handleRejoinGame works correctly
 */

import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';

const schema = fs.readFileSync(
  path.join(__dirname, '..', 'src', 'db', 'schema.sql'),
  'utf-8',
);
let testDb: InstanceType<typeof Database>;

jest.mock('../src/db/index', () => ({
  getDb: () => testDb,
  initDb: () => testDb,
}));

let uuidCounter = 0;
jest.mock('uuid', () => ({
  v4: () => `test-uuid-${++uuidCounter}`,
}));

jest.mock('../src/config', () => ({
  config: {
    PORT: 3000,
    HOST: '0.0.0.0',
    DB_PATH: ':memory:',
    LOG_LEVEL: 'silent',
    ACTION_TIMEOUT_MS: 30000,
    HAND_DELAY_MS: 3000,
    MIN_PLAYERS_TO_START: 2,
    SPECTATOR_CARD_VISIBILITY: 'showdown',
    LOG_FILE: '',
    PLAYER_CAN_START_GAME: true,
  },
}));

import { createGame, createPlayer } from '../src/db/queries';
import { SessionManager } from '../src/ws/session';
import { GameManager } from '../src/game-manager';
import { handleIdentify, handleJoinGame, handleLeaveGame, handleRejoinGame } from '../src/ws/handlers';
import type { WebSocket } from 'ws';
import type { FastifyBaseLogger } from 'fastify';

// ─── Mock logger ─────────────────────────────────────────────────────────────

const noop = (() => {}) as any;
const mockLogger: FastifyBaseLogger = {
  info: noop, warn: noop, error: noop, debug: noop,
  trace: noop, fatal: noop, silent: noop,
  child: () => mockLogger, level: 'silent',
} as unknown as FastifyBaseLogger;

// ─── Mock WebSocket ──────────────────────────────────────────────────────────

function createMockSocket(): WebSocket & { _messages: string[] } {
  const messages: string[] = [];
  return {
    readyState: 1,
    send: (data: string) => messages.push(data),
    close: noop,
    _messages: messages,
  } as unknown as WebSocket & { _messages: string[] };
}

function getAllMessages(socket: WebSocket & { _messages: string[] }): any[] {
  return socket._messages.map(m => JSON.parse(m));
}

function getLastMessage(socket: WebSocket & { _messages: string[] }): any {
  return JSON.parse(socket._messages[socket._messages.length - 1]);
}

function hasMessage(socket: WebSocket & { _messages: string[] }, action: string): boolean {
  return getAllMessages(socket).some(m => m.action === action);
}

function getMessageByAction(socket: WebSocket & { _messages: string[] }, action: string): any {
  return getAllMessages(socket).find(m => m.action === action);
}

// ─── Setup ───────────────────────────────────────────────────────────────────

let sessions: SessionManager;
let gameManager: GameManager;
let gameId: string;

beforeEach(() => {
  uuidCounter = 0;
  testDb = new Database(':memory:');
  testDb.pragma('foreign_keys = ON');
  testDb.exec(schema);

  sessions = new SessionManager(mockLogger);
  gameManager = new GameManager(mockLogger);

  const game = createGame({
    name: 'Test Game',
    smallBlind: 5,
    bigBlind: 10,
    maxPlayers: 6,
    startingStack: 1000,
  });
  gameId = game.id;
});

afterEach(() => {
  testDb.close();
});

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Register a player, join the game, and return socket + session. */
function joinPlayer(name: string, role: 'player' | 'spectator' = 'player') {
  const socket = createMockSocket();
  const player = createPlayer(name);
  sessions.register(player.id, name, socket);
  const session = sessions.getByPlayerId(player.id)!;
  handleJoinGame(session, { gameId, role }, sessions, gameManager, mockLogger);
  return { socket, session, player };
}

/** Start the game with two players ready. */
function startGameWithTwoPlayers() {
  const p1 = joinPlayer('Alice');
  const p2 = joinPlayer('Bob');

  gameManager.setPlayerReady(gameId, p1.player.id);
  gameManager.setPlayerReady(gameId, p2.player.id);
  gameManager.forceStartGame(gameId, sessions);

  return { p1, p2 };
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('Stale gameId after game completion', () => {

  test('endGame clears session.gameId for all players', () => {
    const { p1, p2 } = startGameWithTwoPlayers();

    // Both should be in the game
    expect(p1.session.gameId).toBe(gameId);
    expect(p2.session.gameId).toBe(gameId);

    // One player leaves during a hand — triggers endGame(insufficient_players)
    handleLeaveGame(p1.session, sessions, gameManager, mockLogger);

    // Both players' session.gameId should be cleared
    expect(sessions.getByPlayerId(p1.player.id)?.gameId).toBeNull();
    expect(sessions.getByPlayerId(p2.player.id)?.gameId).toBeNull();
  });

  test('player can join new game after previous game completed', () => {
    const { p1, p2 } = startGameWithTwoPlayers();

    // End the game
    handleLeaveGame(p1.session, sessions, gameManager, mockLogger);

    // Create a new game
    const game2 = createGame({
      name: 'Test Game 2',
      smallBlind: 5,
      bigBlind: 10,
      maxPlayers: 6,
      startingStack: 1000,
    });

    // Clear previous messages
    p2.socket._messages.length = 0;

    // p2 should be able to join the new game
    const session2 = sessions.getByPlayerId(p2.player.id)!;
    handleJoinGame(session2, { gameId: game2.id }, sessions, gameManager, mockLogger);

    expect(hasMessage(p2.socket, 'gameJoined')).toBe(true);
    expect(hasMessage(p2.socket, 'error')).toBe(false);
    expect(session2.gameId).toBe(game2.id);
  });
});

describe('handleIdentify sends pendingGame for active games', () => {

  test('reconnecting player gets pendingGame instead of currentGame', () => {
    const p1 = joinPlayer('Alice');

    // Reconnect via handleIdentify
    const socket2 = createMockSocket();
    handleIdentify(
      socket2,
      { displayName: 'Alice', reconnectToken: p1.player.reconnect_token },
      sessions, gameManager, mockLogger,
    );

    const msg = getLastMessage(socket2);
    expect(msg.action).toBe('identified');
    expect(msg.payload.currentGame).toBeUndefined();
    expect(msg.payload.pendingGame).toBeDefined();
    expect(msg.payload.pendingGame.gameId).toBe(gameId);
    expect(msg.payload.pendingGame.gameName).toBe('Test Game');

    // Session gameId should still be set (for rejoin/leave)
    const session = sessions.getByPlayerId(p1.player.id)!;
    expect(session.gameId).toBe(gameId);
  });
});

describe('handleIdentify stale gameId cleanup', () => {

  test('clears stale gameId when game is no longer active', () => {
    const { p1, p2 } = startGameWithTwoPlayers();

    // End the game
    handleLeaveGame(p1.session, sessions, gameManager, mockLogger);

    // Manually re-set p2's gameId to simulate the pre-fix bug
    // (where endGame didn't clear gameIds)
    sessions.setGameId(p2.player.id, gameId);

    // Reconnect p2 with a new socket
    const socket2 = createMockSocket();
    handleIdentify(
      socket2,
      { displayName: 'Bob', reconnectToken: p2.player.reconnect_token },
      sessions, gameManager, mockLogger,
    );

    // Stale gameId should be cleared
    const newSession = sessions.getByPlayerId(p2.player.id)!;
    expect(newSession.gameId).toBeNull();

    // identified message should NOT contain currentGame
    const msg = getLastMessage(socket2);
    expect(msg.action).toBe('identified');
    expect(msg.payload.currentGame).toBeUndefined();
  });
});

describe('Already in active game — choice flow', () => {

  test('handleJoinGame sends alreadyInGame when player is in active game', () => {
    const p1 = joinPlayer('Alice');

    // Create a second game
    const game2 = createGame({
      name: 'Game 2',
      smallBlind: 5,
      bigBlind: 10,
      maxPlayers: 6,
      startingStack: 1000,
    });

    // Clear previous messages
    p1.socket._messages.length = 0;

    // Try to join game 2 while still in game 1
    handleJoinGame(p1.session, { gameId: game2.id }, sessions, gameManager, mockLogger);

    // Should receive alreadyInGame, not error
    expect(hasMessage(p1.socket, 'alreadyInGame')).toBe(true);
    expect(hasMessage(p1.socket, 'error')).toBe(false);

    const msg = getMessageByAction(p1.socket, 'alreadyInGame');
    expect(msg.payload.existingGameId).toBe(gameId);
    expect(msg.payload.existingGameName).toBe('Test Game');
  });

  test('handleJoinGame auto-clears stale gameId and proceeds with join', () => {
    const socket = createMockSocket();
    const player = createPlayer('Charlie');
    sessions.register(player.id, 'Charlie', socket);
    const session = sessions.getByPlayerId(player.id)!;

    // Manually set a stale gameId pointing to a non-existent game
    sessions.setGameId(player.id, 'non-existent-game-id');

    // Try to join the real game — should auto-clear and succeed
    handleJoinGame(session, { gameId }, sessions, gameManager, mockLogger);

    expect(hasMessage(socket, 'gameJoined')).toBe(true);
    expect(hasMessage(socket, 'error')).toBe(false);
    expect(session.gameId).toBe(gameId);
  });

  test('handleRejoinGame sends game state for active game', () => {
    const p1 = joinPlayer('Alice');
    p1.socket._messages.length = 0;

    // Rejoin the game
    handleRejoinGame(p1.session, sessions, gameManager, mockLogger);

    expect(hasMessage(p1.socket, 'rejoinedGame')).toBe(true);
    const msg = getMessageByAction(p1.socket, 'rejoinedGame');
    expect(msg.payload.currentGame).toBeDefined();
    expect(msg.payload.currentGame.gameState).toBeDefined();
  });

  test('handleRejoinGame returns error when no game is active', () => {
    const socket = createMockSocket();
    const player = createPlayer('Dave');
    sessions.register(player.id, 'Dave', socket);
    const session = sessions.getByPlayerId(player.id)!;

    // No gameId set
    handleRejoinGame(session, sessions, gameManager, mockLogger);

    const msg = getLastMessage(socket);
    expect(msg.action).toBe('error');
    expect(msg.payload.code).toBe('NOT_IN_GAME');
  });

  test('handleRejoinGame sends reduced timeToActMs when reconnecting mid-turn', () => {
    jest.useFakeTimers();
    try {
      const { p1, p2 } = startGameWithTwoPlayers();

      // Find which player is active
      const state = gameManager.getActiveGameState(gameId)!;
      const activeId = state.activePlayerId;
      expect(activeId).toBeDefined();

      const activePlayer = activeId === p1.player.id ? p1 : p2;

      // Advance time by 10 seconds (timer started at game start)
      jest.advanceTimersByTime(10_000);

      // Clear messages and rejoin
      activePlayer.socket._messages.length = 0;
      handleRejoinGame(activePlayer.session, sessions, gameManager, mockLogger);

      const msg = getMessageByAction(activePlayer.socket, 'rejoinedGame');
      expect(msg).toBeDefined();
      expect(msg.payload.currentGame.actionRequest).toBeDefined();

      const timeToAct = msg.payload.currentGame.actionRequest.timeToActMs;
      // Should be approximately 20000ms (30000 - 10000), allow some tolerance
      expect(timeToAct).toBeLessThanOrEqual(20_000);
      expect(timeToAct).toBeGreaterThan(15_000);
    } finally {
      jest.useRealTimers();
    }
  });

  test('leaveGame then joinGame works for switching active games', () => {
    const p1 = joinPlayer('Alice');

    const game2 = createGame({
      name: 'Game 2',
      smallBlind: 5,
      bigBlind: 10,
      maxPlayers: 6,
      startingStack: 1000,
    });

    // Leave current game
    handleLeaveGame(p1.session, sessions, gameManager, mockLogger);
    expect(p1.session.gameId).toBeNull();

    // Clear messages
    p1.socket._messages.length = 0;

    // Join new game
    handleJoinGame(p1.session, { gameId: game2.id }, sessions, gameManager, mockLogger);

    expect(hasMessage(p1.socket, 'gameJoined')).toBe(true);
    expect(hasMessage(p1.socket, 'error')).toBe(false);
    expect(p1.session.gameId).toBe(game2.id);
  });
});
