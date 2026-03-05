/**
 * End-to-end auth integration tests.
 *
 * Tests the full WebSocket auth flow: identify with credentials,
 * authRequired rejection, auth token persistence, invite code auto-join,
 * and credential bypass hierarchy.
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
    REPLAY_DIR: './replays/',
    ADMIN_PASSWORD: 'admin',
  },
}));

import { createGame } from '../src/db/queries';
import { SessionManager } from '../src/ws/session';
import { GameManager } from '../src/game-manager';
import { handleIdentify } from '../src/ws/handlers';
import {
  setPrivateMode,
  setServerPassphrase,
  revokeAllAuthTokens,
  revokeAuthTokensForPlayer,
} from '../src/auth';
import {
  createPlayerPassphrase,
  createInviteCode,
  revokePlayerPassphrase,
  revokeInviteCode,
} from '../src/db/auth-queries';
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

  // Create a test game
  const game = createGame({
    name: 'Auth Test',
    smallBlind: 5,
    bigBlind: 10,
    maxPlayers: 6,
    startingStack: 1000,
  });
  gameId = game.id;
  gameManager.activateGame(gameId);

  // Reset auth state
  setPrivateMode(false);
  setServerPassphrase(null);
});

afterEach(() => {
  testDb?.close();
});

// ─── Helper ──────────────────────────────────────────────────────────────────

function identify(
  socket: WebSocket & { _messages: string[] },
  displayName: string,
  credentials: Record<string, string> = {},
): void {
  handleIdentify(
    socket,
    { displayName, ...credentials },
    sessions,
    gameManager,
    mockLogger,
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// Open mode
// ═══════════════════════════════════════════════════════════════════════════════

describe('Open mode (private OFF)', () => {
  test('connect without credentials → identified', () => {
    const socket = createMockSocket();
    identify(socket, 'Alice');
    const msg = getMessageByAction(socket, 'identified');
    expect(msg).toBeDefined();
    expect(msg.payload.playerId).toBeDefined();
    expect(msg.payload.reconnectToken).toBeDefined();
  });

  test('no authToken issued when not needed', () => {
    const socket = createMockSocket();
    identify(socket, 'Alice');
    const msg = getMessageByAction(socket, 'identified');
    expect(msg.payload.authToken).toBeUndefined();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Private mode — rejection
// ═══════════════════════════════════════════════════════════════════════════════

describe('Private mode — no credentials', () => {
  beforeEach(() => {
    setPrivateMode(true);
  });

  test('connect without credentials → authRequired', () => {
    const socket = createMockSocket();
    identify(socket, 'Alice');
    const msg = getMessageByAction(socket, 'authRequired');
    expect(msg).toBeDefined();
    expect(msg.payload.methods).toBeInstanceOf(Array);
    expect(msg.payload.message).toContain('Authentication required');
  });

  test('authRequired lists available methods', () => {
    setServerPassphrase('secret');
    const socket = createMockSocket();
    identify(socket, 'Alice');
    const msg = getMessageByAction(socket, 'authRequired');
    expect(msg.payload.methods).toContain('server_passphrase');
    expect(msg.payload.methods).toContain('player_passphrase');
    expect(msg.payload.methods).toContain('invite_code');
  });

  test('not registered in session manager when rejected', () => {
    const socket = createMockSocket();
    identify(socket, 'Alice');
    expect(sessions.size).toBe(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Server passphrase
// ═══════════════════════════════════════════════════════════════════════════════

describe('Private mode + server passphrase', () => {
  beforeEach(() => {
    setPrivateMode(true);
    setServerPassphrase('poker123');
  });

  test('correct passphrase → identified with authToken', () => {
    const socket = createMockSocket();
    identify(socket, 'Alice', { serverPassphrase: 'poker123' });
    const msg = getMessageByAction(socket, 'identified');
    expect(msg).toBeDefined();
    expect(msg.payload.authToken).toBeDefined();
  });

  test('wrong passphrase → authRequired', () => {
    const socket = createMockSocket();
    identify(socket, 'Alice', { serverPassphrase: 'wrong' });
    const msg = getMessageByAction(socket, 'authRequired');
    expect(msg).toBeDefined();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Auth token persistence (reconnect)
// ═══════════════════════════════════════════════════════════════════════════════

describe('Auth token reconnect', () => {
  beforeEach(() => {
    setPrivateMode(true);
    setServerPassphrase('poker123');
  });

  test('reconnect with auth token → no passphrase needed', () => {
    // First connect with passphrase
    const socket1 = createMockSocket();
    identify(socket1, 'Alice', { serverPassphrase: 'poker123' });
    const identified1 = getMessageByAction(socket1, 'identified');
    const authToken = identified1.payload.authToken;
    const playerId = identified1.payload.playerId;
    const reconnectToken = identified1.payload.reconnectToken;

    // Reconnect with auth token only (no passphrase)
    const socket2 = createMockSocket();
    identify(socket2, 'Alice', { authToken, reconnectToken });
    const identified2 = getMessageByAction(socket2, 'identified');
    expect(identified2).toBeDefined();
    expect(identified2.payload.playerId).toBe(playerId);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Player passphrases
// ═══════════════════════════════════════════════════════════════════════════════

describe('Player passphrases', () => {
  beforeEach(() => {
    setPrivateMode(true);
  });

  test('valid passphrase → identified, passphrase consumed', () => {
    const pp = createPlayerPassphrase('Alice');
    const socket = createMockSocket();
    identify(socket, 'Alice', { playerPassphrase: pp.passphrase });
    const msg = getMessageByAction(socket, 'identified');
    expect(msg).toBeDefined();
    expect(msg.payload.authToken).toBeDefined();

    // Try to reuse — should fail
    const socket2 = createMockSocket();
    identify(socket2, 'Bob', { playerPassphrase: pp.passphrase });
    const authReq = getMessageByAction(socket2, 'authRequired');
    expect(authReq).toBeDefined();
  });

  test('player passphrase bypasses server passphrase', () => {
    setServerPassphrase('secret');
    const pp = createPlayerPassphrase('Bypass');
    const socket = createMockSocket();
    // Only player passphrase, no server passphrase
    identify(socket, 'Alice', { playerPassphrase: pp.passphrase });
    const msg = getMessageByAction(socket, 'identified');
    expect(msg).toBeDefined();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Invite codes
// ═══════════════════════════════════════════════════════════════════════════════

describe('Invite codes', () => {
  beforeEach(() => {
    setPrivateMode(true);
  });

  test('valid invite code → identified with autoJoinGameId', () => {
    const ic = createInviteCode(gameId, 'Bob');
    const socket = createMockSocket();
    identify(socket, 'Bob', { inviteCode: ic.code });
    const msg = getMessageByAction(socket, 'identified');
    expect(msg).toBeDefined();
    expect(msg.payload.authToken).toBeDefined();
    expect(msg.payload.autoJoinGameId).toBe(gameId);
  });

  test('invite code bypasses server passphrase', () => {
    setServerPassphrase('secret');
    const ic = createInviteCode(gameId, 'Bypass');
    const socket = createMockSocket();
    // Only invite code, no server passphrase
    identify(socket, 'Alice', { inviteCode: ic.code });
    const msg = getMessageByAction(socket, 'identified');
    expect(msg).toBeDefined();
    expect(msg.payload.autoJoinGameId).toBe(gameId);
  });

  test('already-used invite code → rejected', () => {
    const ic = createInviteCode(gameId, 'Used');
    // Use it
    const socket1 = createMockSocket();
    identify(socket1, 'Alice', { inviteCode: ic.code });
    expect(getMessageByAction(socket1, 'identified')).toBeDefined();

    // Reuse — should fail
    const socket2 = createMockSocket();
    identify(socket2, 'Bob', { inviteCode: ic.code });
    expect(getMessageByAction(socket2, 'authRequired')).toBeDefined();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Token revocation
// ═══════════════════════════════════════════════════════════════════════════════

describe('Token revocation', () => {
  beforeEach(() => {
    setPrivateMode(true);
    setServerPassphrase('poker123');
  });

  test('revoke player tokens → must re-auth', () => {
    const socket1 = createMockSocket();
    identify(socket1, 'Alice', { serverPassphrase: 'poker123' });
    const identified1 = getMessageByAction(socket1, 'identified');
    const authToken = identified1.payload.authToken;
    const playerId = identified1.payload.playerId;

    // Revoke
    revokeAuthTokensForPlayer(playerId);

    // Try to reconnect with old auth token
    const socket2 = createMockSocket();
    identify(socket2, 'Alice', { authToken, reconnectToken: identified1.payload.reconnectToken });
    expect(getMessageByAction(socket2, 'authRequired')).toBeDefined();
  });

  test('revoke ALL tokens → all players must re-auth', () => {
    // Two players authenticate
    const socketA = createMockSocket();
    identify(socketA, 'Alice', { serverPassphrase: 'poker123' });
    const idA = getMessageByAction(socketA, 'identified');

    const socketB = createMockSocket();
    identify(socketB, 'Bob', { serverPassphrase: 'poker123' });
    const idB = getMessageByAction(socketB, 'identified');

    // Revoke all
    revokeAllAuthTokens();

    // Both tokens should fail
    const socketA2 = createMockSocket();
    identify(socketA2, 'Alice', {
      authToken: idA.payload.authToken,
      reconnectToken: idA.payload.reconnectToken,
    });
    expect(getMessageByAction(socketA2, 'authRequired')).toBeDefined();

    const socketB2 = createMockSocket();
    identify(socketB2, 'Bob', {
      authToken: idB.payload.authToken,
      reconnectToken: idB.payload.reconnectToken,
    });
    expect(getMessageByAction(socketB2, 'authRequired')).toBeDefined();
  });
});
