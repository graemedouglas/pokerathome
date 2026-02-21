/**
 * ReplayRecorder — accumulates events during a live game for replay.
 *
 * Attached to each ActiveGame. Records game events with full engine state
 * snapshots and chat messages. Serializes to a ReplayFile on game end.
 */

import type { Event, ChatMessagePayload } from '@pokerathome/schema';
import { cloneState, type EngineState, type GameConfig } from '../engine/game.js';

interface RecorderEntry {
  index: number;
  timestamp: number;
  type: 'event' | 'chat';
  event?: Event;
  engineState?: EngineState;
  chat?: ChatMessagePayload;
}

export class ReplayRecorder {
  private entries: RecorderEntry[] = [];
  private startTime: number;
  private gameConfig: GameConfig;
  private players: Array<{ id: string; displayName: string; seatIndex: number; role: string }> = [];

  constructor(gameConfig: GameConfig) {
    this.gameConfig = gameConfig;
    this.startTime = Date.now();
  }

  /** Record a game event with the resulting engine state snapshot. */
  recordEvent(event: Event, engineState: EngineState): void {
    this.entries.push({
      index: this.entries.length,
      timestamp: Date.now() - this.startTime,
      type: 'event',
      event,
      engineState: cloneState(engineState),
    });
  }

  /** Record a chat message. */
  recordChat(chat: ChatMessagePayload): void {
    this.entries.push({
      index: this.entries.length,
      timestamp: Date.now() - this.startTime,
      type: 'chat',
      chat,
    });
  }

  /** Track a player joining the game. */
  recordPlayer(id: string, displayName: string, seatIndex: number, role: string): void {
    if (!this.players.find(p => p.id === id)) {
      this.players.push({ id, displayName, seatIndex, role });
    }
  }

  /** Serialize to the ReplayFile format for disk storage. */
  toReplayFile(): object {
    return {
      version: 1,
      gameConfig: {
        gameId: this.gameConfig.gameId,
        gameName: this.gameConfig.gameName,
        gameType: this.gameConfig.gameType,
        smallBlindAmount: this.gameConfig.smallBlindAmount,
        bigBlindAmount: this.gameConfig.bigBlindAmount,
        maxPlayers: this.gameConfig.maxPlayers,
        startingStack: this.gameConfig.startingStack,
      },
      players: this.players,
      entries: this.entries,
    };
  }

  get entryCount(): number {
    return this.entries.length;
  }
}
