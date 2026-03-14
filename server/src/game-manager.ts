/**
 * GameManager — orchestrates active game instances.
 *
 * Bridges the pure game engine with WS sessions, timers, and persistence.
 * Holds active game states in memory. Writes to SQLite on hand completion
 * and periodic snapshots for crash recovery.
 */

import type { FastifyBaseLogger } from 'fastify';
import type { Event, GameListItem, GameState, GameStateUpdatePayload, BlindLevel, ChatMessagePayload } from '@pokerathome/schema';
import type { SessionManager } from './ws/session.js';
import {
  createInitialState,
  addPlayer,
  removePlayer as engineRemovePlayer,
  setPlayerReady,
  setPlayerUnready,
  setPlayerConnected as engineSetConnected,
  setPlayerSittingOut as engineSetSittingOut,
  startHand,
  processAction,
  advanceBlindLevel,
  toClientGameState,
  buildGameStatePayload,
  cloneState,
  getRunoutAnimationDelay,
  type EngineState,
  type Transition,
  type GameConfig,
  type TournamentOverrides,
} from './engine/game.js';
import { validateAction } from './engine/action-validator.js';
import { generateBlindSchedule, STARTING_STACK } from './engine/blind-schedule.js';
import {
  getGameById,
  listActiveGames,
  getGamePlayers,
  addGamePlayer,
  removeGamePlayer,
  getGamePlayerCount,
  updateGameStatus,
  updateGameSpectatorVisibility,
  updateGameShowdownVisibility,
  saveHandHistory,
  saveGameSnapshot,
  deleteGameSnapshot,
  type GameRow,
} from './db/queries.js';
import { config } from './config.js';
import { isPrivateMode } from './auth.js';
import { createPlayerPassphrase } from './db/auth-queries.js';
import { ReplayRecorder } from './replay/recorder.js';
import { saveReplayFile } from './replay/storage.js';

interface TournamentConfig {
  tournamentLengthHours: number;
  roundLengthMinutes: number;
  antesEnabled: boolean;
}

interface ActiveGame {
  state: EngineState;
  actionTimer: ReturnType<typeof setTimeout> | null;
  warningTimers: ReturnType<typeof setTimeout>[];
  riggedDeck: string[] | null;
  previousHandState: EngineState | null; // Track previous hand for delayed spectator view
  spectatorVisibility: string; // Per-game spectator card visibility mode
  showdownVisibility: string; // Per-game showdown card reveal mode
  recorder: ReplayRecorder | null; // Replay recording
  turnStartedAt: number | null; // Date.now() when action timer started
  // Tournament-specific fields
  blindTimer: ReturnType<typeof setTimeout> | null;
  blindWarningTimers: ReturnType<typeof setTimeout>[];
  isPaused: boolean;
  pausedBlindRemainingMs: number | null;
  blindTimerStartedAt: number | null; // When the current blind timer was started
  blindTimerDurationMs: number | null; // Total duration of current blind timer
  pendingBlindIncrease: boolean;
  waitingForPlayers: boolean;
  tournamentStartedAt: number | null;
  tournamentConfig: TournamentConfig | null;
  chatHistory: ChatMessagePayload[];
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
        this.activeGames.set(row.id, this.createActiveGame(currentState, row));
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
      showdownVisibility: (row.showdown_visibility as 'standard' | 'show-all') ?? 'standard',
    };
  }

  private createEngineStateFromRow(row: GameRow): EngineState {
    return createInitialState(this.createGameConfig(row));
  }

  private createActiveGame(state: EngineState, row: GameRow): ActiveGame {
    const tournamentConfig: TournamentConfig | null =
      row.game_type === 'tournament' && row.tournament_length_hours != null && row.round_length_minutes != null
        ? {
            tournamentLengthHours: row.tournament_length_hours,
            roundLengthMinutes: row.round_length_minutes,
            antesEnabled: row.antes_enabled === 1,
          }
        : null;

    return {
      state,
      actionTimer: null,
      warningTimers: [],
      riggedDeck: null,
      previousHandState: null,
      spectatorVisibility: row.spectator_visibility ?? 'showdown',
      showdownVisibility: row.showdown_visibility ?? 'standard',
      recorder: new ReplayRecorder(this.createGameConfig(row)),
      turnStartedAt: null,
      blindTimer: null,
      blindWarningTimers: [],
      isPaused: false,
      pausedBlindRemainingMs: null,
      blindTimerStartedAt: null,
      blindTimerDurationMs: null,
      pendingBlindIncrease: false,
      waitingForPlayers: false,
      tournamentStartedAt: null,
      tournamentConfig,
      chatHistory: [],
    };
  }

  /** Build TournamentOverrides for client state projection from an active game. */
  private getTournamentOverrides(active: ActiveGame): TournamentOverrides | undefined {
    if (active.state.gameType !== 'tournament' || !active.tournamentConfig) return undefined;
    const roundLengthMs = active.tournamentConfig.roundLengthMinutes * 60_000;

    let nextBlindChangeAt: number | null;
    if (active.isPaused) {
      nextBlindChangeAt = null;
    } else if (active.blindTimerStartedAt != null && active.blindTimerDurationMs != null) {
      nextBlindChangeAt = active.blindTimerStartedAt + active.blindTimerDurationMs;
    } else {
      nextBlindChangeAt = null;
    }

    return {
      nextBlindChangeAt,
      roundLengthMs,
      isPaused: active.isPaused,
    };
  }

  /** Register a game from the DB into the active games map. */
  activateGame(gameId: string): void {
    const row = getGameById(gameId);
    if (!row) throw new Error(`Game ${gameId} not found`);
    if (this.activeGames.has(gameId)) return;

    const state = this.createEngineStateFromRow(row);
    this.activeGames.set(gameId, this.createActiveGame(state, row));
    this.logger.info({ gameId }, 'Game activated');
  }

  /** Update spectator visibility mode for a game (persists to DB). */
  setSpectatorVisibility(gameId: string, visibility: string): boolean {
    const active = this.activeGames.get(gameId);
    if (active) active.spectatorVisibility = visibility;
    return updateGameSpectatorVisibility(gameId, visibility);
  }

  /** Update showdown card visibility mode for a game (persists to DB + engine state). */
  setShowdownVisibility(gameId: string, visibility: string): boolean {
    const active = this.activeGames.get(gameId);
    if (active) {
      active.showdownVisibility = visibility;
      active.state.showdownVisibility = visibility as 'standard' | 'show-all';
    }
    return updateGameShowdownVisibility(gameId, visibility);
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
      startingStack: row.starting_stack,
      status: row.status as 'waiting' | 'in_progress',
      tournamentLengthHours: row.tournament_length_hours ?? undefined,
      roundLengthMinutes: row.round_length_minutes ?? undefined,
      antesEnabled: row.antes_enabled === 1 ? true : undefined,
    }));
  }

  // ─── Join / Leave ───────────────────────────────────────────────────────────

  joinGame(gameId: string, playerId: string, displayName: string, role: 'player' | 'spectator' = 'player'): JoinResult {
    const row = getGameById(gameId);
    if (!row) return { ok: false, errorCode: 'GAME_NOT_FOUND', errorMessage: 'Game not found' };

    // Tournaments in progress don't allow late registration — force spectator
    if (row.game_type === 'tournament' && row.status === 'in_progress' && role === 'player') {
      role = 'spectator';
    }

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
        role === 'spectator' ? active.spectatorVisibility : undefined,
        this.getTournamentOverrides(active)
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
    const overrides = this.getTournamentOverrides(active);
    sessions.broadcastPersonalized(gameId, (viewerId) => ({
      action: 'gameState',
      payload: buildGameStatePayload(active.state, result.event, viewerId, undefined, active.spectatorVisibility, overrides),
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

  setPlayerUnready(gameId: string, playerId: string): void {
    const active = this.activeGames.get(gameId);
    if (!active || active.state.handInProgress) return;
    active.state = setPlayerUnready(active.state, playerId);
  }

  /** Broadcast lobby state (player list + ready status) to all players in the game. */
  broadcastLobbyState(gameId: string, sessions: SessionManager): void {
    const active = this.activeGames.get(gameId);
    if (!active || active.state.handInProgress) return;

    const players = active.state.players
      .filter((p) => p.role === 'player')
      .map((p) => ({ id: p.id, displayName: p.displayName, isReady: p.isReady }));

    const allReady = players.length >= 2 && players.every((p) => p.isReady);

    sessions.broadcast(gameId, {
      action: 'lobbyUpdate',
      payload: { players, canStart: allReady && config.PLAYER_CAN_START_GAME },
    });
  }

  /** Player-initiated game start. Requires all players to be ready and config to allow it. */
  playerStartGame(
    gameId: string,
    playerId: string,
    sessions: SessionManager
  ): { ok: boolean; error?: string } {
    if (!config.PLAYER_CAN_START_GAME) {
      return { ok: false, error: 'Player-initiated start is disabled' };
    }

    const active = this.activeGames.get(gameId);
    if (!active) return { ok: false, error: 'Game not found' };
    if (active.state.handInProgress) return { ok: false, error: 'Game already in progress' };

    const players = active.state.players.filter((p) => p.role === 'player' && p.stack > 0);
    if (players.length < 2) return { ok: false, error: 'Not enough players' };
    if (!players.every((p) => p.isReady)) return { ok: false, error: 'Not all players are ready' };

    // Verify the requester is a player in the game
    const requester = active.state.players.find((p) => p.id === playerId);
    if (!requester || requester.role !== 'player') {
      return { ok: false, error: 'Only players can start the game' };
    }

    this.initializeTournament(active, players);
    updateGameStatus(gameId, 'in_progress');
    this.startNextHand(gameId, sessions);

    if (active.state.gameType === 'tournament' && active.tournamentConfig) {
      this.startBlindTimer(gameId, sessions);
    }

    return { ok: true };
  }

  /** Force-start a game (admin action). */
  forceStartGame(gameId: string, sessions: SessionManager): boolean {
    const active = this.activeGames.get(gameId);
    if (!active) return false;
    if (active.state.handInProgress) return false;

    const players = active.state.players.filter((p) => p.role === 'player' && p.stack > 0);
    if (players.length < 2) return false;

    // Tournament games must have a valid config
    if (active.state.gameType === 'tournament' && !active.tournamentConfig) {
      this.logger.warn({ gameId }, 'Tournament game missing config — cannot start');
      return false;
    }

    // Mark all players as ready
    for (const p of players) {
      active.state = setPlayerReady(active.state, p.id);
    }

    this.initializeTournament(active, players);

    updateGameStatus(gameId, 'in_progress');
    this.startNextHand(gameId, sessions);

    // Start blind timer after the first hand begins (for tournaments)
    if (active.state.gameType === 'tournament' && active.tournamentConfig) {
      this.startBlindTimer(gameId, sessions);
    }

    return true;
  }

  /** Generate blind schedule and set up tournament state (shared by start methods). */
  private initializeTournament(active: ActiveGame, players: { id: string }[]): void {
    if (active.state.gameType !== 'tournament' || !active.tournamentConfig) return;

    const tc = active.tournamentConfig;
    const schedule = generateBlindSchedule({
      numPlayers: players.length,
      tournamentLengthHours: tc.tournamentLengthHours,
      roundLengthMinutes: tc.roundLengthMinutes,
      antesEnabled: tc.antesEnabled,
    });

    active.state = {
      ...active.state,
      blindSchedule: schedule,
      currentBlindLevel: 0,
      smallBlindAmount: schedule[0].smallBlind,
      bigBlindAmount: schedule[0].bigBlind,
      antesEnabled: tc.antesEnabled,
      tournamentStartedAt: Date.now(),
      totalPlayers: players.length,
    };
    active.tournamentStartedAt = Date.now();
  }

  // ─── Hand management ────────────────────────────────────────────────────────

  private startNextHand(gameId: string, sessions: SessionManager): void {
    const active = this.activeGames.get(gameId);
    if (!active) return;

    // If game is paused or a hand is already in progress, don't start another
    if (active.isPaused) return;
    if (active.state.handInProgress) return;

    const isTournament = active.state.gameType === 'tournament';

    const playersWithChips = active.state.players.filter(
      (p) => p.role === 'player' && p.stack > 0
    );

    // Tournament end: only 1 player has chips
    if (playersWithChips.length < 2) {
      this.endGame(gameId, 'completed', sessions);
      return;
    }

    // Pause if not enough active (non-sitting-out) players — applies to both game types
    const activePlayers = playersWithChips.filter(p => !p.sittingOut);
    if (activePlayers.length < 2) {
      if (isTournament) {
        // Preserve remaining blind time BEFORE clearing timers (clearBlindTimers nulls the fields)
        if (active.blindTimerStartedAt != null && active.blindTimerDurationMs != null) {
          const elapsed = Date.now() - active.blindTimerStartedAt;
          active.pausedBlindRemainingMs = Math.max(0, active.blindTimerDurationMs - elapsed);
        }
        this.clearBlindTimers(active);

        const event: Event = { type: 'TOURNAMENT_PAUSED' };
        active.recorder?.recordEvent(event, active.state);
        const overrides = this.getTournamentOverrides(active);
        sessions.broadcastPersonalized(gameId, (viewerId) => ({
          action: 'gameState',
          payload: buildGameStatePayload(active.state, event, viewerId, undefined, active.spectatorVisibility, overrides),
        }));
      }

      active.isPaused = true;
      active.waitingForPlayers = true;

      this.logger.info({ gameId, activePlayers: activePlayers.length, totalWithChips: playersWithChips.length },
        `${isTournament ? 'Tournament' : 'Cash game'} paused — waiting for players to return`);
      return;
    }

    // Apply pending blind increase (timer expired between hands)
    if (isTournament && active.pendingBlindIncrease) {
      active.pendingBlindIncrease = false;
      const transition = advanceBlindLevel(active.state);
      active.state = transition.state;

      // Record and broadcast the BLIND_LEVEL_UP event
      active.recorder?.recordEvent(transition.event, active.state);
      sessions.broadcastPersonalized(gameId, (viewerId) => ({
        action: 'gameState',
        payload: buildGameStatePayload(
          active.state, transition.event, viewerId, undefined,
          active.spectatorVisibility, this.getTournamentOverrides(active)
        ),
      }));

      // Restart blind timer for the next level
      this.startBlindTimer(gameId, sessions);
    }

    try {
      const deckOverride = active.riggedDeck ?? undefined;
      active.riggedDeck = null;
      const transitions = startHand(active.state, deckOverride);
      this.applyTransitions(gameId, transitions, sessions);
      // Auto-act for sitting-out players is handled by applyTransitions
      // via setTimeout to avoid deep recursion and double-invocation
    } catch (err) {
      this.logger.error({ err, gameId }, 'Failed to start hand');
    }
  }

  /** Auto-act for sitting-out players: check if possible, else fold. */
  private autoFoldSittingOutPlayers(gameId: string, sessions: SessionManager): void {
    const active = this.activeGames.get(gameId);
    if (!active || !active.state.handInProgress) return;

    const activePlayer = active.state.players.find(p => p.id === active.state.activePlayerId);
    if (!activePlayer) return;

    if (!activePlayer.sittingOut) {
      // Player returned between scheduling and execution.
      // Start their action timer and re-broadcast so they receive an actionRequest.
      this.startActionTimer(gameId, activePlayer.id, sessions);
      const overrides = this.getTournamentOverrides(active);
      sessions.broadcastPersonalized(gameId, (viewerId) => ({
        action: 'gameState',
        payload: buildGameStatePayload(
          active.state,
          { type: 'PLAYER_SITTING_OUT', playerId: activePlayer.id, sittingOut: false } as Event,
          viewerId,
          viewerId === activePlayer.id ? config.ACTION_TIMEOUT_MS : undefined,
          active.spectatorVisibility,
          overrides
        ),
      }));
      return;
    }

    // Active player is sitting out — check if possible, else fold
    this.clearTimers(active);
    const canCheck = activePlayer.bet >= active.state.currentBet;
    const defaultAction = canCheck ? 'CHECK' : 'FOLD';
    this.logger.info({ gameId, playerId: activePlayer.id, defaultAction }, 'Auto-acting for sitting-out player');
    const transitions = processAction(active.state, activePlayer.id, defaultAction);
    this.applyTransitions(gameId, transitions, sessions);
    // applyTransitions will start the next action timer, which will trigger
    // another auto-act if the next active player is also sitting out
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
      payload: buildGameStatePayload(active.state, event, viewerId, undefined, active.spectatorVisibility, this.getTournamentOverrides(active)),
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

    let timeToAct: number | undefined;
    if (active.state.activePlayerId === playerId) {
      if (active.turnStartedAt) {
        const elapsed = Date.now() - active.turnStartedAt;
        timeToAct = Math.max(0, config.ACTION_TIMEOUT_MS - elapsed);
      } else {
        timeToAct = config.ACTION_TIMEOUT_MS;
      }
    }

    return buildGameStatePayload(
      stateToSend,
      reconnectEvent,
      playerId,
      timeToAct,
      active.spectatorVisibility,
      this.getTournamentOverrides(active)
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

        // Don't send actionTimeout if the active player is sitting out (they'll be auto-folded)
        const activeP = active.state.players.find(p => p.id === active.state.activePlayerId);
        const timeToAct = (activeP?.sittingOut) ? undefined : config.ACTION_TIMEOUT_MS;

        // Include hand probabilities only on card-changing events for non-spectator players
        const CARD_EVENTS = new Set(['DEAL', 'FLOP', 'TURN', 'RIVER']);
        const includeProbs = CARD_EVENTS.has(transition.event.type) && !isSpectator;

        return {
          action: 'gameState',
          payload: buildGameStatePayload(
            stateToSend,
            transition.event,
            viewerId,
            timeToAct,
            active.spectatorVisibility,
            this.getTournamentOverrides(active),
            includeProbs
          ),
        };
      });
    }

    // After all transitions, check state
    if (!active.state.handInProgress) {
      // Hand ended — save history and snapshot
      this.onHandEnd(gameId, sessions);
    } else if (active.state.activePlayerId) {
      // Check if active player is sitting out — auto-act (check or fold)
      const activePlayer = active.state.players.find(p => p.id === active.state.activePlayerId);
      if (activePlayer?.sittingOut) {
        // Schedule auto-fold on next tick to avoid deep recursion
        setTimeout(() => this.autoFoldSittingOutPlayers(gameId, sessions), 0);
        saveGameSnapshot(gameId, active.state);
        return;
      }
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

    // Save replay incrementally after each hand
    if (active.recorder && active.recorder.entryCount > 0) {
      try {
        const replayData = active.recorder.toReplayFile();
        saveReplayFile(active.recorder.fileName, replayData);
      } catch (err) {
        this.logger.error({ err, gameId }, 'Failed to save replay after hand');
      }
    }

    // Check if game should continue
    const playersWithChips = active.state.players.filter(
      (p) => p.role === 'player' && p.stack > 0
    );

    if (playersWithChips.length < 2) {
      this.endGame(gameId, 'completed', sessions);
      return;
    }

    // Schedule next hand after delay (longer after all-in runouts for dramatic animations)
    const runoutExtra = getRunoutAnimationDelay(active.state.handEvents);
    setTimeout(() => {
      this.startNextHand(gameId, sessions);
    }, config.HAND_DELAY_MS + runoutExtra);
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

    active.turnStartedAt = Date.now();
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

    // Set player to sitting out after timeout
    active.state = engineSetSittingOut(active.state, playerId, true);

    // Emit PLAYER_TIMEOUT event
    const timeoutEvent: Event = {
      type: 'PLAYER_TIMEOUT',
      playerId,
      defaultAction: { type: defaultType },
    };

    // Broadcast the timeout event
    const overrides = this.getTournamentOverrides(active);
    sessions.broadcastPersonalized(gameId, (viewerId) => ({
      action: 'gameState',
      payload: buildGameStatePayload(active.state, timeoutEvent, viewerId, undefined, active.spectatorVisibility, overrides),
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
    active.turnStartedAt = null;
  }

  private clearBlindTimers(active: ActiveGame): void {
    if (active.blindTimer) {
      clearTimeout(active.blindTimer);
      active.blindTimer = null;
    }
    for (const timer of active.blindWarningTimers) {
      clearTimeout(timer);
    }
    active.blindWarningTimers = [];
    active.blindTimerStartedAt = null;
    active.blindTimerDurationMs = null;
  }

  // ─── Blind timer management (tournaments) ──────────────────────────────────

  private startBlindTimer(gameId: string, sessions: SessionManager, durationMs?: number): void {
    const active = this.activeGames.get(gameId);
    if (!active || !active.tournamentConfig) return;
    if (active.state.blindSchedule.length === 0) return; // No schedule to advance through

    this.clearBlindTimers(active);

    const roundMs = durationMs ?? active.tournamentConfig.roundLengthMinutes * 60_000;
    active.blindTimerStartedAt = Date.now();
    active.blindTimerDurationMs = roundMs;

    // Compute next blind level for warnings
    const nextIdx = Math.min(active.state.currentBlindLevel + 1, active.state.blindSchedule.length - 1);
    const nextLevel = active.state.blindSchedule[nextIdx];

    // Schedule blind warnings at 60s, 30s, and 10s before change
    const warningOffsets = [60_000, 30_000, 10_000];
    for (const offset of warningOffsets) {
      const delay = roundMs - offset;
      if (delay > 0) {
        const timer = setTimeout(() => {
          sessions.broadcast(gameId, {
            action: 'blindWarning' as const,
            payload: { remainingMs: offset, nextLevel },
          });
        }, delay);
        active.blindWarningTimers.push(timer);
      }
    }

    // Schedule the actual blind increase
    active.blindTimer = setTimeout(() => {
      const a = this.activeGames.get(gameId);
      if (!a) return;

      // If a hand is in progress, defer until next hand start
      if (a.state.handInProgress) {
        a.pendingBlindIncrease = true;
        this.logger.info({ gameId, nextLevel: nextIdx + 1 }, 'Blind increase pending (hand in progress)');
      } else {
        // Apply immediately between hands
        a.pendingBlindIncrease = false;
        const transition = advanceBlindLevel(a.state);
        a.state = transition.state;

        a.recorder?.recordEvent(transition.event, a.state);
        const overrides = this.getTournamentOverrides(a);
        sessions.broadcastPersonalized(gameId, (viewerId) => ({
          action: 'gameState',
          payload: buildGameStatePayload(
            a.state, transition.event, viewerId, undefined,
            a.spectatorVisibility, overrides
          ),
        }));

        // Start timer for next level
        this.startBlindTimer(gameId, sessions);
      }
    }, roundMs);

    this.logger.info({ gameId, roundMs, currentLevel: active.state.currentBlindLevel + 1 }, 'Blind timer started');
  }

  /** Pause the tournament (admin action). */
  pauseGame(gameId: string, sessions: SessionManager): boolean {
    const active = this.activeGames.get(gameId);
    if (!active || active.state.gameType !== 'tournament') return false;
    if (active.isPaused) return false;

    active.isPaused = true;

    // Pause blind timer — store remaining time
    if (active.blindTimerStartedAt != null && active.blindTimerDurationMs != null) {
      const elapsed = Date.now() - active.blindTimerStartedAt;
      active.pausedBlindRemainingMs = Math.max(0, active.blindTimerDurationMs - elapsed);
    }
    this.clearBlindTimers(active);

    // Broadcast TOURNAMENT_PAUSED event
    const event: Event = { type: 'TOURNAMENT_PAUSED' };
    active.recorder?.recordEvent(event, active.state);
    const overrides = this.getTournamentOverrides(active);
    sessions.broadcastPersonalized(gameId, (viewerId) => ({
      action: 'gameState',
      payload: buildGameStatePayload(active.state, event, viewerId, undefined, active.spectatorVisibility, overrides),
    }));

    this.logger.info({ gameId, remainingMs: active.pausedBlindRemainingMs }, 'Tournament paused');
    return true;
  }

  /** Resume the tournament (admin action). */
  resumeGame(gameId: string, sessions: SessionManager): boolean {
    const active = this.activeGames.get(gameId);
    if (!active || active.state.gameType !== 'tournament') return false;
    if (!active.isPaused) return false;

    active.isPaused = false;

    // Resume blind timer with remaining time
    const remainingMs = active.pausedBlindRemainingMs;
    active.pausedBlindRemainingMs = null;
    if (remainingMs != null && remainingMs > 0) {
      this.startBlindTimer(gameId, sessions, remainingMs);
    } else {
      this.startBlindTimer(gameId, sessions);
    }

    // Broadcast TOURNAMENT_RESUMED event
    const event: Event = { type: 'TOURNAMENT_RESUMED' };
    active.recorder?.recordEvent(event, active.state);
    const overrides = this.getTournamentOverrides(active);
    sessions.broadcastPersonalized(gameId, (viewerId) => ({
      action: 'gameState',
      payload: buildGameStatePayload(active.state, event, viewerId, undefined, active.spectatorVisibility, overrides),
    }));

    // If no hand in progress, start the next hand
    if (!active.state.handInProgress) {
      this.startNextHand(gameId, sessions);
    }

    this.logger.info({ gameId }, 'Tournament resumed');
    return true;
  }

  // ─── Sit-out handling ───────────────────────────────────────────────────────

  handleSetSittingOut(gameId: string, playerId: string, sittingOut: boolean, sessions: SessionManager): void {
    const active = this.activeGames.get(gameId);
    if (!active) return;

    const player = active.state.players.find(p => p.id === playerId);
    if (!player || player.role !== 'player') return;

    // Idempotency guard: if already in the requested state, send a targeted
    // confirmation to the requester so their client can resync (the button state
    // may be stale due to chain processing delays), but don't broadcast to everyone.
    if (player.sittingOut === sittingOut) {
      const overrides = this.getTournamentOverrides(active);
      const syncEvent = { type: 'PLAYER_SITTING_OUT', playerId, sittingOut: player.sittingOut } as Event;
      sessions.send(playerId, {
        action: 'gameState',
        payload: buildGameStatePayload(active.state, syncEvent, playerId, undefined, active.spectatorVisibility, overrides),
      });
      return;
    }

    active.state = engineSetSittingOut(active.state, playerId, sittingOut);

    // Broadcast updated state.
    // When the player returns mid-hand as the active player, include actionRequest
    // so they can act (the earlier broadcast from applyTransitions omitted it because
    // they were sitting out at the time).
    const isReturningAsActive = !sittingOut
      && active.state.handInProgress
      && active.state.activePlayerId === playerId;
    const overrides = this.getTournamentOverrides(active);
    const sittingOutEvent = { type: 'PLAYER_SITTING_OUT', playerId, sittingOut } as Event;
    sessions.broadcastPersonalized(gameId, (viewerId) => ({
      action: 'gameState',
      payload: buildGameStatePayload(
        active.state,
        sittingOutEvent,
        viewerId,
        isReturningAsActive && viewerId === playerId ? config.ACTION_TIMEOUT_MS : undefined,
        active.spectatorVisibility,
        overrides
      ),
    }));

    // Start action timer if returning as the active player
    if (isReturningAsActive) {
      this.startActionTimer(gameId, playerId, sessions);
    }

    // Record in replay so sit-out transitions are visible when debugging
    active.recorder?.recordEvent(sittingOutEvent, active.state);

    this.logger.info({ gameId, playerId, sittingOut }, 'Player sit-out toggled');

    // Player returning while game is waiting for players — check if we can resume
    if (!sittingOut && active.waitingForPlayers) {
      const playersWithChips = active.state.players.filter(p => p.role === 'player' && p.stack > 0);
      const activePlayers = playersWithChips.filter(p => !p.sittingOut);
      if (activePlayers.length >= 2) {
        active.isPaused = false;
        active.waitingForPlayers = false;

        if (active.state.gameType === 'tournament') {
          // Resume blind timer
          const remainingMs = active.pausedBlindRemainingMs;
          active.pausedBlindRemainingMs = null;
          if (remainingMs != null && remainingMs > 0) {
            this.startBlindTimer(gameId, sessions, remainingMs);
          } else if (active.tournamentConfig) {
            this.startBlindTimer(gameId, sessions);
          }

          // Broadcast TOURNAMENT_RESUMED
          const resumeEvent: Event = { type: 'TOURNAMENT_RESUMED' };
          active.recorder?.recordEvent(resumeEvent, active.state);
          const resumeOverrides = this.getTournamentOverrides(active);
          sessions.broadcastPersonalized(gameId, (viewerId) => ({
            action: 'gameState',
            payload: buildGameStatePayload(active.state, resumeEvent, viewerId, undefined, active.spectatorVisibility, resumeOverrides),
          }));
        }

        this.logger.info({ gameId, activePlayers: activePlayers.length },
          `${active.state.gameType === 'tournament' ? 'Tournament' : 'Cash game'} resumed — enough players returned`);

        // Start the next hand
        setTimeout(() => this.startNextHand(gameId, sessions), config.HAND_DELAY_MS);
        return;
      }
    }

    // If the player just came back and they're the active player,
    // they should get their normal action timer (already handled by broadcast above).
    // If they sat out and they're the active player, resolve their action immediately
    // with check (if no bet to call) or fold — this is their last "live" action.
    if (sittingOut && active.state.handInProgress && active.state.activePlayerId === playerId) {
      this.clearTimers(active);
      const canCheck = player.bet >= active.state.currentBet;
      const defaultAction = canCheck ? 'CHECK' : 'FOLD';
      this.logger.info({ gameId, playerId, defaultAction }, 'Auto-acting for sitting-out player on sit-out turn');
      const transitions = processAction(active.state, playerId, defaultAction);
      this.applyTransitions(gameId, transitions, sessions);
    }
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
    this.clearBlindTimers(active);

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
        const filePath = saveReplayFile(active.recorder.fileName, replayData);
        this.logger.info({ gameId, filePath, entryCount: active.recorder.entryCount }, 'Replay saved');
      } catch (err) {
        this.logger.error({ err, gameId }, 'Failed to save replay');
      }
    }

    // Update DB
    updateGameStatus(gameId, 'completed');
    deleteGameSnapshot(gameId);

    // Clear session.gameId for all players so they can join new games
    for (const session of sessions.getPlayersInGame(gameId)) {
      sessions.setGameId(session.playerId, null);
    }

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

    const serverUrl = `ws://localhost:${config.PORT}/ws`;
    let passphrase: string | undefined;
    if (isPrivateMode()) {
      const pp = createPlayerPassphrase(displayName);
      passphrase = pp.passphrase;
    }

    const bot = new bots.BotClient({
      serverUrl,
      gameId,
      strategy: createStrategy(),
      displayName,
      passphrase,
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
    return buildGameStatePayload(active.state, event, viewerPlayerId, undefined, active.spectatorVisibility, this.getTournamentOverrides(active));
  }

  isGameActive(gameId: string): boolean {
    return this.activeGames.has(gameId);
  }

  getGameName(gameId: string): string | undefined {
    return this.activeGames.get(gameId)?.state.gameName;
  }

  getActiveGameState(gameId: string): EngineState | undefined {
    return this.activeGames.get(gameId)?.state;
  }

  /** Get the replay recorder for a game (for chat recording). */
  getRecorder(gameId: string): ReplayRecorder | null {
    return this.activeGames.get(gameId)?.recorder ?? null;
  }

  /** Store a chat message in the game's in-memory history. */
  addChatMessage(gameId: string, msg: ChatMessagePayload): void {
    const active = this.activeGames.get(gameId);
    if (!active) return;
    active.chatHistory.push(msg);
    if (active.chatHistory.length > config.MAX_CHAT_HISTORY) {
      active.chatHistory.splice(0, active.chatHistory.length - config.MAX_CHAT_HISTORY);
    }
  }

  /** Get chat history for a game (for reconnect/spectator join). */
  getChatHistory(gameId: string): ChatMessagePayload[] {
    return this.activeGames.get(gameId)?.chatHistory ?? [];
  }
}
