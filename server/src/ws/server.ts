/**
 * WebSocket server setup with Fastify.
 */

import type { FastifyInstance } from 'fastify';
import type { Logger } from 'pino';
import type { SessionManager } from './session.js';
import type { GameManager } from '../game-manager.js';
import { createRouter } from './router.js';

export function registerWebSocket(
  app: FastifyInstance,
  sessionManager: SessionManager,
  gameManager: GameManager,
  logger: Logger
): void {
  const route = createRouter(sessionManager, gameManager, logger);

  app.get('/ws', { websocket: true }, (socket, _request) => {
    logger.info('New WebSocket connection');

    socket.on('message', (data) => {
      const raw = typeof data === 'string' ? data : data.toString('utf-8');
      route(socket, raw);
    });

    socket.on('close', () => {
      const playerId = sessionManager.disconnect(socket);
      if (playerId) {
        // Find the player's game and mark them disconnected
        const session = sessionManager.getByPlayerId(playerId);
        if (session?.gameId) {
          gameManager.setPlayerConnected(session.gameId, playerId, false);
          logger.info({ playerId, gameId: session.gameId }, 'Player disconnected from game');
        }
      }
    });

    socket.on('error', (err) => {
      logger.error({ err }, 'WebSocket error');
    });
  });
}
