/**
 * Poker@Home Server — entry point.
 *
 * Bootstraps Fastify, WebSocket, SQLite, and the game manager.
 */

import fs from 'node:fs';
import Fastify from 'fastify';
import websocket from '@fastify/websocket';
import cors from '@fastify/cors';
import { config } from './config.js';
import { initDb, closeDb } from './db/index.js';
import { SessionManager } from './ws/session.js';
import { GameManager } from './game-manager.js';
import { registerWebSocket } from './ws/server.js';
import { registerAdminRoutes } from './admin-api.js';

// Lightweight startup tracer — writes to logs/startup.log so we can diagnose
// health-check failures even when the pino transport itself is the problem.
fs.mkdirSync('./logs', { recursive: true });
const STARTUP_LOG = './logs/startup.log';
fs.writeFileSync(STARTUP_LOG, ''); // clear on each run
function trace(msg: string): void {
  const line = `[${new Date().toISOString()}] ${msg}\n`;
  fs.appendFileSync(STARTUP_LOG, line);
}

async function main() {
  try {
    trace(`config loaded — PORT=${config.PORT} HOST=${config.HOST} LOG_FILE=${config.LOG_FILE} LOG_LEVEL=${config.LOG_LEVEL}`);

    // Build transport: always pretty-print to stdout; also write raw NDJSON to
    // a log file (always at debug level) when LOG_FILE is set so that
    // spectator-tx / player-tx entries are captured even when stdout is info.
    const useFileTransport = Boolean(config.LOG_FILE);
    trace(`building pino transport (file=${useFileTransport})`);

    const transport = useFileTransport
      ? {
          targets: [
            { target: 'pino-pretty', options: { colorize: true }, level: config.LOG_LEVEL },
            { target: 'pino/file',   options: { destination: config.LOG_FILE, mkdir: true }, level: 'debug' },
          ],
        }
      : { target: 'pino-pretty', options: { colorize: true } };

    trace('creating Fastify app');
    const app = Fastify({
      logger: {
        // Root level must be 'debug' so debug messages aren't dropped before
        // reaching per-target level filters above.
        level: 'debug',
        transport,
      },
    });
    trace('Fastify app created');

    const logger = app.log;

    // Initialize database
    trace('initializing database');
    const db = initDb(logger);
    trace('database initialized');

    // Register plugins
    trace('registering cors plugin');
    await app.register(cors, { origin: true });
    trace('registering websocket plugin');
    await app.register(websocket);
    trace('plugins registered');

    // Create managers
    trace('creating SessionManager + GameManager');
    const sessionManager = new SessionManager(logger);
    const gameManager = new GameManager(logger);
    trace('managers created');

    // Load any active games from DB (crash recovery)
    trace('loading active games from DB');
    gameManager.loadActiveGames();
    trace('active games loaded');

    // Register routes
    trace('registering routes (ws, admin, health)');
    registerWebSocket(app, sessionManager, gameManager, logger);
    registerAdminRoutes(app, gameManager, sessionManager, logger);
    app.get('/health', async () => ({ status: 'ok', sessions: sessionManager.size }));
    trace('routes registered');

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
    trace(`calling app.listen({ port: ${config.PORT}, host: '${config.HOST}' })`);
    await app.listen({ port: config.PORT, host: config.HOST });
    trace('app.listen resolved — server is ready');

    logger.info(`Server listening on http://${config.HOST}:${config.PORT}`);
    logger.info(`WebSocket endpoint: ws://${config.HOST}:${config.PORT}/ws`);
    logger.info(`Admin API: http://${config.HOST}:${config.PORT}/api/games`);
  } catch (err) {
    const msg = err instanceof Error ? err.stack ?? err.message : String(err);
    trace(`FATAL ERROR: ${msg}`);
    console.error('Server failed to start:', err);
    process.exit(1);
  }
}

main();
