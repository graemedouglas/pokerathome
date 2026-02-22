/**
 * ReplayInstance — per-replay-game playback engine.
 *
 * Each spectator connected to a replay game has independent playback state:
 * position, speed, playing/paused, and card visibility preferences.
 * The instance feeds `replayState` messages to each spectator on demand.
 */

import type { FastifyBaseLogger } from 'fastify';
import type {
  Event,
  GameState,
  ChatMessagePayload,
  ReplayFile,
} from '@pokerathome/schema';
import type { SessionManager } from '../ws/session.js';
import type { EngineState } from '../engine/game.js';

interface SpectatorPlaybackState {
  position: number;
  speed: number;
  isPlaying: boolean;
  timer: ReturnType<typeof setTimeout> | null;
  showAllCards: boolean;
  playerVisibility: Map<string, boolean>;
}

export class ReplayInstance {
  private spectators = new Map<string, SpectatorPlaybackState>();
  private replayGameId: string;
  private replay: ReplayFile;
  private sessions: SessionManager;
  private logger: FastifyBaseLogger;

  constructor(
    replayGameId: string,
    replay: ReplayFile,
    sessions: SessionManager,
    logger: FastifyBaseLogger,
  ) {
    this.replayGameId = replayGameId;
    this.replay = replay;
    this.sessions = sessions;
    this.logger = logger;
  }

  get replayData(): ReplayFile {
    return this.replay;
  }

  get spectatorCount(): number {
    return this.spectators.size;
  }

  addSpectator(playerId: string): void {
    this.spectators.set(playerId, {
      position: 0,
      speed: 1.0,
      isPlaying: false,
      timer: null,
      showAllCards: true,
      playerVisibility: new Map(),
    });
    this.sendStateToSpectator(playerId);
  }

  removeSpectator(playerId: string): void {
    const state = this.spectators.get(playerId);
    if (state?.timer) clearTimeout(state.timer);
    this.spectators.delete(playerId);
  }

  handleControl(
    playerId: string,
    command: string,
    speed?: number,
    position?: number,
  ): void {
    const state = this.spectators.get(playerId);
    if (!state) return;

    switch (command) {
      case 'play':
        state.isPlaying = true;
        this.scheduleNextEvent(playerId);
        break;
      case 'pause':
        state.isPlaying = false;
        this.clearTimer(state);
        break;
      case 'step_forward':
        state.isPlaying = false;
        this.clearTimer(state);
        this.stepForward(playerId);
        break;
      case 'step_backward':
        state.isPlaying = false;
        this.clearTimer(state);
        this.stepBackward(playerId);
        break;
      case 'jump_round_start':
        state.isPlaying = false;
        this.clearTimer(state);
        this.jumpToRoundStart(playerId);
        break;
      case 'jump_next_round':
        state.isPlaying = false;
        this.clearTimer(state);
        this.jumpToNextRound(playerId);
        break;
      case 'set_speed':
        if (speed !== undefined) {
          state.speed = Math.max(0.25, Math.min(10, speed));
        }
        break;
      case 'set_position':
        if (position !== undefined) {
          state.isPlaying = false;
          this.clearTimer(state);
          state.position = Math.max(0, Math.min(position, this.replay.entries.length - 1));
        }
        break;
    }

    this.sendStateToSpectator(playerId);
  }

  handleCardVisibility(
    playerId: string,
    showAllCards?: boolean,
    playerVisibility?: Record<string, boolean>,
  ): void {
    const state = this.spectators.get(playerId);
    if (!state) return;

    if (showAllCards !== undefined) state.showAllCards = showAllCards;
    if (playerVisibility) {
      for (const [pid, visible] of Object.entries(playerVisibility)) {
        state.playerVisibility.set(pid, visible);
      }
    }

    this.sendStateToSpectator(playerId);
  }

  private stepForward(playerId: string): void {
    const state = this.spectators.get(playerId);
    if (!state) return;
    if (state.position + 1 < this.replay.entries.length) {
      state.position++;
    }
  }

  private stepBackward(playerId: string): void {
    const state = this.spectators.get(playerId);
    if (!state) return;
    if (state.position > 0) {
      state.position--;
    }
  }

  private jumpToRoundStart(playerId: string): void {
    const state = this.spectators.get(playerId);
    if (!state) return;

    const roundStartTypes = new Set(['HAND_START', 'FLOP', 'TURN', 'RIVER']);
    // Search backward from current position (exclusive) to find the most recent round start
    for (let i = state.position - 1; i >= 0; i--) {
      const entry = this.replay.entries[i];
      if (entry.type === 'event' && entry.event && roundStartTypes.has(entry.event.type)) {
        state.position = i;
        return;
      }
    }
    state.position = 0;
  }

  private jumpToNextRound(playerId: string): void {
    const state = this.spectators.get(playerId);
    if (!state) return;

    const roundStartTypes = new Set(['HAND_START', 'FLOP', 'TURN', 'RIVER']);
    for (let i = state.position + 1; i < this.replay.entries.length; i++) {
      const entry = this.replay.entries[i];
      if (entry.type === 'event' && entry.event && roundStartTypes.has(entry.event.type)) {
        state.position = i;
        return;
      }
    }
    // If no next round, go to end
    state.position = this.replay.entries.length - 1;
  }

  private scheduleNextEvent(playerId: string): void {
    const state = this.spectators.get(playerId);
    if (!state || !state.isPlaying) return;

    const nextPos = state.position + 1;
    if (nextPos >= this.replay.entries.length) {
      state.isPlaying = false;
      this.sendStateToSpectator(playerId);
      return;
    }

    const currentEntry = this.replay.entries[state.position];
    const nextEntry = this.replay.entries[nextPos];
    const timeDelta = nextEntry.timestamp - currentEntry.timestamp;
    const adjustedDelay = Math.max(50, timeDelta / state.speed);

    state.timer = setTimeout(() => {
      const s = this.spectators.get(playerId);
      if (!s || !s.isPlaying) return;
      s.position = nextPos;
      this.sendStateToSpectator(playerId);
      this.scheduleNextEvent(playerId);
    }, adjustedDelay);
  }

  sendStateToSpectator(playerId: string): void {
    const state = this.spectators.get(playerId);
    if (!state) return;

    const entry = this.replay.entries[state.position];
    if (!entry) return;

    let gameState: GameState | undefined;
    let event: Event | undefined;
    let chat: ChatMessagePayload | undefined;

    if (entry.type === 'event' && entry.engineState) {
      const engineState = entry.engineState as unknown as EngineState;
      gameState = this.toReplayClientState(engineState, playerId, state);
      event = entry.event;
    }

    if (entry.type === 'chat') {
      chat = entry.chat;
    }

    // For chat-only entries, find the most recent event entry's state
    if (!gameState) {
      for (let i = state.position - 1; i >= 0; i--) {
        const prev = this.replay.entries[i];
        if (prev.type === 'event' && prev.engineState) {
          gameState = this.toReplayClientState(
            prev.engineState as unknown as EngineState,
            playerId,
            state,
          );
          break;
        }
      }
    }

    // If we still have no game state (e.g., replay starts with chat), skip
    if (!gameState) return;

    this.sessions.send(playerId, {
      action: 'replayState' as const,
      payload: {
        position: state.position,
        totalEntries: this.replay.entries.length,
        isPlaying: state.isPlaying,
        speed: state.speed,
        gameState,
        event,
        chat,
        handNumber: gameState.handNumber,
        stage: gameState.stage,
      },
    });
  }

  /** Build client game state directly from engine state with replay card visibility. */
  private toReplayClientState(
    engineState: EngineState,
    _viewerId: string,
    spectatorState: SpectatorPlaybackState,
  ): GameState {
    // Build client state directly — always include all hole cards from the recording.
    // This bypasses toClientGameState() so replay visibility is independent of the
    // live spectator mode the game was originally played with.
    const base: GameState = {
      gameId: engineState.gameId,
      gameType: engineState.gameType,
      handNumber: engineState.handNumber,
      stage: engineState.stage,
      communityCards: engineState.communityCards,
      pot: engineState.pot,
      pots: engineState.pots,
      dealerSeatIndex: engineState.dealerSeatIndex,
      smallBlindAmount: engineState.smallBlindAmount,
      bigBlindAmount: engineState.bigBlindAmount,
      activePlayerId: engineState.activePlayerId,
      players: engineState.players
        .filter(p => p.role !== 'spectator')
        .map(p => ({
          id: p.id,
          displayName: p.displayName,
          seatIndex: p.seatIndex,
          role: p.role,
          stack: p.stack,
          bet: p.bet,
          potShare: p.potShare,
          folded: p.folded,
          holeCards: p.holeCards,
          connected: p.connected,
        })),
    };

    if (spectatorState.showAllCards) {
      return {
        ...base,
        players: base.players.map(p => {
          const explicitlyHidden = spectatorState.playerVisibility.get(p.id) === false;
          return explicitlyHidden ? { ...p, holeCards: null } : p;
        }),
      };
    }

    // showAllCards is false: hide all cards except those explicitly shown
    return {
      ...base,
      players: base.players.map(p => {
        const explicitlyVisible = spectatorState.playerVisibility.get(p.id) === true;
        return explicitlyVisible ? p : { ...p, holeCards: null };
      }),
    };
  }

  private clearTimer(state: SpectatorPlaybackState): void {
    if (state.timer) {
      clearTimeout(state.timer);
      state.timer = null;
    }
  }

  /** Clean up all timers. */
  destroy(): void {
    for (const state of this.spectators.values()) {
      this.clearTimer(state);
    }
    this.spectators.clear();
  }
}
