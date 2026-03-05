import crypto from 'node:crypto';
import { getDb } from './index.js';

// ─── Row types ──────────────────────────────────────────────────────────────────

export interface AuthTokenRow {
  token: string;
  player_id: string;
  auth_method: string;
  auth_detail: string | null;
  created_at: string;
}

export interface PlayerPassphraseRow {
  id: string;
  passphrase: string;
  label: string | null;
  used_by_player_id: string | null;
  used_at: string | null;
  revoked: number;
  created_at: string;
}

export interface InviteCodeRow {
  id: string;
  code: string;
  game_id: string;
  label: string | null;
  used_by_player_id: string | null;
  used_at: string | null;
  revoked: number;
  created_at: string;
}

// ─── Helpers ────────────────────────────────────────────────────────────────────

/** Generate a human-friendly 6-char uppercase alphanumeric code */
export function generateShortCode(): string {
  return crypto.randomBytes(4).toString('hex').slice(0, 6).toUpperCase();
}

// ─── Server settings ────────────────────────────────────────────────────────────

export function getSetting(key: string): string | null {
  const row = getDb()
    .prepare(`SELECT value FROM server_settings WHERE key = ?`)
    .get(key) as { value: string } | undefined;
  return row?.value ?? null;
}

export function setSetting(key: string, value: string): void {
  getDb()
    .prepare(
      `INSERT INTO server_settings (key, value, updated_at) VALUES (?, ?, datetime('now'))
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`
    )
    .run(key, value);
}

export function deleteSetting(key: string): void {
  getDb().prepare(`DELETE FROM server_settings WHERE key = ?`).run(key);
}

// ─── Auth tokens ────────────────────────────────────────────────────────────────

export function createAuthToken(
  playerId: string,
  method: string,
  detail?: string
): string {
  const token = crypto.randomUUID();
  getDb()
    .prepare(
      `INSERT INTO auth_tokens (token, player_id, auth_method, auth_detail) VALUES (?, ?, ?, ?)`
    )
    .run(token, playerId, method, detail ?? null);
  return token;
}

export function getAuthToken(token: string): AuthTokenRow | undefined {
  return getDb()
    .prepare(`SELECT * FROM auth_tokens WHERE token = ?`)
    .get(token) as AuthTokenRow | undefined;
}

export function deleteAuthTokensByPlayer(playerId: string): void {
  getDb()
    .prepare(`DELETE FROM auth_tokens WHERE player_id = ?`)
    .run(playerId);
}

export function deleteAllAuthTokens(): void {
  getDb().prepare(`DELETE FROM auth_tokens`).run();
}

// ─── Player passphrases ─────────────────────────────────────────────────────────

export function createPlayerPassphrase(label?: string): PlayerPassphraseRow {
  const db = getDb();
  const id = crypto.randomUUID();
  const passphrase = generateShortCode();
  db.prepare(
    `INSERT INTO player_passphrases (id, passphrase, label) VALUES (?, ?, ?)`
  ).run(id, passphrase, label ?? null);
  return db
    .prepare(`SELECT * FROM player_passphrases WHERE id = ?`)
    .get(id) as PlayerPassphraseRow;
}

export function listPlayerPassphrases(): PlayerPassphraseRow[] {
  return getDb()
    .prepare(`SELECT * FROM player_passphrases ORDER BY created_at DESC`)
    .all() as PlayerPassphraseRow[];
}

export function getPlayerPassphraseByPassphrase(
  passphrase: string
): PlayerPassphraseRow | undefined {
  return getDb()
    .prepare(`SELECT * FROM player_passphrases WHERE passphrase = ?`)
    .get(passphrase) as PlayerPassphraseRow | undefined;
}

export function markPlayerPassphraseUsed(
  id: string,
  playerId: string
): void {
  getDb()
    .prepare(
      `UPDATE player_passphrases SET used_by_player_id = ?, used_at = datetime('now') WHERE id = ?`
    )
    .run(playerId, id);
}

export function revokePlayerPassphrase(id: string): void {
  getDb()
    .prepare(`UPDATE player_passphrases SET revoked = 1 WHERE id = ?`)
    .run(id);
}

// ─── Invite codes ───────────────────────────────────────────────────────────────

export function createInviteCode(
  gameId: string,
  label?: string
): InviteCodeRow {
  const db = getDb();
  const id = crypto.randomUUID();
  const code = generateShortCode();
  db.prepare(
    `INSERT INTO invite_codes (id, code, game_id, label) VALUES (?, ?, ?, ?)`
  ).run(id, code, gameId, label ?? null);
  return db
    .prepare(`SELECT * FROM invite_codes WHERE id = ?`)
    .get(id) as InviteCodeRow;
}

export function listInviteCodes(gameId?: string): InviteCodeRow[] {
  if (gameId) {
    return getDb()
      .prepare(
        `SELECT * FROM invite_codes WHERE game_id = ? ORDER BY created_at DESC`
      )
      .all(gameId) as InviteCodeRow[];
  }
  return getDb()
    .prepare(`SELECT * FROM invite_codes ORDER BY created_at DESC`)
    .all() as InviteCodeRow[];
}

export function getInviteCodeByCode(
  code: string
): InviteCodeRow | undefined {
  return getDb()
    .prepare(`SELECT * FROM invite_codes WHERE code = ?`)
    .get(code) as InviteCodeRow | undefined;
}

export function markInviteCodeUsed(id: string, playerId: string): void {
  getDb()
    .prepare(
      `UPDATE invite_codes SET used_by_player_id = ?, used_at = datetime('now') WHERE id = ?`
    )
    .run(playerId, id);
}

export function revokeInviteCode(id: string): void {
  getDb()
    .prepare(`UPDATE invite_codes SET revoked = 1 WHERE id = ?`)
    .run(id);
}
