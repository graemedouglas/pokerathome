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
  cloneState,
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
  updateGameSpectatorVisibility,
  saveHandHistory,
  saveGameSnapshot,
  deleteGameSnapshot,
  type GameRow,
} from './db/queries.js';
import { config } from './config.js';
import { ReplayRecorder } from './replay/recorder.js';
import { saveReplayFile } from './replay/storage.js';

interface ActiveGame {
  state: EngineState;
  actionTimer: ReturnType<typeof setTimeout> | null;
  warningTimers: ReturnType<typeof setTimeout>[];
  riggedDeck: string[] | null;
  previousHandState: EngineState | null; // Track previous hand for delayed spectator view
  spectatorVisibility: string; // Per-game spectator card visibility mode
  recorder: ReplayRecorder | null; // Replay recording
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
  handEvents?: Event[];
}

export class GameManager {
  private activeGames = new Map<string, ActiveGame>();
  private activeBots = new Map<string, Array<{ stop(): void }>>();

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
        this.activeGames.set(row.id, { state: currentState, actionTimer: null, warningTimers: [], riggedDeck: null, previousHandState: null, spectatorVisibility: row.spectator_visibility ?? 'showdown', recorder: new ReplayRecorder(this.createGameConfig(row)) });
        this.logger.info({ gameId: row.id, playerCount: players.length }, 'Loaded waiting game');
      }
    }
  }

  private createGameConfig(row: GameRow): GameConfig {
    return {
      gameId: row.id,
      gameName: row.name,
      gameType: row.game_type as 'cash' | 'tournament',
      smallBlindAmount: row.small_blind,
      bigBlindAmount: row.big_blind,
      maxPlayers: row.max_players,
      startingStack: row.starting_stack,
    };
  }

  private createEngineStateFromRow(row: GameRow): EngineState {
    return createInitialState(this.createGameConfig(row));
  }

  /** Register a game from the DB into the active games map. */
  activateGame(gameId: string): void {
    const row = getGameById(gameId);
    if (!row) throw new Error(`Game ${gameId} not found`);
    if (this.activeGames.has(gameId)) return;

    const state = this.createEngineStateFromRow(row);
    this.activeGames.set(gameId, { state, actionTimer: null, warningTimers: [], riggedDeck: null, previousHandState: null, spectatorVisibility: row.spectator_visibility ?? 'showdown', recorder: new ReplayRecorder(this.createGameConfig(row)) });
    this.logger.info({ gameId }, 'Game activated');
  }

  /** Update spectator visibility mode for a game (persists to DB). */
  setSpectatorVisibility(gameId: string, visibility: string): boolean {
    const active = this.activeGames.get(gameId);
    if (active) active.spectatorVisibility = visibility;
    return updateGameSpectatorVisibility(gameId, visibility);
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

  joinGame(gameId: string, playerId: string, displayName: string, role: 'player' | 'spectator' = 'player'): JoinResult {
    const row = getGameById(gameId);
    if (!row) return { ok: false, errorCode: 'GAME_NOT_FOUND', errorMessage: 'Game not found' };

    // Only enforce capacity for players, not spectators
    if (role !== 'spectator') {
      const currentCount = getGamePlayerCount(gameId);
      if (currentCount >= row.max_players) {
        return { ok: false, errorCode: 'GAME_FULL', errorMessage: 'Game is full' };
      }
    }

    // Ensure game is active in memory
    if (!this.activeGames.has(gameId)) {
      this.activateGame(gameId);
    }

    const active = this.activeGames.get(gameId)!;

    try {
      const result = addPlayer(active.state, playerId, displayName, role);
      active.state = result.state;

      // Record player for replay (only players, not spectators)
      if (role === 'player') {
        active.recorder?.recordPlayer(playerId, displayName, result.seatIndex, role);
      }

      // Persist to DB
      const stack = role === 'spectator' ? 0 : row.starting_stack;
      addGamePlayer(gameId, playerId, result.seatIndex, role, stack);

      const clientState = toClientGameState(
        active.state,
        playerId,
        role === 'spectator' ? active.spectatorVisibility : undefined
      );
      const handEvents = active.state.handInProgress ? [...active.state.handEvents] : undefined;
      this.logger.debug(
        { playerId, role, handInProgress: active.state.handInProgress, handEventsCount: handEvents?.length ?? 0, handEventTypes: handEvents?.map(e => e.type) },
        'joinGame-result',
      );
      return {
        ok: true,
        gameState: clientState,
        joinEvent: result.event,
        handEvents,
      };
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
      payload: buildGameStatePayload(active.state, result.event, viewerId, undefined, active.spectatorVisibility),
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
      updateGameStatus(gameId, 'in_progress');
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
      const deckOverride = active.riggedDeck ?? undefined;
      active.riggedDeck = null;
      const transitions = startHand(active.state, deckOverride);
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
      payload: buildGameStatePayload(active.state, event, viewerId, undefined, active.spectatorVisibility),
    }));
  }

  // ─── Reconnection ──────────────────────────────────────────────────────────

  getReconnectState(playerId: string, gameId: string): GameStateUpdatePayload | undefined {
    const active = this.activeGames.get(gameId);
    if (!active) return undefined;

    const player = active.state.players.find(p => p.id === playerId);
    const isSpectator = player?.role === 'spectator';
    const useDelayedState =
      isSpectator &&
      active.spectatorVisibility === 'delayed' &&
      active.previousHandState !== null;

    const stateToSend = useDelayedState ? active.previousHandState! : active.state;

    // Synthesize a PLAYER_JOINED event for reconnects so the UI handles it with
    // r.update(uiState) rather than replaying FLOP/TURN/RIVER animations from an
    // empty renderer — which would produce wrong card positions (Bug 1).
    const reconnectPlayer = stateToSend.players.find(p => p.id === playerId);
    if (!reconnectPlayer) return undefined;

    const reconnectEvent: Event = {
      type: 'PLAYER_JOINED',
      playerId,
      displayName: reconnectPlayer.displayName,
      seatIndex: reconnectPlayer.seatIndex,
    };

    this.logger.debug(
      {
        playerId,
        gameId,
        isSpectator,
        useDelayedState,
        stateStage: stateToSend.stage,
        communityCardCount: stateToSend.communityCards.length,
      },
      'spectator-reconnect',
    );

    return buildGameStatePayload(
      stateToSend,
      reconnectEvent,
      playerId,
      active.state.activePlayerId === playerId ? config.ACTION_TIMEOUT_MS : undefined,
      active.spectatorVisibility
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

      // Record for replay
      active.recorder?.recordEvent(transition.event, active.state);

      // Broadcast personalized state to all players in the game
      sessions.broadcastPersonalized(gameId, (viewerId) => {
        const viewer = active.state.players.find(p => p.id === viewerId);
        const isSpectator = viewer?.role === 'spectator';
        const useDelayedState =
          isSpectator &&
          active.spectatorVisibility === 'delayed' &&
          active.previousHandState !== null;

        const stateToSend = useDelayedState ? active.previousHandState! : active.state;

        if (isSpectator) {
          // Count client-visible hole cards (after visibility filtering) so the
          // log reflects what the spectator actually sees, not engine internals.
          const clientStateForLog = toClientGameState(stateToSend, viewerId, active.spectatorVisibility);
          const holeCardsVisible = clientStateForLog.players.filter(
            p => p.role !== 'spectator' && p.holeCards !== null
          ).length;
          this.logger.debug(
            {
              spectatorId: viewerId,
              eventType: transition.event.type,
              stateStage: stateToSend.stage,
              communityCardCount: stateToSend.communityCards.length,
              handNumber: stateToSend.handNumber,
              holeCardsVisible,
              useDelayedState,
            },
            'spectator-tx',
          );
        } else {
          const myPlayer = active.state.players.find(p => p.id === viewerId);
          this.logger.debug(
            {
              viewerId,
              eventType: transition.event.type,
              stateStage: active.state.stage,
              communityCardCount: active.state.communityCards.length,
              handNumber: active.state.handNumber,
              pot: active.state.pot,
              myHoleCards: myPlayer?.holeCards != null,
              folded: myPlayer?.folded ?? false,
            },
            'player-tx',
          );
        }

        return {
          action: 'gameState',
          payload: buildGameStatePayload(
            stateToSend,
            transition.event,
            viewerId,
            config.ACTION_TIMEOUT_MS,
            active.spectatorVisibility
          ),
        };
      });
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

    // Store completed hand state for delayed spectator viewing
    active.previousHandState = cloneState(active.state);

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
      payload: buildGameStatePayload(active.state, timeoutEvent, viewerId, undefined, active.spectatorVisibility),
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

    // Save replay file
    if (active.recorder && active.recorder.entryCount > 0) {
      try {
        const replayData = active.recorder.toReplayFile();
        const filePath = saveReplayFile(gameId, replayData);
        this.logger.info({ gameId, filePath, entryCount: active.recorder.entryCount }, 'Replay saved');
      } catch (err) {
        this.logger.error({ err, gameId }, 'Failed to save replay');
      }
    }

    // Update DB
    updateGameStatus(gameId, 'completed');
    deleteGameSnapshot(gameId);

    // Clean up
    this.cleanupBots(gameId);
    this.activeGames.delete(gameId);
    this.logger.info({ gameId, reason }, 'Game ended');
  }

  // ─── Bot management ────────────────────────────────────────────────────────

  /** Launch a bot that connects to this server via WebSocket. */
  async addBot(
    gameId: string,
    botType: string,
    displayName: string
  ): Promise<{ ok: boolean; error?: string }> {
    let bots: typeof import('@pokerathome/bots');
    try {
      bots = await import('@pokerathome/bots');
    } catch (err) {
      this.logger.error({ err }, 'Failed to load @pokerathome/bots');
      return { ok: false, error: 'Bots package not available' };
    }

    const createStrategy = bots.strategyRegistry[botType];
    if (!createStrategy) {
      return { ok: false, error: `Unknown bot type: ${botType}` };
    }

    const serverUrl = `ws://${config.HOST}:${config.PORT}/ws`;
    const bot = new bots.BotClient({
      serverUrl,
      gameId,
      strategy: createStrategy(),
      displayName,
    });

    try {
      await bot.start();
      const bots = this.activeBots.get(gameId) ?? [];
      bots.push(bot);
      this.activeBots.set(gameId, bots);
      this.logger.info({ gameId, botType, displayName }, 'Bot added to game');
      return { ok: true };
    } catch (err) {
      this.logger.error({ err, gameId, botType }, 'Failed to start bot');
      return { ok: false, error: 'Failed to connect bot' };
    }
  }

  private cleanupBots(gameId: string): void {
    const bots = this.activeBots.get(gameId);
    if (!bots) return;
    for (const bot of bots) {
      try { bot.stop(); } catch { /* already stopped */ }
    }
    this.activeBots.delete(gameId);
    this.logger.info({ gameId, botCount: bots.length }, 'Bots cleaned up');
  }

  // ─── Deck rigging (for tests) ───────────────────────────────────────────────

  /** Set a pre-ordered deck for the next hand (consumed once). */
  setRiggedDeck(gameId: string, deck: string[]): void {
    const active = this.activeGames.get(gameId);
    if (!active) return;
    active.riggedDeck = deck;
  }

  // ─── State query helpers ────────────────────────────────────────────────────

  buildStatePayload(
    gameId: string,
    event: Event,
    viewerPlayerId: string
  ): GameStateUpdatePayload | undefined {
    const active = this.activeGames.get(gameId);
    if (!active) return undefined;
    return buildGameStatePayload(active.state, event, viewerPlayerId, undefined, active.spectatorVisibility);
  }

  isGameActive(gameId: string): boolean {
    return this.activeGames.has(gameId);
  }

  getActiveGameState(gameId: string): EngineState | undefined {
    return this.activeGames.get(gameId)?.state;
  }

  /** Get the replay recorder for a game (for chat recording). */
  getRecorder(gameId: string): ReplayRecorder | null {
    return this.activeGames.get(gameId)?.recorder ?? null;
  }
}
