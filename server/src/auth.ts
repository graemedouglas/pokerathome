/**
 * Core authentication logic. All auth validation is centralized here.
 *
 * Auth layers (OR'd — any single credential is sufficient):
 *   1. Stored auth token (fast path for returning players)
 *   2. Server passphrase (shared secret)
 *   3. Per-player one-time passphrase (admin-generated)
 *   4. Per-table invite code (admin-generated, auto-routes to game)
 *
 * When private mode is OFF and no credentials are provided, access is allowed.
 * When private mode is ON, at least one credential must succeed.
 */

import {
  getSetting,
  setSetting,
  deleteSetting,
  getAuthToken,
  createAuthToken,
  deleteAuthTokensByPlayer,
  deleteAllAuthTokens,
  getPlayerPassphraseByPassphrase,
  markPlayerPassphraseUsed,
  getInviteCodeByCode,
  markInviteCodeUsed,
} from './db/auth-queries.js';

// ─── Types ──────────────────────────────────────────────────────────────────────

export type AuthMethod = 'server_passphrase' | 'player_passphrase' | 'invite_code';

export interface AuthResult {
  authenticated: boolean;
  authToken?: string;
  autoJoinGameId?: string;
  availableMethods?: AuthMethod[];
  error?: string;
}

export interface ValidateAuthParams {
  authToken?: string;
  serverPassphrase?: string;
  playerPassphrase?: string;
  inviteCode?: string;
  playerId: string;
}

// ─── Settings accessors ─────────────────────────────────────────────────────────

export function isPrivateMode(): boolean {
  return getSetting('private_mode') === 'true';
}

export function setPrivateMode(enabled: boolean): void {
  setSetting('private_mode', enabled ? 'true' : 'false');
}

export function getServerPassphrase(): string | null {
  return getSetting('server_passphrase');
}

export function setServerPassphrase(passphrase: string | null): void {
  if (passphrase === null || passphrase === '') {
    deleteSetting('server_passphrase');
  } else {
    setSetting('server_passphrase', passphrase);
  }
}

// ─── Token revocation ───────────────────────────────────────────────────────────

export function revokeAuthTokensForPlayer(playerId: string): void {
  deleteAuthTokensByPlayer(playerId);
}

export function revokeAllAuthTokens(): void {
  deleteAllAuthTokens();
}

// ─── Core validation ────────────────────────────────────────────────────────────

/**
 * Determine available auth methods based on current server config.
 */
function getAvailableMethods(): AuthMethod[] {
  const methods: AuthMethod[] = [];
  if (getServerPassphrase()) {
    methods.push('server_passphrase');
  }
  // Player passphrases and invite codes are always available as methods
  // when private mode is on (the admin may have generated some)
  methods.push('player_passphrase');
  methods.push('invite_code');
  return methods;
}

/**
 * Validate authentication credentials. Returns an AuthResult.
 *
 * Auth layers are OR'd — any single successful credential is enough.
 * Invite codes and player passphrases bypass the server passphrase.
 */
export function validateAuth(params: ValidateAuthParams): AuthResult {
  const { playerId } = params;
  const privateMode = isPrivateMode();

  // Fast path: valid stored auth token
  if (params.authToken) {
    const row = getAuthToken(params.authToken);
    if (row && row.player_id === playerId) {
      return { authenticated: true };
    }
    // Invalid/mismatched token — fall through to try other credentials
  }

  // Try invite code (bypasses server passphrase)
  if (params.inviteCode) {
    const row = getInviteCodeByCode(params.inviteCode);
    if (row && !row.revoked && !row.used_by_player_id) {
      markInviteCodeUsed(row.id, playerId);
      const authToken = createAuthToken(playerId, 'invite_code', row.id);
      return { authenticated: true, authToken, autoJoinGameId: row.game_id };
    }
    // Invalid/used/revoked invite code — fall through
  }

  // Try player passphrase (bypasses server passphrase)
  if (params.playerPassphrase) {
    const row = getPlayerPassphraseByPassphrase(params.playerPassphrase);
    if (row && !row.revoked && !row.used_by_player_id) {
      markPlayerPassphraseUsed(row.id, playerId);
      const authToken = createAuthToken(playerId, 'player_passphrase', row.id);
      return { authenticated: true, authToken };
    }
    // Invalid/used/revoked passphrase — fall through
  }

  // Try server passphrase
  if (params.serverPassphrase) {
    const expected = getServerPassphrase();
    if (expected && params.serverPassphrase === expected) {
      const authToken = createAuthToken(playerId, 'server_passphrase');
      return { authenticated: true, authToken };
    }
    // Wrong passphrase — fall through
  }

  // No credentials succeeded
  if (!privateMode) {
    // Not private — allow access without auth
    return { authenticated: true };
  }

  // Private mode — reject
  return {
    authenticated: false,
    availableMethods: getAvailableMethods(),
    error: 'Authentication required. The server is in private mode.',
  };
}
