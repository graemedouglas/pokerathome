/**
 * WebSocket server setup with Fastify.
 */

import type { FastifyInstance, FastifyBaseLogger } from 'fastify';
import type { SessionManager } from './session.js';
import type { GameManager } from '../game-manager.js';
import { createRouter } from './router.js';

export function registerWebSocket(
  app: FastifyInstance,
  sessionManager: SessionManager,
  gameManager: GameManager,
  logger: FastifyBaseLogger
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
        const session = sessionManager.getByPlayerId(playerId);
        if (session?.gameId) {
          const engineState = gameManager.getActiveGameState(session.gameId);
          const player = engineState?.players.find(p => p.id === playerId);

          if (player?.role === 'spectator') {
            // Spectators have no game state to preserve — remove on disconnect
            const gameId = session.gameId;
            gameManager.removePlayer(gameId, playerId, sessionManager);
            sessionManager.setGameId(playerId, null);
            logger.info({ playerId, gameId }, 'Spectator removed on disconnect');
          } else {
            gameManager.setPlayerConnected(session.gameId, playerId, false);
            logger.info({ playerId, gameId: session.gameId }, 'Player disconnected from game');
          }
        }
      }
    });

    socket.on('error', (err) => {
      logger.error({ err }, 'WebSocket error');
    });
  });
}
