/**
 * Bot lifecycle tests.
 *
 * Verifies that:
 * - Bots join games with correct displayNames
 * - Bots ready up after joining
 * - Multiple bots can be added to the same game
 * - Bots added to a game with existing players work correctly
 * - alreadyInGame scenario is handled (bot in one game tries to join another)
 * - displayName flows from identify → join → engine state → lobbyUpdate
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
import { handleIdentify, handleJoinGame, handleReady } from '../src/ws/handlers';
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

/**
 * Simulate the full bot lifecycle: identify → joinGame → ready.
 * This mirrors what BotClient does over WebSocket, but using direct handler calls.
 */
function simulateBot(displayName: string, targetGameId: string = gameId) {
  const socket = createMockSocket();

  // Step 1: Identify (like BotClient sending { action: 'identify', payload: { displayName } })
  handleIdentify(socket, { displayName }, sessions, gameManager, mockLogger);

  // Extract playerId from identified response
  const identifiedMsg = getMessageByAction(socket, 'identified');
  expect(identifiedMsg).toBeDefined();
  const playerId = identifiedMsg.payload.playerId;

  // Step 2: Join game
  const session = sessions.getByPlayerId(playerId)!;
  handleJoinGame(session, { gameId: targetGameId }, sessions, gameManager, mockLogger);

  return { socket, playerId, session };
}

/** Join a player (human) to the game. */
function joinPlayer(name: string) {
  const socket = createMockSocket();
  const player = createPlayer(name);
  sessions.register(player.id, name, socket);
  const session = sessions.getByPlayerId(player.id)!;
  handleJoinGame(session, { gameId }, sessions, gameManager, mockLogger);
  return { socket, session, player };
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('Bot joins empty game', () => {

  test('bot receives gameJoined after identify + joinGame', () => {
    const { socket } = simulateBot('Test Bot');
    expect(hasMessage(socket, 'identified')).toBe(true);
    expect(hasMessage(socket, 'gameJoined')).toBe(true);
    expect(hasMessage(socket, 'error')).toBe(false);
  });

  test('bot displayName appears correctly in engine state', () => {
    const { playerId } = simulateBot('Calling Station');
    const state = gameManager.getActiveGameState(gameId);
    const player = state?.players.find(p => p.id === playerId);
    expect(player).toBeDefined();
    expect(player!.displayName).toBe('Calling Station');
  });

  test('bot can ready up after joining', () => {
    const { socket, session } = simulateBot('Ready Bot');

    // Step 3: Ready up (like BotClient does in handleGameJoined)
    handleReady(session, sessions, gameManager, mockLogger);

    // Should receive lobbyUpdate showing bot as ready
    const lobbyMsgs = getAllMessages(socket).filter(m => m.action === 'lobbyUpdate');
    expect(lobbyMsgs.length).toBeGreaterThan(0);
    const lastLobby = lobbyMsgs[lobbyMsgs.length - 1];
    const botPlayer = lastLobby.payload.players.find((p: any) => p.displayName === 'Ready Bot');
    expect(botPlayer).toBeDefined();
    expect(botPlayer.isReady).toBe(true);
  });
});

describe('Bot joins game with existing players', () => {

  test('bot joins game that already has a human player', () => {
    const human = joinPlayer('Alice');
    const { socket, playerId } = simulateBot('Bot Player');

    expect(hasMessage(socket, 'gameJoined')).toBe(true);
    expect(hasMessage(socket, 'error')).toBe(false);

    // Both should be in the engine state
    const state = gameManager.getActiveGameState(gameId);
    expect(state?.players.length).toBe(2);
    expect(state?.players.find(p => p.id === human.player.id)?.displayName).toBe('Alice');
    expect(state?.players.find(p => p.id === playerId)?.displayName).toBe('Bot Player');
  });

  test('bot joins game that already has another bot', () => {
    const bot1 = simulateBot('First Bot');
    const bot2 = simulateBot('Second Bot');

    expect(hasMessage(bot1.socket, 'gameJoined')).toBe(true);
    expect(hasMessage(bot2.socket, 'gameJoined')).toBe(true);

    const state = gameManager.getActiveGameState(gameId);
    expect(state?.players.length).toBe(2);
    expect(state?.players.find(p => p.id === bot1.playerId)?.displayName).toBe('First Bot');
    expect(state?.players.find(p => p.id === bot2.playerId)?.displayName).toBe('Second Bot');
  });

  test('multiple bots all get correct displayNames in lobby broadcast', () => {
    const bot1 = simulateBot('Calling Station');
    const bot1Session = sessions.getByPlayerId(bot1.playerId)!;
    handleReady(bot1Session, sessions, gameManager, mockLogger);

    const bot2 = simulateBot('TAG Bot');
    const bot2Session = sessions.getByPlayerId(bot2.playerId)!;
    handleReady(bot2Session, sessions, gameManager, mockLogger);

    // Check the last lobbyUpdate received by bot2
    const lobbyMsgs = getAllMessages(bot2.socket).filter(m => m.action === 'lobbyUpdate');
    const lastLobby = lobbyMsgs[lobbyMsgs.length - 1];
    const names = lastLobby.payload.players.map((p: any) => p.displayName).sort();
    expect(names).toEqual(['Calling Station', 'TAG Bot']);
  });

  test('adding a third bot to a game with two existing bots', () => {
    simulateBot('Bot 1');
    simulateBot('Bot 2');
    const bot3 = simulateBot('Bot 3');

    expect(hasMessage(bot3.socket, 'gameJoined')).toBe(true);
    expect(hasMessage(bot3.socket, 'error')).toBe(false);

    const state = gameManager.getActiveGameState(gameId);
    expect(state?.players.length).toBe(3);
    const names = state!.players.map(p => p.displayName).sort();
    expect(names).toEqual(['Bot 1', 'Bot 2', 'Bot 3']);
  });
});

describe('displayName correctness through full chain', () => {

  test('displayName from identify flows to engine state, not playerId', () => {
    const socket = createMockSocket();
    const botName = 'Bot (calling-station)';

    // Identify with displayName
    handleIdentify(socket, { displayName: botName }, sessions, gameManager, mockLogger);
    const identifiedMsg = getMessageByAction(socket, 'identified');
    const playerId = identifiedMsg.payload.playerId;

    // Verify displayName != playerId
    expect(botName).not.toBe(playerId);

    // Join game
    const session = sessions.getByPlayerId(playerId)!;
    expect(session.displayName).toBe(botName);

    handleJoinGame(session, { gameId }, sessions, gameManager, mockLogger);

    // Verify engine state has displayName, not playerId
    const state = gameManager.getActiveGameState(gameId);
    const player = state?.players.find(p => p.id === playerId);
    expect(player!.displayName).toBe(botName);
    expect(player!.displayName).not.toBe(playerId);
  });

  test('lobbyUpdate contains displayName, not playerId', () => {
    const { socket, playerId } = simulateBot('Fancy Bot Name');
    const session = sessions.getByPlayerId(playerId)!;
    handleReady(session, sessions, gameManager, mockLogger);

    const lobbyMsgs = getAllMessages(socket).filter(m => m.action === 'lobbyUpdate');
    const lastLobby = lobbyMsgs[lobbyMsgs.length - 1];
    const player = lastLobby.payload.players.find((p: any) => p.id === playerId);
    expect(player.displayName).toBe('Fancy Bot Name');
    expect(player.displayName).not.toBe(playerId);
  });
});

describe('alreadyInGame handling', () => {

  test('bot in one game gets alreadyInGame when trying to join another', () => {
    // Bot joins game 1
    const { socket, playerId } = simulateBot('Wandering Bot');

    // Create game 2
    const game2 = createGame({
      name: 'Game 2',
      smallBlind: 5,
      bigBlind: 10,
      maxPlayers: 6,
      startingStack: 1000,
    });

    // Clear messages
    socket._messages.length = 0;

    // Try to join game 2 while still in game 1
    const session = sessions.getByPlayerId(playerId)!;
    handleJoinGame(session, { gameId: game2.id }, sessions, gameManager, mockLogger);

    // Should get alreadyInGame since game 1 is active
    expect(hasMessage(socket, 'alreadyInGame')).toBe(true);
    const msg = getMessageByAction(socket, 'alreadyInGame');
    expect(msg.payload.existingGameId).toBe(gameId);
    expect(msg.payload.existingGameName).toBe('Test Game');
  });
});
