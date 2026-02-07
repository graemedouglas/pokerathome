import { v4 as uuidv4 } from 'uuid';
import { getDb } from './index.js';

// ─── Row types (DB shapes) ─────────────────────────────────────────────────────

export interface PlayerRow {
  id: string;
  display_name: string;
  reconnect_token: string;
  created_at: string;
}

export interface GameRow {
  id: string;
  name: string;
  game_type: string;
  status: string;
  small_blind: number;
  big_blind: number;
  max_players: number;
  starting_stack: number;
  created_at: string;
}

export interface GamePlayerRow {
  game_id: string;
  player_id: string;
  seat_index: number;
  role: string;
  buy_in: number;
}

export interface HandHistoryRow {
  id: string;
  game_id: string;
  hand_number: number;
  events_json: string;
  winners_json: string;
  created_at: string;
}

export interface GameSnapshotRow {
  game_id: string;
  state_json: string;
  updated_at: string;
}

// ─── Player queries ─────────────────────────────────────────────────────────────

export function createPlayer(displayName: string): PlayerRow {
  const db = getDb();
  const id = uuidv4();
  const reconnectToken = uuidv4();
  db.prepare(
    `INSERT INTO players (id, display_name, reconnect_token) VALUES (?, ?, ?)`
  ).run(id, displayName, reconnectToken);
  return { id, display_name: displayName, reconnect_token: reconnectToken, created_at: new Date().toISOString() };
}

export function getPlayerById(id: string): PlayerRow | undefined {
  return getDb().prepare(`SELECT * FROM players WHERE id = ?`).get(id) as PlayerRow | undefined;
}

export function getPlayerByReconnectToken(token: string): PlayerRow | undefined {
  return getDb().prepare(`SELECT * FROM players WHERE reconnect_token = ?`).get(token) as PlayerRow | undefined;
}

export function rotateReconnectToken(playerId: string): string {
  const newToken = uuidv4();
  getDb().prepare(`UPDATE players SET reconnect_token = ? WHERE id = ?`).run(newToken, playerId);
  return newToken;
}

// ─── Game queries ───────────────────────────────────────────────────────────────

export interface CreateGameParams {
  name: string;
  gameType?: string;
  smallBlind: number;
  bigBlind: number;
  maxPlayers?: number;
  startingStack?: number;
}

export function createGame(params: CreateGameParams): GameRow {
  const db = getDb();
  const id = uuidv4();
  const gameType = params.gameType ?? 'cash';
  const maxPlayers = params.maxPlayers ?? 9;
  const startingStack = params.startingStack ?? 1000;

  db.prepare(
    `INSERT INTO games (id, name, game_type, small_blind, big_blind, max_players, starting_stack)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(id, params.name, gameType, params.smallBlind, params.bigBlind, maxPlayers, startingStack);

  return getGameById(id)!;
}

export function getGameById(id: string): GameRow | undefined {
  return getDb().prepare(`SELECT * FROM games WHERE id = ?`).get(id) as GameRow | undefined;
}

export function listGames(): GameRow[] {
  return getDb().prepare(`SELECT * FROM games ORDER BY created_at DESC`).all() as GameRow[];
}

export function listActiveGames(): GameRow[] {
  return getDb().prepare(
    `SELECT * FROM games WHERE status IN ('waiting', 'in_progress') ORDER BY created_at DESC`
  ).all() as GameRow[];
}

export function updateGameStatus(gameId: string, status: string): void {
  getDb().prepare(`UPDATE games SET status = ? WHERE id = ?`).run(status, gameId);
}

export function deleteGame(gameId: string): boolean {
  const result = getDb().prepare(`DELETE FROM games WHERE id = ? AND status = 'waiting'`).run(gameId);
  return result.changes > 0;
}

// ─── Game player queries ────────────────────────────────────────────────────────

export function addGamePlayer(
  gameId: string,
  playerId: string,
  seatIndex: number,
  role: string,
  buyIn: number
): void {
  getDb().prepare(
    `INSERT INTO game_players (game_id, player_id, seat_index, role, buy_in) VALUES (?, ?, ?, ?, ?)`
  ).run(gameId, playerId, seatIndex, role, buyIn);
}

export function getGamePlayers(gameId: string): GamePlayerRow[] {
  return getDb().prepare(
    `SELECT * FROM game_players WHERE game_id = ? ORDER BY seat_index`
  ).all(gameId) as GamePlayerRow[];
}

export function getPlayerGame(playerId: string): GamePlayerRow | undefined {
  return getDb().prepare(
    `SELECT gp.* FROM game_players gp
     JOIN games g ON gp.game_id = g.id
     WHERE gp.player_id = ? AND g.status IN ('waiting', 'in_progress')`
  ).get(playerId) as GamePlayerRow | undefined;
}

export function removeGamePlayer(gameId: string, playerId: string): void {
  getDb().prepare(`DELETE FROM game_players WHERE game_id = ? AND player_id = ?`).run(gameId, playerId);
}

export function getGamePlayerCount(gameId: string): number {
  const row = getDb().prepare(
    `SELECT COUNT(*) as count FROM game_players WHERE game_id = ?`
  ).get(gameId) as { count: number };
  return row.count;
}

// ─── Hand history queries ───────────────────────────────────────────────────────

export function saveHandHistory(
  gameId: string,
  handNumber: number,
  events: unknown[],
  winners: unknown[]
): void {
  getDb().prepare(
    `INSERT INTO hand_history (id, game_id, hand_number, events_json, winners_json) VALUES (?, ?, ?, ?, ?)`
  ).run(uuidv4(), gameId, handNumber, JSON.stringify(events), JSON.stringify(winners));
}

// ─── Game snapshot queries ──────────────────────────────────────────────────────

export function saveGameSnapshot(gameId: string, state: unknown): void {
  getDb().prepare(
    `INSERT OR REPLACE INTO game_snapshots (game_id, state_json, updated_at) VALUES (?, ?, datetime('now'))`
  ).run(gameId, JSON.stringify(state));
}

export function getGameSnapshot(gameId: string): GameSnapshotRow | undefined {
  return getDb().prepare(`SELECT * FROM game_snapshots WHERE game_id = ?`).get(gameId) as GameSnapshotRow | undefined;
}

export function deleteGameSnapshot(gameId: string): void {
  getDb().prepare(`DELETE FROM game_snapshots WHERE game_id = ?`).run(gameId);
}
