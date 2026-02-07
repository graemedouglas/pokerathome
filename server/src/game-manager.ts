/**
 * GameManager — orchestrates active game instances.
 *
 * Bridges the pure game engine with WS sessions, timers, and persistence.
 * Holds active game states in memory. Writes to SQLite on hand completion
 * and periodic snapshots for crash recovery.
 */

import type { FastifyBaseLogger } from 'fastify';
import type { Event, GameListItem, GameState, GameStateUpdatePayload } from '@pokerathome/schema';
import type { SessionManager } from './ws/session.js';
import {
  createInitialState,
  addPlayer,
  removePlayer as engineRemovePlayer,
  setPlayerReady,
  setPlayerConnected as engineSetConnected,
  startHand,
  processAction,
  toClientGameState,
  buildGameStatePayload,
  type EngineState,
  type Transition,
  type GameConfig,
} from './engine/game.js';
import { validateAction } from './engine/action-validator.js';
import {
  getGameById,
  listActiveGames,
  getGamePlayers,
  addGamePlayer,
  removeGamePlayer,
  getGamePlayerCount,
  updateGameStatus,
  saveHandHistory,
  saveGameSnapshot,
  deleteGameSnapshot,
  type GameRow,
} from './db/queries.js';
import { config } from './config.js';

interface ActiveGame {
  state: EngineState;
  actionTimer: ReturnType<typeof setTimeout> | null;
  warningTimers: ReturnType<typeof setTimeout>[];
}

interface ActionResult {
  ok: boolean;
  errorCode?: string;
  errorMessage?: string;
}

interface JoinResult {
  ok: boolean;
  errorCode?: string;
  errorMessage?: string;
  gameState?: GameState;
  joinEvent?: Event;
}

export class GameManager {
  private activeGames = new Map<string, ActiveGame>();

  constructor(private logger: FastifyBaseLogger) {}

  // ─── Game lifecycle ─────────────────────────────────────────────────────────

  /** Load active games from DB on server startup (crash recovery). */
  loadActiveGames(): void {
    const activeRows = listActiveGames();
    for (const row of activeRows) {
      if (row.status === 'in_progress') {
        // TODO: Restore from snapshot if available
        this.logger.warn({ gameId: row.id }, 'In-progress game found on startup — snapshot recovery not yet implemented');
      }
      // For 'waiting' games, just create the engine state
      if (row.status === 'waiting') {
        const state = this.createEngineStateFromRow(row);
        // Re-add existing players
        const players = getGamePlayers(row.id);
        let currentState = state;
        for (const gp of players) {
          try {
            const result = addPlayer(currentState, gp.player_id, gp.player_id, gp.role as 'player' | 'spectator');
            currentState = result.state;
          } catch (err) {
            this.logger.error({ err, gameId: row.id, playerId: gp.player_id }, 'Failed to restore player');
          }
        }
        this.activeGames.set(row.id, { state: currentState, actionTimer: null, warningTimers: [] });
        this.logger.info({ gameId: row.id, playerCount: players.length }, 'Loaded waiting game');
      }
    }
  }

  private createEngineStateFromRow(row: GameRow): EngineState {
    return createInitialState({
      gameId: row.id,
      gameName: row.name,
      gameType: row.game_type as 'cash' | 'tournament',
      smallBlindAmount: row.small_blind,
      bigBlindAmount: row.big_blind,
      maxPlayers: row.max_players,
      startingStack: row.starting_stack,
    });
  }

  /** Register a game from the DB into the active games map. */
  activateGame(gameId: string): void {
    const row = getGameById(gameId);
    if (!row) throw new Error(`Game ${gameId} not found`);
    if (this.activeGames.has(gameId)) return;

    const state = this.createEngineStateFromRow(row);
    this.activeGames.set(gameId, { state, actionTimer: null, warningTimers: [] });
    this.logger.info({ gameId }, 'Game activated');
  }

  // ─── Game list ──────────────────────────────────────────────────────────────

  getGameList(): GameListItem[] {
    const rows = listActiveGames();
    return rows.map((row) => ({
      gameId: row.id,
      name: row.name,
      gameType: row.game_type as 'cash' | 'tournament',
      playerCount: getGamePlayerCount(row.id),
      maxPlayers: row.max_players,
      smallBlindAmount: row.small_blind,
      bigBlindAmount: row.big_blind,
      status: row.status as 'waiting' | 'in_progress',
    }));
  }

  // ─── Join / Leave ───────────────────────────────────────────────────────────

  joinGame(gameId: string, playerId: string, displayName: string): JoinResult {
    const row = getGameById(gameId);
    if (!row) return { ok: false, errorCode: 'GAME_NOT_FOUND', errorMessage: 'Game not found' };

    const currentCount = getGamePlayerCount(gameId);
    if (currentCount >= row.max_players) {
      return { ok: false, errorCode: 'GAME_FULL', errorMessage: 'Game is full' };
    }

    // Ensure game is active in memory
    if (!this.activeGames.has(gameId)) {
      this.activateGame(gameId);
    }

    const active = this.activeGames.get(gameId)!;

    try {
      const result = addPlayer(active.state, playerId, displayName);
      active.state = result.state;

      // Persist to DB
      addGamePlayer(gameId, playerId, result.seatIndex, 'player', row.starting_stack);

      const clientState = toClientGameState(active.state, playerId);
      return { ok: true, gameState: clientState, joinEvent: result.event };
    } catch (err) {
      this.logger.error({ err, gameId, playerId }, 'Failed to join game');
      return { ok: false, errorCode: 'GAME_FULL', errorMessage: 'Could not join game' };
    }
  }

  removePlayer(gameId: string, playerId: string, sessions: SessionManager): void {
    const active = this.activeGames.get(gameId);
    if (!active) return;

    const result = engineRemovePlayer(active.state, playerId);
    active.state = result.state;

    // Persist
    removeGamePlayer(gameId, playerId);

    // Broadcast PLAYER_LEFT
    sessions.broadcastPersonalized(gameId, (viewerId) => ({
      action: 'gameState',
      payload: buildGameStatePayload(active.state, result.event, viewerId),
    }));

    // If game is in progress and not enough players, end it
    const activePlayers = active.state.players.filter((p) => p.role === 'player' && p.stack > 0);
    if (active.state.handInProgress && activePlayers.length < 2) {
      this.endGame(gameId, 'insufficient_players', sessions);
    }
  }

  // ─── Ready / Start ─────────────────────────────────────────────────────────

  setPlayerReady(gameId: string, playerId: string): void {
    const active = this.activeGames.get(gameId);
    if (!active) return;
    active.state = setPlayerReady(active.state, playerId);
  }

  /** Try to auto-start the game if enough players are ready. */
  tryStartGame(gameId: string, sessions: SessionManager): void {
    const active = this.activeGames.get(gameId);
    if (!active) return;
    if (active.state.handInProgress) return;

    const readyPlayers = active.state.players.filter(
      (p) => p.role === 'player' && p.isReady && p.stack > 0
    );

    if (readyPlayers.length >= config.MIN_PLAYERS_TO_START) {
      this.startNextHand(gameId, sessions);
    }
  }

  /** Force-start a game (admin action). */
  forceStartGame(gameId: string, sessions: SessionManager): boolean {
    const active = this.activeGames.get(gameId);
    if (!active) return false;
    if (active.state.handInProgress) return false;

    const players = active.state.players.filter((p) => p.role === 'player' && p.stack > 0);
    if (players.length < 2) return false;

    // Mark all players as ready
    for (const p of players) {
      active.state = setPlayerReady(active.state, p.id);
    }

    updateGameStatus(gameId, 'in_progress');
    this.startNextHand(gameId, sessions);
    return true;
  }

  // ─── Hand management ────────────────────────────────────────────────────────

  private startNextHand(gameId: string, sessions: SessionManager): void {
    const active = this.activeGames.get(gameId);
    if (!active) return;

    const playersWithChips = active.state.players.filter(
      (p) => p.role === 'player' && p.stack > 0
    );

    if (playersWithChips.length < 2) {
      this.endGame(gameId, 'completed', sessions);
      return;
    }

    try {
      const transitions = startHand(active.state);
      this.applyTransitions(gameId, transitions, sessions);
    } catch (err) {
      this.logger.error({ err, gameId }, 'Failed to start hand');
    }
  }

  // ─── Action handling ────────────────────────────────────────────────────────

  handleAction(
    gameId: string,
    playerId: string,
    handNumber: number,
    actionType: string,
    sessions: SessionManager,
    actionAmount?: number
  ): ActionResult {
    const active = this.activeGames.get(gameId);
    if (!active) return { ok: false, errorCode: 'GAME_NOT_FOUND', errorMessage: 'Game not found' };
    if (!active.state.handInProgress) {
      return { ok: false, errorCode: 'INVALID_ACTION', errorMessage: 'No hand in progress' };
    }
    if (active.state.activePlayerId !== playerId) {
      return { ok: false, errorCode: 'OUT_OF_TURN', errorMessage: 'Not your turn' };
    }
    if (active.state.handNumber !== handNumber) {
      return { ok: false, errorCode: 'INVALID_ACTION', errorMessage: 'Stale hand number' };
    }

    // Validate
    const validationError = validateAction(active.state, playerId, actionType, actionAmount);
    if (validationError) {
      return { ok: false, errorCode: validationError.code, errorMessage: validationError.message };
    }

    // Cancel action timer and process
    this.clearTimers(active);
    const transitions = processAction(active.state, playerId, actionType, actionAmount);
    this.applyTransitions(gameId, transitions, sessions);

    return { ok: true };
  }

  // ─── Reveal cards ───────────────────────────────────────────────────────────

  handleRevealCards(
    gameId: string,
    playerId: string,
    handNumber: number
  ): ActionResult {
    const active = this.activeGames.get(gameId);
    if (!active) return { ok: false, errorCode: 'GAME_NOT_FOUND', errorMessage: 'Game not found' };
    if (active.state.handNumber !== handNumber) {
      return { ok: false, errorCode: 'INVALID_ACTION', errorMessage: 'Wrong hand number' };
    }

    // Only allow reveals after showdown or when the hand has ended
    if (active.state.handInProgress && active.state.stage !== 'SHOWDOWN') {
      return { ok: false, errorCode: 'INVALID_ACTION', errorMessage: 'Can only reveal cards after showdown' };
    }

    const player = active.state.players.find((p) => p.id === playerId);
    if (!player || !player.holeCards) {
      return { ok: false, errorCode: 'INVALID_ACTION', errorMessage: 'No cards to reveal' };
    }

    // Store that this player revealed (the event broadcast happens separately)
    return { ok: true };
  }

  broadcastRevealCards(
    gameId: string,
    playerId: string,
    sessions: SessionManager
  ): void {
    const active = this.activeGames.get(gameId);
    if (!active) return;

    const player = active.state.players.find((p) => p.id === playerId);
    if (!player?.holeCards) return;

    const event: Event = {
      type: 'PLAYER_REVEALED',
      playerId,
      holeCards: player.holeCards,
    };

    sessions.broadcastPersonalized(gameId, (viewerId) => ({
      action: 'gameState',
      payload: buildGameStatePayload(active.state, event, viewerId),
    }));
  }

  // ─── Reconnection ──────────────────────────────────────────────────────────

  getReconnectState(playerId: string, gameId: string): GameStateUpdatePayload | undefined {
    const active = this.activeGames.get(gameId);
    if (!active) return undefined;

    const lastEvent = active.state.handEvents[active.state.handEvents.length - 1];
    if (!lastEvent) return undefined;

    return buildGameStatePayload(
      active.state,
      lastEvent,
      playerId,
      active.state.activePlayerId === playerId ? config.ACTION_TIMEOUT_MS : undefined
    );
  }

  setPlayerConnected(gameId: string, playerId: string, connected: boolean): void {
    const active = this.activeGames.get(gameId);
    if (!active) return;
    active.state = engineSetConnected(active.state, playerId, connected);
  }

  // ─── Transition broadcasting ────────────────────────────────────────────────

  private applyTransitions(
    gameId: string,
    transitions: Transition[],
    sessions: SessionManager
  ): void {
    const active = this.activeGames.get(gameId);
    if (!active) return;

    for (const transition of transitions) {
      active.state = transition.state;

      // Broadcast personalized state to all players in the game
      sessions.broadcastPersonalized(gameId, (viewerId) => ({
        action: 'gameState',
        payload: buildGameStatePayload(
          active.state,
          transition.event,
          viewerId,
          config.ACTION_TIMEOUT_MS
        ),
      }));
    }

    // After all transitions, check state
    if (!active.state.handInProgress) {
      // Hand ended — save history and snapshot
      this.onHandEnd(gameId, sessions);
    } else if (active.state.activePlayerId) {
      // Start action timer for the active player
      this.startActionTimer(gameId, active.state.activePlayerId, sessions);
    }

    // Save snapshot
    saveGameSnapshot(gameId, active.state);
  }

  private onHandEnd(gameId: string, sessions: SessionManager): void {
    const active = this.activeGames.get(gameId);
    if (!active) return;

    // Save hand history
    const handEndEvent = active.state.handEvents.find((e) => e.type === 'HAND_END');
    const winners = handEndEvent && 'winners' in handEndEvent ? handEndEvent.winners : [];
    saveHandHistory(gameId, active.state.handNumber, active.state.handEvents, winners);

    this.logger.info(
      { gameId, handNumber: active.state.handNumber, winners: winners.length },
      'Hand completed'
    );

    // Check if game should continue
    const playersWithChips = active.state.players.filter(
      (p) => p.role === 'player' && p.stack > 0
    );

    if (playersWithChips.length < 2) {
      this.endGame(gameId, 'completed', sessions);
      return;
    }

    // Schedule next hand after delay
    setTimeout(() => {
      this.startNextHand(gameId, sessions);
    }, config.HAND_DELAY_MS);
  }

  // ─── Action timer ──────────────────────────────────────────────────────────

  private startActionTimer(
    gameId: string,
    playerId: string,
    sessions: SessionManager
  ): void {
    const active = this.activeGames.get(gameId);
    if (!active) return;

    this.clearTimers(active);

    const timeoutMs = config.ACTION_TIMEOUT_MS;

    // Time warnings at 50% and 80%
    const warn50 = setTimeout(() => {
      sessions.send(playerId, {
        action: 'timeWarning',
        payload: { remainingMs: Math.round(timeoutMs * 0.5) },
      });
    }, timeoutMs * 0.5);

    const warn80 = setTimeout(() => {
      sessions.send(playerId, {
        action: 'timeWarning',
        payload: { remainingMs: Math.round(timeoutMs * 0.2) },
      });
    }, timeoutMs * 0.8);

    active.warningTimers = [warn50, warn80];

    // Timeout: apply default action (check if possible, else fold)
    active.actionTimer = setTimeout(() => {
      this.handleTimeout(gameId, playerId, sessions);
    }, timeoutMs);
  }

  private handleTimeout(gameId: string, playerId: string, sessions: SessionManager): void {
    const active = this.activeGames.get(gameId);
    if (!active || active.state.activePlayerId !== playerId) return;

    // Determine default action: check if possible, else fold
    const player = active.state.players.find((p) => p.id === playerId);
    if (!player) return;

    const canCheck = player.bet >= active.state.currentBet;
    const defaultType = canCheck ? 'CHECK' : 'FOLD';

    this.logger.info({ gameId, playerId, defaultAction: defaultType }, 'Player timed out');

    // Emit PLAYER_TIMEOUT event
    const timeoutEvent: Event = {
      type: 'PLAYER_TIMEOUT',
      playerId,
      defaultAction: { type: defaultType },
    };

    // Broadcast the timeout event
    sessions.broadcastPersonalized(gameId, (viewerId) => ({
      action: 'gameState',
      payload: buildGameStatePayload(active.state, timeoutEvent, viewerId),
    }));

    // Then process the default action
    const transitions = processAction(active.state, playerId, defaultType);
    this.applyTransitions(gameId, transitions, sessions);
  }

  private clearTimers(active: ActiveGame): void {
    if (active.actionTimer) {
      clearTimeout(active.actionTimer);
      active.actionTimer = null;
    }
    for (const timer of active.warningTimers) {
      clearTimeout(timer);
    }
    active.warningTimers = [];
  }

  // ─── Game end ──────────────────────────────────────────────────────────────

  private endGame(
    gameId: string,
    reason: 'completed' | 'cancelled' | 'insufficient_players',
    sessions: SessionManager
  ): void {
    const active = this.activeGames.get(gameId);
    if (!active) return;

    this.clearTimers(active);

    // Build standings
    const standings = [...active.state.players]
      .filter((p) => p.role === 'player')
      .sort((a, b) => b.stack - a.stack)
      .map((p, i) => ({
        playerId: p.id,
        displayName: p.displayName,
        finalStack: p.stack,
        rank: i + 1,
      }));

    sessions.broadcast(gameId, {
      action: 'gameOver',
      payload: {
        gameId,
        reason,
        standings,
      },
    });

    // Update DB
    updateGameStatus(gameId, 'completed');
    deleteGameSnapshot(gameId);

    // Clean up
    this.activeGames.delete(gameId);
    this.logger.info({ gameId, reason }, 'Game ended');
  }

  // ─── State query helpers ────────────────────────────────────────────────────

  buildStatePayload(
    gameId: string,
    event: Event,
    viewerPlayerId: string
  ): GameStateUpdatePayload | undefined {
    const active = this.activeGames.get(gameId);
    if (!active) return undefined;
    return buildGameStatePayload(active.state, event, viewerPlayerId, config.ACTION_TIMEOUT_MS);
  }

  isGameActive(gameId: string): boolean {
    return this.activeGames.has(gameId);
  }

  getActiveGameState(gameId: string): EngineState | undefined {
    return this.activeGames.get(gameId)?.state;
  }
}
