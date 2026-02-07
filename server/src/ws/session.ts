/**
 * In-memory player session management.
 * Tracks connected players, their WebSocket connections, and game associations.
 */

import type { WebSocket } from 'ws';
import type { Logger } from 'pino';

export interface PlayerSession {
  playerId: string;
  displayName: string;
  socket: WebSocket;
  gameId: string | null;
  connectedAt: Date;
}

export class SessionManager {
  /** playerId -> session */
  private sessions = new Map<string, PlayerSession>();
  /** socket -> playerId (reverse lookup) */
  private socketToPlayer = new Map<WebSocket, string>();

  constructor(private logger: Logger) {}

  register(playerId: string, displayName: string, socket: WebSocket): void {
    // If player already has a session (reconnect), close old socket
    const existing = this.sessions.get(playerId);
    if (existing && existing.socket !== socket) {
      this.logger.info({ playerId }, 'Closing stale socket on reconnect');
      try { existing.socket.close(); } catch { /* already closed */ }
      this.socketToPlayer.delete(existing.socket);
    }

    const session: PlayerSession = {
      playerId,
      displayName,
      socket,
      gameId: existing?.gameId ?? null,
      connectedAt: new Date(),
    };

    this.sessions.set(playerId, session);
    this.socketToPlayer.set(socket, playerId);
    this.logger.info({ playerId, displayName }, 'Session registered');
  }

  getByPlayerId(playerId: string): PlayerSession | undefined {
    return this.sessions.get(playerId);
  }

  getBySocket(socket: WebSocket): PlayerSession | undefined {
    const playerId = this.socketToPlayer.get(socket);
    if (!playerId) return undefined;
    return this.sessions.get(playerId);
  }

  getPlayerIdBySocket(socket: WebSocket): string | undefined {
    return this.socketToPlayer.get(socket);
  }

  setGameId(playerId: string, gameId: string | null): void {
    const session = this.sessions.get(playerId);
    if (session) session.gameId = gameId;
  }

  disconnect(socket: WebSocket): string | undefined {
    const playerId = this.socketToPlayer.get(socket);
    if (!playerId) return undefined;

    this.socketToPlayer.delete(socket);
    // Don't remove the session itself — player might reconnect
    // Just note they're disconnected (the game manager handles connected state)
    this.logger.info({ playerId }, 'Socket disconnected');
    return playerId;
  }

  /** Send a JSON message to a specific player. */
  send(playerId: string, message: object): void {
    const session = this.sessions.get(playerId);
    if (!session) return;
    if (session.socket.readyState !== 1 /* WebSocket.OPEN */) return;

    try {
      session.socket.send(JSON.stringify(message));
    } catch (err) {
      this.logger.error({ err, playerId }, 'Failed to send message');
    }
  }

  /** Send a JSON message to all players in a game. */
  broadcast(gameId: string, message: object): void {
    for (const session of this.sessions.values()) {
      if (session.gameId === gameId) {
        this.send(session.playerId, message);
      }
    }
  }

  /** Send a personalized message to each player in a game. */
  broadcastPersonalized(gameId: string, messageFn: (playerId: string) => object): void {
    for (const session of this.sessions.values()) {
      if (session.gameId === gameId) {
        this.send(session.playerId, messageFn(session.playerId));
      }
    }
  }

  getPlayersInGame(gameId: string): PlayerSession[] {
    return [...this.sessions.values()].filter((s) => s.gameId === gameId);
  }

  get size(): number {
    return this.sessions.size;
  }
}
