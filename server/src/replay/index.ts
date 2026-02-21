/**
 * ReplayGameManager — manages all active replay game instances.
 *
 * Orchestrates creating replay games from files, connecting spectators,
 * and routing control messages to the correct ReplayInstance.
 */

import type { FastifyBaseLogger } from 'fastify';
import type { ReplayFile } from '@pokerathome/schema';
import type { SessionManager } from '../ws/session.js';
import { ReplayInstance } from './replay-manager.js';
import { loadReplayFile } from './storage.js';
import { v4 as uuidv4 } from 'uuid';

export class ReplayGameManager {
  private instances = new Map<string, ReplayInstance>();

  constructor(
    private sessions: SessionManager,
    private logger: FastifyBaseLogger,
  ) {}

  /** Create a replay game from a file path. Returns the replay game ID. */
  createReplayGame(filePath: string): string {
    const data = loadReplayFile(filePath) as ReplayFile;
    const replayGameId = uuidv4();
    const instance = new ReplayInstance(replayGameId, data, this.sessions, this.logger);
    this.instances.set(replayGameId, instance);
    this.logger.info(
      { replayGameId, originalGameId: data.gameConfig.gameId, gameName: data.gameConfig.gameName },
      'Replay game created',
    );
    return replayGameId;
  }

  /** Create a replay game from already-parsed data. Returns the replay game ID. */
  createReplayGameFromData(data: ReplayFile): string {
    const replayGameId = uuidv4();
    const instance = new ReplayInstance(replayGameId, data, this.sessions, this.logger);
    this.instances.set(replayGameId, instance);
    this.logger.info(
      { replayGameId, originalGameId: data.gameConfig.gameId, gameName: data.gameConfig.gameName },
      'Replay game created from uploaded data',
    );
    return replayGameId;
  }

  joinReplayGame(replayGameId: string, playerId: string): boolean {
    const instance = this.instances.get(replayGameId);
    if (!instance) return false;
    instance.addSpectator(playerId);
    return true;
  }

  leaveReplayGame(replayGameId: string, playerId: string): void {
    const instance = this.instances.get(replayGameId);
    if (!instance) return;
    instance.removeSpectator(playerId);
    if (instance.spectatorCount === 0) {
      instance.destroy();
      this.instances.delete(replayGameId);
      this.logger.info({ replayGameId }, 'Replay game cleaned up (no spectators)');
    }
  }

  handleControl(
    replayGameId: string,
    playerId: string,
    command: string,
    speed?: number,
    position?: number,
  ): void {
    this.instances.get(replayGameId)?.handleControl(playerId, command, speed, position);
  }

  handleCardVisibility(
    replayGameId: string,
    playerId: string,
    showAllCards?: boolean,
    playerVisibility?: Record<string, boolean>,
  ): void {
    this.instances.get(replayGameId)?.handleCardVisibility(playerId, showAllCards, playerVisibility);
  }

  isReplayGame(gameId: string): boolean {
    return this.instances.has(gameId);
  }

  getReplayGameList(): Array<{
    replayGameId: string;
    gameName: string;
    spectatorCount: number;
    gameType: string;
    smallBlindAmount: number;
    bigBlindAmount: number;
  }> {
    return [...this.instances.entries()].map(([id, inst]) => ({
      replayGameId: id,
      gameName: inst.replayData.gameConfig.gameName,
      spectatorCount: inst.spectatorCount,
      gameType: inst.replayData.gameConfig.gameType,
      smallBlindAmount: inst.replayData.gameConfig.smallBlindAmount,
      bigBlindAmount: inst.replayData.gameConfig.bigBlindAmount,
    }));
  }

  /** Get the original players from a replay game (for card visibility panel). */
  getReplayPlayers(replayGameId: string): Array<{ id: string; displayName: string }> {
    const instance = this.instances.get(replayGameId);
    if (!instance) return [];
    return instance.replayData.players
      .filter(p => p.role === 'player')
      .map(p => ({ id: p.id, displayName: p.displayName }));
  }
}
