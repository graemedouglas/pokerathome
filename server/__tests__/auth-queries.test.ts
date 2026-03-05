/**
 * Unit tests for auth DB queries (server_settings, auth_tokens,
 * player_passphrases, invite_codes).
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

import {
  getSetting,
  setSetting,
  deleteSetting,
  createAuthToken,
  getAuthToken,
  deleteAuthTokensByPlayer,
  deleteAllAuthTokens,
  createPlayerPassphrase,
  listPlayerPassphrases,
  getPlayerPassphraseByPassphrase,
  markPlayerPassphraseUsed,
  revokePlayerPassphrase,
  createInviteCode,
  listInviteCodes,
  getInviteCodeByCode,
  markInviteCodeUsed,
  revokeInviteCode,
  generateShortCode,
} from '../src/db/auth-queries';

beforeAll(() => {
  testDb = new Database(':memory:');
  testDb.pragma('journal_mode = WAL');
  testDb.pragma('foreign_keys = ON');
  testDb.exec(schema);

  // Create a test player and game for FK references
  testDb.exec(`INSERT INTO players (id, display_name, reconnect_token) VALUES ('player-1', 'Test', 'token-1')`);
  testDb.exec(`INSERT INTO games (id, name, small_blind, big_blind) VALUES ('game-1', 'Test Game', 5, 10)`);
});

afterAll(() => {
  testDb?.close();
});

// ═══════════════════════════════════════════════════════════════════════════════

describe('generateShortCode', () => {
  test('produces 6-char uppercase hex string', () => {
    const code = generateShortCode();
    expect(code).toHaveLength(6);
    expect(code).toMatch(/^[0-9A-F]{6}$/);
  });

  test('generates unique codes', () => {
    const codes = new Set(Array.from({ length: 100 }, () => generateShortCode()));
    expect(codes.size).toBeGreaterThan(90);
  });
});

describe('server_settings', () => {
  test('getSetting returns null for missing key', () => {
    expect(getSetting('nonexistent')).toBeNull();
  });

  test('setSetting and getSetting round-trip', () => {
    setSetting('test_key', 'test_value');
    expect(getSetting('test_key')).toBe('test_value');
  });

  test('setSetting upserts on conflict', () => {
    setSetting('test_key', 'value_1');
    setSetting('test_key', 'value_2');
    expect(getSetting('test_key')).toBe('value_2');
  });

  test('deleteSetting removes key', () => {
    setSetting('to_delete', 'x');
    deleteSetting('to_delete');
    expect(getSetting('to_delete')).toBeNull();
  });
});

describe('auth_tokens', () => {
  test('createAuthToken and getAuthToken round-trip', () => {
    const token = createAuthToken('player-1', 'server_passphrase');
    expect(typeof token).toBe('string');
    expect(token.length).toBeGreaterThan(0);

    const row = getAuthToken(token);
    expect(row).toBeDefined();
    expect(row!.player_id).toBe('player-1');
    expect(row!.auth_method).toBe('server_passphrase');
  });

  test('getAuthToken returns undefined for unknown token', () => {
    expect(getAuthToken('nonexistent-token')).toBeUndefined();
  });

  test('deleteAuthTokensByPlayer removes tokens', () => {
    const token = createAuthToken('player-1', 'test');
    expect(getAuthToken(token)).toBeDefined();

    deleteAuthTokensByPlayer('player-1');
    expect(getAuthToken(token)).toBeUndefined();
  });

  test('deleteAllAuthTokens removes everything', () => {
    const t1 = createAuthToken('player-1', 'a');
    expect(getAuthToken(t1)).toBeDefined();

    deleteAllAuthTokens();
    expect(getAuthToken(t1)).toBeUndefined();
  });
});

describe('player_passphrases', () => {
  test('createPlayerPassphrase generates a passphrase', () => {
    const row = createPlayerPassphrase('Alice');
    expect(row.id).toBeDefined();
    expect(row.passphrase).toHaveLength(6);
    expect(row.label).toBe('Alice');
    expect(row.used_by_player_id).toBeNull();
    expect(row.revoked).toBe(0);
  });

  test('createPlayerPassphrase without label', () => {
    const row = createPlayerPassphrase();
    expect(row.label).toBeNull();
  });

  test('listPlayerPassphrases returns all', () => {
    const list = listPlayerPassphrases();
    expect(list.length).toBeGreaterThanOrEqual(2);
  });

  test('getPlayerPassphraseByPassphrase looks up by value', () => {
    const created = createPlayerPassphrase('Lookup Test');
    const found = getPlayerPassphraseByPassphrase(created.passphrase);
    expect(found).toBeDefined();
    expect(found!.id).toBe(created.id);
  });

  test('markPlayerPassphraseUsed updates fields', () => {
    const created = createPlayerPassphrase('Use Test');
    markPlayerPassphraseUsed(created.id, 'player-1');
    const found = getPlayerPassphraseByPassphrase(created.passphrase);
    expect(found!.used_by_player_id).toBe('player-1');
    expect(found!.used_at).not.toBeNull();
  });

  test('revokePlayerPassphrase sets revoked flag', () => {
    const created = createPlayerPassphrase('Revoke Test');
    revokePlayerPassphrase(created.id);
    const found = getPlayerPassphraseByPassphrase(created.passphrase);
    expect(found!.revoked).toBe(1);
  });
});

describe('invite_codes', () => {
  test('createInviteCode generates a code', () => {
    const row = createInviteCode('game-1', 'Bob');
    expect(row.id).toBeDefined();
    expect(row.code).toHaveLength(6);
    expect(row.game_id).toBe('game-1');
    expect(row.label).toBe('Bob');
    expect(row.used_by_player_id).toBeNull();
    expect(row.revoked).toBe(0);
  });

  test('listInviteCodes returns all', () => {
    const list = listInviteCodes();
    expect(list.length).toBeGreaterThanOrEqual(1);
  });

  test('listInviteCodes filters by gameId', () => {
    const list = listInviteCodes('game-1');
    expect(list.length).toBeGreaterThanOrEqual(1);
    expect(list.every(c => c.game_id === 'game-1')).toBe(true);
  });

  test('getInviteCodeByCode looks up by value', () => {
    const created = createInviteCode('game-1', 'Code Lookup');
    const found = getInviteCodeByCode(created.code);
    expect(found).toBeDefined();
    expect(found!.id).toBe(created.id);
  });

  test('markInviteCodeUsed updates fields', () => {
    const created = createInviteCode('game-1', 'Use Test');
    markInviteCodeUsed(created.id, 'player-1');
    const found = getInviteCodeByCode(created.code);
    expect(found!.used_by_player_id).toBe('player-1');
    expect(found!.used_at).not.toBeNull();
  });

  test('revokeInviteCode sets revoked flag', () => {
    const created = createInviteCode('game-1', 'Revoke Test');
    revokeInviteCode(created.id);
    const found = getInviteCodeByCode(created.code);
    expect(found!.revoked).toBe(1);
  });
});
