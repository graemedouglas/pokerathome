/**
 * Tests for chat features:
 * - Non-Latin script character filtering
 * - Server-side chat history storage
 * - Chat history sent on join/reconnect
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
    REPLAY_DIR: './test-replays/',
    ADMIN_PASSWORD: 'admin',
    MAX_CHAT_HISTORY: 5,
  },
}));

import { createGame, createPlayer } from '../src/db/queries';
import { SessionManager } from '../src/ws/session';
import { GameManager } from '../src/game-manager';
import { handleJoinGame, handleChat, handleRejoinGame } from '../src/ws/handlers';
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

function getMessagesByAction(socket: WebSocket & { _messages: string[] }, action: string): any[] {
  return getAllMessages(socket).filter(m => m.action === action);
}

function getLastMessage(socket: WebSocket & { _messages: string[] }): any {
  return JSON.parse(socket._messages[socket._messages.length - 1]);
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

function joinPlayer(name: string, role: 'player' | 'spectator' = 'player') {
  const socket = createMockSocket();
  const player = createPlayer(name);
  sessions.register(player.id, name, socket);
  const session = sessions.getByPlayerId(player.id)!;
  handleJoinGame(session, { gameId, role }, sessions, gameManager, mockLogger);
  return { socket, session, player };
}

function startGameWithTwoPlayers() {
  const p1 = joinPlayer('Alice');
  const p2 = joinPlayer('Bob');
  gameManager.setPlayerReady(gameId, p1.player.id);
  gameManager.setPlayerReady(gameId, p2.player.id);
  gameManager.forceStartGame(gameId, sessions);
  return { p1, p2 };
}

// ─── Chat Filter Tests ──────────────────────────────────────────────────────

describe('Chat character filtering', () => {
  test('strips Chinese characters from messages', () => {
    const { p1, p2 } = startGameWithTwoPlayers();
    p2.socket._messages.length = 0;

    handleChat(p1.session, { message: 'hello 你好 world' }, sessions, gameManager, mockLogger);

    const chatMsgs = getMessagesByAction(p2.socket, 'chatMessage');
    expect(chatMsgs).toHaveLength(1);
    expect(chatMsgs[0].payload.message).toBe('hello  world');
  });

  test('strips Korean characters', () => {
    const { p1, p2 } = startGameWithTwoPlayers();
    p2.socket._messages.length = 0;

    handleChat(p1.session, { message: '안녕하세요 hi' }, sessions, gameManager, mockLogger);

    const chatMsgs = getMessagesByAction(p2.socket, 'chatMessage');
    expect(chatMsgs).toHaveLength(1);
    expect(chatMsgs[0].payload.message).toBe('hi');
  });

  test('keeps emojis in messages', () => {
    const { p1, p2 } = startGameWithTwoPlayers();
    p2.socket._messages.length = 0;

    handleChat(p1.session, { message: 'nice hand! 👍🎉' }, sessions, gameManager, mockLogger);

    const chatMsgs = getMessagesByAction(p2.socket, 'chatMessage');
    expect(chatMsgs).toHaveLength(1);
    expect(chatMsgs[0].payload.message).toBe('nice hand! 👍🎉');
  });

  test('keeps accented Latin characters', () => {
    const { p1, p2 } = startGameWithTwoPlayers();
    p2.socket._messages.length = 0;

    handleChat(p1.session, { message: 'café résumé naïve' }, sessions, gameManager, mockLogger);

    const chatMsgs = getMessagesByAction(p2.socket, 'chatMessage');
    expect(chatMsgs).toHaveLength(1);
    expect(chatMsgs[0].payload.message).toBe('café résumé naïve');
  });

  test('rejects message that becomes empty after filtering', () => {
    const { p1 } = startGameWithTwoPlayers();
    p1.socket._messages.length = 0;

    handleChat(p1.session, { message: '你好世界' }, sessions, gameManager, mockLogger);

    const lastMsg = getLastMessage(p1.socket);
    expect(lastMsg.action).toBe('error');
    expect(lastMsg.payload.code).toBe('INVALID_MESSAGE');
  });

  test('strips Cyrillic characters', () => {
    const { p1, p2 } = startGameWithTwoPlayers();
    p2.socket._messages.length = 0;

    handleChat(p1.session, { message: 'hello привет' }, sessions, gameManager, mockLogger);

    const chatMsgs = getMessagesByAction(p2.socket, 'chatMessage');
    expect(chatMsgs).toHaveLength(1);
    expect(chatMsgs[0].payload.message).toBe('hello');
  });
});

// ─── Chat History Tests ─────────────────────────────────────────────────────

describe('Chat history', () => {
  test('stores chat messages in game history', () => {
    const { p1 } = startGameWithTwoPlayers();

    handleChat(p1.session, { message: 'hello' }, sessions, gameManager, mockLogger);
    handleChat(p1.session, { message: 'world' }, sessions, gameManager, mockLogger);

    const history = gameManager.getChatHistory(gameId);
    expect(history).toHaveLength(2);
    expect(history[0].message).toBe('hello');
    expect(history[1].message).toBe('world');
  });

  test('truncates chat history at MAX_CHAT_HISTORY limit', () => {
    const { p1 } = startGameWithTwoPlayers();

    // Send 7 messages (limit is 5)
    for (let i = 0; i < 7; i++) {
      handleChat(p1.session, { message: `msg ${i}` }, sessions, gameManager, mockLogger);
    }

    const history = gameManager.getChatHistory(gameId);
    expect(history).toHaveLength(5);
    // Oldest messages should be dropped
    expect(history[0].message).toBe('msg 2');
    expect(history[4].message).toBe('msg 6');
  });

  test('includes chat history in gameJoined response for spectators', () => {
    const { p1 } = startGameWithTwoPlayers();

    handleChat(p1.session, { message: 'before spectator' }, sessions, gameManager, mockLogger);

    // Spectator joins
    const spectator = joinPlayer('Charlie', 'spectator');
    const joinedMsg = getAllMessages(spectator.socket).find(m => m.action === 'gameJoined');

    expect(joinedMsg).toBeDefined();
    expect(joinedMsg.payload.chatHistory).toBeDefined();
    expect(joinedMsg.payload.chatHistory).toHaveLength(1);
    expect(joinedMsg.payload.chatHistory[0].message).toBe('before spectator');
  });

  test('includes chat history in rejoinedGame response', () => {
    const { p1, p2 } = startGameWithTwoPlayers();

    handleChat(p1.session, { message: 'while you were gone' }, sessions, gameManager, mockLogger);

    // Simulate p2 reconnecting with a new socket
    const newSocket = createMockSocket();
    sessions.register(p2.player.id, 'Bob', newSocket);
    const newSession = sessions.getByPlayerId(p2.player.id)!;
    newSession.gameId = gameId;

    handleRejoinGame(newSession, sessions, gameManager, mockLogger);

    const rejoinedMsg = getAllMessages(newSocket).find(m => m.action === 'rejoinedGame');
    expect(rejoinedMsg).toBeDefined();
    expect(rejoinedMsg.payload.chatHistory).toBeDefined();
    expect(rejoinedMsg.payload.chatHistory).toHaveLength(1);
    expect(rejoinedMsg.payload.chatHistory[0].message).toBe('while you were gone');
  });

  test('returns empty array for game with no chat history', () => {
    const history = gameManager.getChatHistory(gameId);
    expect(history).toEqual([]);
  });

  test('returns empty array for non-existent game', () => {
    const history = gameManager.getChatHistory('non-existent-id');
    expect(history).toEqual([]);
  });
});
