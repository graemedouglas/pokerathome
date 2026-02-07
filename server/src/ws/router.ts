/**
 * WebSocket message router. Validates incoming messages with Zod,
 * dispatches to the appropriate handler.
 */

import type { WebSocket } from 'ws';
import type { FastifyBaseLogger } from 'fastify';
import { ClientMessage } from '@pokerathome/schema';
import type { SessionManager } from './session.js';
import type { GameManager } from '../game-manager.js';
import * as handlers from './handlers.js';

export function createRouter(
  sessionManager: SessionManager,
  gameManager: GameManager,
  logger: FastifyBaseLogger
) {
  return function handleMessage(socket: WebSocket, raw: string): void {
    // Parse JSON
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      sendError(socket, 'INVALID_MESSAGE', 'Malformed JSON');
      return;
    }

    // Validate against ClientMessage schema
    const result = ClientMessage.safeParse(parsed);
    if (!result.success) {
      const details = result.error.issues.map((i: { message: string }) => i.message).join('; ');
      sendError(socket, 'INVALID_MESSAGE', `Invalid message: ${details}`);
      return;
    }

    const message = result.data;
    const session = sessionManager.getBySocket(socket);

    // identify is the only action allowed without a session
    if (message.action !== 'identify' && !session) {
      sendError(socket, 'NOT_IDENTIFIED', 'Must identify before sending other messages');
      return;
    }

    try {
      switch (message.action) {
        case 'identify':
          handlers.handleIdentify(socket, message.payload, sessionManager, gameManager, logger);
          break;
        case 'listGames':
          handlers.handleListGames(session!, sessionManager, gameManager, logger);
          break;
        case 'joinGame':
          handlers.handleJoinGame(session!, message.payload, sessionManager, gameManager, logger);
          break;
        case 'ready':
          handlers.handleReady(session!, sessionManager, gameManager, logger);
          break;
        case 'playerAction':
          handlers.handlePlayerAction(session!, message.payload, sessionManager, gameManager, logger);
          break;
        case 'revealCards':
          handlers.handleRevealCards(session!, message.payload, sessionManager, gameManager, logger);
          break;
        case 'chat':
          handlers.handleChat(session!, message.payload, sessionManager, gameManager, logger);
          break;
        case 'leaveGame':
          handlers.handleLeaveGame(session!, sessionManager, gameManager, logger);
          break;
      }
    } catch (err) {
      logger.error({ err, action: message.action }, 'Handler error');
      sendError(socket, 'INVALID_MESSAGE', 'Internal server error');
    }
  };
}

function sendError(socket: WebSocket, code: string, message: string): void {
  if (socket.readyState !== 1) return;
  try {
    socket.send(JSON.stringify({
      action: 'error',
      payload: { code, message },
    }));
  } catch { /* socket might be closing */ }
}
