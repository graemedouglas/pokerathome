/**
 * Poker@Home Server — entry point.
 *
 * Bootstraps Fastify, WebSocket, SQLite, and the game manager.
 */

import Fastify from 'fastify';
import websocket from '@fastify/websocket';
import cors from '@fastify/cors';
import { config } from './config.js';
import { initDb, closeDb } from './db/index.js';
import { SessionManager } from './ws/session.js';
import { GameManager } from './game-manager.js';
import { registerWebSocket } from './ws/server.js';
import { registerAdminRoutes } from './admin-api.js';

async function main() {
  const app = Fastify({
    logger: {
      level: config.LOG_LEVEL,
      transport: {
        target: 'pino-pretty',
        options: { colorize: true },
      },
    },
  });

  const logger = app.log;

  // Initialize database
  const db = initDb(logger);

  // Register plugins
  await app.register(cors, { origin: true });
  await app.register(websocket);

  // Create managers
  const sessionManager = new SessionManager(logger);
  const gameManager = new GameManager(logger);

  // Load any active games from DB (crash recovery)
  gameManager.loadActiveGames();

  // Register routes
  registerWebSocket(app, sessionManager, gameManager, logger);
  registerAdminRoutes(app, gameManager, sessionManager, logger);

  // Health check
  app.get('/health', async () => ({ status: 'ok', sessions: sessionManager.size }));

  // Graceful shutdown
  const shutdown = async () => {
    logger.info('Shutting down...');
    await app.close();
    closeDb(logger);
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  // Start server
  try {
    await app.listen({ port: config.PORT, host: config.HOST });
    logger.info(`Server listening on http://${config.HOST}:${config.PORT}`);
    logger.info(`WebSocket endpoint: ws://${config.HOST}:${config.PORT}/ws`);
    logger.info(`Admin API: http://${config.HOST}:${config.PORT}/api/games`);
  } catch (err) {
    logger.fatal({ err }, 'Failed to start server');
    process.exit(1);
  }
}

main();
