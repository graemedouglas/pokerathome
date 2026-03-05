/**
 * Unit tests for the core auth validation logic.
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

import {
  validateAuth,
  isPrivateMode,
  setPrivateMode,
  getServerPassphrase,
  setServerPassphrase,
  revokeAuthTokensForPlayer,
  revokeAllAuthTokens,
} from '../src/auth';
import {
  createPlayerPassphrase,
  createInviteCode,
  revokePlayerPassphrase,
  revokeInviteCode,
} from '../src/db/auth-queries';

beforeAll(() => {
  testDb = new Database(':memory:');
  testDb.pragma('journal_mode = WAL');
  testDb.pragma('foreign_keys = ON');
  testDb.exec(schema);

  // Create test fixtures
  testDb.exec(`INSERT INTO players (id, display_name, reconnect_token) VALUES ('p1', 'Alice', 'rt1')`);
  testDb.exec(`INSERT INTO players (id, display_name, reconnect_token) VALUES ('p2', 'Bob', 'rt2')`);
  testDb.exec(`INSERT INTO games (id, name, small_blind, big_blind) VALUES ('g1', 'Test Game', 5, 10)`);
});

afterAll(() => {
  testDb?.close();
});

afterEach(() => {
  setPrivateMode(false);
  setServerPassphrase(null);
  testDb.exec(`DELETE FROM auth_tokens`);
});

// ═══════════════════════════════════════════════════════════════════════════════

describe('validateAuth — open mode (private OFF)', () => {
  test('no credentials needed → authenticated', () => {
    const result = validateAuth({ playerId: 'p1' });
    expect(result.authenticated).toBe(true);
  });

  test('server passphrase set but private mode off → still passes without credentials', () => {
    setServerPassphrase('secret123');
    const result = validateAuth({ playerId: 'p1' });
    expect(result.authenticated).toBe(true);
  });
});

describe('validateAuth — private mode', () => {
  beforeEach(() => {
    setPrivateMode(true);
  });

  test('no credentials → rejected with available methods', () => {
    const result = validateAuth({ playerId: 'p1' });
    expect(result.authenticated).toBe(false);
    expect(result.availableMethods).toBeDefined();
    expect(result.error).toContain('Authentication required');
  });

  test('server passphrase correct → authenticated + auth token issued', () => {
    setServerPassphrase('secret123');
    const result = validateAuth({ playerId: 'p1', serverPassphrase: 'secret123' });
    expect(result.authenticated).toBe(true);
    expect(result.authToken).toBeDefined();
  });

  test('server passphrase wrong → rejected', () => {
    setServerPassphrase('secret123');
    const result = validateAuth({ playerId: 'p1', serverPassphrase: 'wrong' });
    expect(result.authenticated).toBe(false);
  });
});

describe('validateAuth — player passphrases', () => {
  beforeEach(() => {
    setPrivateMode(true);
  });

  test('valid player passphrase → authenticated + marked used', () => {
    const pp = createPlayerPassphrase('Alice');
    const result = validateAuth({ playerId: 'p1', playerPassphrase: pp.passphrase });
    expect(result.authenticated).toBe(true);
    expect(result.authToken).toBeDefined();
  });

  test('already-used passphrase → rejected', () => {
    const pp = createPlayerPassphrase('Bob');
    validateAuth({ playerId: 'p1', playerPassphrase: pp.passphrase });
    const result = validateAuth({ playerId: 'p2', playerPassphrase: pp.passphrase });
    expect(result.authenticated).toBe(false);
  });

  test('revoked passphrase → rejected', () => {
    const pp = createPlayerPassphrase('Revoked');
    revokePlayerPassphrase(pp.id);
    const result = validateAuth({ playerId: 'p1', playerPassphrase: pp.passphrase });
    expect(result.authenticated).toBe(false);
  });

  test('player passphrase bypasses server passphrase', () => {
    setServerPassphrase('secret123');
    const pp = createPlayerPassphrase('Bypass');
    const result = validateAuth({ playerId: 'p1', playerPassphrase: pp.passphrase });
    expect(result.authenticated).toBe(true);
  });
});

describe('validateAuth — invite codes', () => {
  beforeEach(() => {
    setPrivateMode(true);
  });

  test('valid invite code → authenticated + autoJoinGameId', () => {
    const ic = createInviteCode('g1', 'Test');
    const result = validateAuth({ playerId: 'p1', inviteCode: ic.code });
    expect(result.authenticated).toBe(true);
    expect(result.authToken).toBeDefined();
    expect(result.autoJoinGameId).toBe('g1');
  });

  test('already-used invite code → rejected', () => {
    const ic = createInviteCode('g1', 'Used');
    validateAuth({ playerId: 'p1', inviteCode: ic.code });
    const result = validateAuth({ playerId: 'p2', inviteCode: ic.code });
    expect(result.authenticated).toBe(false);
  });

  test('revoked invite code → rejected', () => {
    const ic = createInviteCode('g1', 'Revoked');
    revokeInviteCode(ic.id);
    const result = validateAuth({ playerId: 'p1', inviteCode: ic.code });
    expect(result.authenticated).toBe(false);
  });

  test('invite code bypasses server passphrase', () => {
    setServerPassphrase('secret123');
    const ic = createInviteCode('g1', 'Bypass');
    const result = validateAuth({ playerId: 'p1', inviteCode: ic.code });
    expect(result.authenticated).toBe(true);
    expect(result.autoJoinGameId).toBe('g1');
  });
});

describe('validateAuth — auth tokens', () => {
  beforeEach(() => {
    setPrivateMode(true);
  });

  test('valid auth token → fast-path authenticated', () => {
    setServerPassphrase('secret123');
    const initial = validateAuth({ playerId: 'p1', serverPassphrase: 'secret123' });
    expect(initial.authToken).toBeDefined();

    const result = validateAuth({ playerId: 'p1', authToken: initial.authToken! });
    expect(result.authenticated).toBe(true);
    expect(result.authToken).toBeUndefined();
  });

  test('auth token for wrong player → rejected', () => {
    setServerPassphrase('secret123');
    const initial = validateAuth({ playerId: 'p1', serverPassphrase: 'secret123' });

    const result = validateAuth({ playerId: 'p2', authToken: initial.authToken! });
    expect(result.authenticated).toBe(false);
  });

  test('revoked auth token → rejected', () => {
    setServerPassphrase('secret123');
    const initial = validateAuth({ playerId: 'p1', serverPassphrase: 'secret123' });

    revokeAuthTokensForPlayer('p1');
    const result = validateAuth({ playerId: 'p1', authToken: initial.authToken! });
    expect(result.authenticated).toBe(false);
  });

  test('revokeAllAuthTokens invalidates all tokens', () => {
    setServerPassphrase('secret123');
    const t1 = validateAuth({ playerId: 'p1', serverPassphrase: 'secret123' });
    const t2 = validateAuth({ playerId: 'p2', serverPassphrase: 'secret123' });

    revokeAllAuthTokens();

    expect(validateAuth({ playerId: 'p1', authToken: t1.authToken! }).authenticated).toBe(false);
    expect(validateAuth({ playerId: 'p2', authToken: t2.authToken! }).authenticated).toBe(false);
  });
});

describe('settings accessors', () => {
  test('isPrivateMode defaults to false', () => {
    expect(isPrivateMode()).toBe(false);
  });

  test('setPrivateMode toggles', () => {
    setPrivateMode(true);
    expect(isPrivateMode()).toBe(true);
    setPrivateMode(false);
    expect(isPrivateMode()).toBe(false);
  });

  test('getServerPassphrase defaults to null', () => {
    expect(getServerPassphrase()).toBeNull();
  });

  test('setServerPassphrase and clear', () => {
    setServerPassphrase('test');
    expect(getServerPassphrase()).toBe('test');
    setServerPassphrase(null);
    expect(getServerPassphrase()).toBeNull();
  });
});
