/**
 * Spectator rejoin bug fix tests.
 *
 * Verifies that spectators are cleaned up on disconnect and can rejoin
 * without "Already in a game" errors. Uses a real in-memory DB,
 * SessionManager, GameManager, and handler functions.
 */

import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';

// Set up an in-memory DB before any source modules load (db/index.ts uses
// import.meta.url which breaks under CJS / ts-jest, so we mock it).
const schema = fs.readFileSync(
  path.join(__dirname, '..', 'src', 'db', 'schema.sql'),
  'utf-8',
);
let testDb: InstanceType<typeof Database>;

jest.mock('../src/db/index', () => ({
  getDb: () => testDb,
  initDb: () => testDb,
}));

// Mock uuid (ESM-only package that Jest can't transform in CJS mode)
let uuidCounter = 0;
jest.mock('uuid', () => ({
  v4: () => `test-uuid-${++uuidCounter}`,
}));

// Also mock config so we don't need .env / dotenv
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
  },
}));

import { createGame, createPlayer, getPlayerGame } from '../src/db/queries';
import { SessionManager } from '../src/ws/session';
import { GameManager } from '../src/game-manager';
import { handleIdentify, handleJoinGame } from '../src/ws/handlers';
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

// ─── Setup ───────────────────────────────────────────────────────────────────

let sessions: SessionManager;
let gameManager: GameManager;
let gameId: string;

beforeEach(() => {
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

// ─── Helper: simulate the close handler logic from server.ts ────────────────

function simulateSocketClose(socket: WebSocket): void {
  const playerId = sessions.disconnect(socket);
  if (playerId) {
    const session = sessions.getByPlayerId(playerId);
    if (session?.gameId) {
      const engineState = gameManager.getActiveGameState(session.gameId);
      const player = engineState?.players.find(p => p.id === playerId);

      if (player?.role === 'spectator') {
        gameManager.removePlayer(session.gameId, playerId, sessions);
        sessions.setGameId(playerId, null);
      } else {
        gameManager.setPlayerConnected(session.gameId, playerId, false);
      }
    }
  }
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('Spectator disconnect cleanup', () => {

  test('spectator disconnect clears session gameId and DB record', () => {
    const socket = createMockSocket();
    const player = createPlayer('Spectator Steve');
    sessions.register(player.id, 'Spectator Steve', socket);

    const session = sessions.getByPlayerId(player.id)!;
    handleJoinGame(session, { gameId, role: 'spectator' }, sessions, gameManager, mockLogger);
    expect(session.gameId).toBe(gameId);
    expect(getPlayerGame(player.id)).toBeDefined();

    simulateSocketClose(socket);

    const after = sessions.getByPlayerId(player.id);
    expect(after?.gameId).toBeNull();
    expect(getPlayerGame(player.id)).toBeUndefined();
  });

  test('spectator can rejoin game after disconnect', () => {
    const socket1 = createMockSocket();
    const player = createPlayer('Spectator Steve');
    sessions.register(player.id, 'Spectator Steve', socket1);

    // Join as spectator
    const session1 = sessions.getByPlayerId(player.id)!;
    handleJoinGame(session1, { gameId, role: 'spectator' }, sessions, gameManager, mockLogger);

    // Disconnect
    simulateSocketClose(socket1);

    // Reconnect with new socket
    const socket2 = createMockSocket();
    sessions.register(player.id, 'Spectator Steve', socket2);

    // Rejoin — should succeed
    const session2 = sessions.getByPlayerId(player.id)!;
    expect(session2.gameId).toBeNull();
    handleJoinGame(session2, { gameId, role: 'spectator' }, sessions, gameManager, mockLogger);

    // gameJoined is sent first, then a gameState broadcast follows
    expect(hasMessage(socket2, 'gameJoined')).toBe(true);
    expect(hasMessage(socket2, 'error')).toBe(false);
  });

  test('regular player disconnect does NOT remove them (regression)', () => {
    const socket = createMockSocket();
    const player = createPlayer('Player Pete');
    sessions.register(player.id, 'Player Pete', socket);

    const session = sessions.getByPlayerId(player.id)!;
    handleJoinGame(session, { gameId, role: 'player' }, sessions, gameManager, mockLogger);
    expect(session.gameId).toBe(gameId);

    simulateSocketClose(socket);

    // Session gameId and DB record should persist for reconnection
    const after = sessions.getByPlayerId(player.id);
    expect(after?.gameId).toBe(gameId);
    expect(getPlayerGame(player.id)).toBeDefined();
  });
});

describe('handleIdentify spectator cleanup', () => {

  test('reconnecting spectator gets stale record cleaned up', () => {
    const player = createPlayer('Spectator Sam');
    const socket1 = createMockSocket();

    sessions.register(player.id, 'Spectator Sam', socket1);
    const session = sessions.getByPlayerId(player.id)!;
    handleJoinGame(session, { gameId, role: 'spectator' }, sessions, gameManager, mockLogger);
    expect(getPlayerGame(player.id)).toBeDefined();

    // New connection arrives (without close firing on old socket)
    const socket2 = createMockSocket();
    handleIdentify(
      socket2,
      { displayName: 'Spectator Sam', reconnectToken: player.reconnect_token },
      sessions, gameManager, mockLogger,
    );

    // Stale record should be cleaned up; gameId should be null
    const newSession = sessions.getByPlayerId(player.id)!;
    expect(newSession.gameId).toBeNull();
    expect(getPlayerGame(player.id)).toBeUndefined();

    // Should be able to rejoin
    handleJoinGame(newSession, { gameId, role: 'spectator' }, sessions, gameManager, mockLogger);
    expect(hasMessage(socket2, 'gameJoined')).toBe(true);
    expect(hasMessage(socket2, 'error')).toBe(false);
  });

  test('reconnecting regular player still gets reconnect state', () => {
    const player = createPlayer('Player Pete');
    const socket1 = createMockSocket();

    sessions.register(player.id, 'Player Pete', socket1);
    const session = sessions.getByPlayerId(player.id)!;
    handleJoinGame(session, { gameId, role: 'player' }, sessions, gameManager, mockLogger);

    // Reconnect with new socket
    const socket2 = createMockSocket();
    handleIdentify(
      socket2,
      { displayName: 'Player Pete', reconnectToken: player.reconnect_token },
      sessions, gameManager, mockLogger,
    );

    // Should be reconnected to the game, not cleaned up
    const newSession = sessions.getByPlayerId(player.id)!;
    expect(newSession.gameId).toBe(gameId);

    const msg = getLastMessage(socket2);
    expect(msg.action).toBe('identified');
    expect(msg.payload.currentGame).toBeDefined();
  });
});
