/**
 * WebSocket message handlers. One function per client action.
 */

import type { WebSocket } from 'ws';
import type { FastifyBaseLogger } from 'fastify';
import type {
  IdentifyPayload,
  JoinGamePayload,
  PlayerActionPayload,
  RevealCardsPayload,
  ChatSendPayload,
} from '@pokerathome/schema';
import type { SessionManager, PlayerSession } from './session.js';
import type { GameManager } from '../game-manager.js';
import {
  createPlayer,
  getPlayerByReconnectToken,
  rotateReconnectToken,
  getPlayerGame,
} from '../db/queries.js';

// ─── identify ───────────────────────────────────────────────────────────────────

export function handleIdentify(
  socket: WebSocket,
  payload: IdentifyPayload,
  sessions: SessionManager,
  gameManager: GameManager,
  logger: FastifyBaseLogger
): void {
  let playerId: string;
  let reconnectToken: string;

  if (payload.reconnectToken) {
    // Reconnect flow
    const existingPlayer = getPlayerByReconnectToken(payload.reconnectToken);
    if (!existingPlayer) {
      sendError(socket, 'INVALID_MESSAGE', 'Invalid reconnect token');
      return;
    }
    playerId = existingPlayer.id;
    // Rotate token on reconnect for security
    reconnectToken = rotateReconnectToken(playerId);
    logger.info({ playerId, displayName: payload.displayName }, 'Player reconnected');
  } else {
    // New player
    const player = createPlayer(payload.displayName);
    playerId = player.id;
    reconnectToken = player.reconnect_token;
    logger.info({ playerId, displayName: payload.displayName }, 'New player identified');
  }

  sessions.register(playerId, payload.displayName, socket);

  // Check if player was in a game (reconnect scenario)
  const gamePlayer = getPlayerGame(playerId);
  let currentGame: object | undefined;

  if (gamePlayer) {
    if (gamePlayer.role === 'spectator') {
      // Spectators don't reconnect — clean up stale record and let them rejoin fresh
      gameManager.removePlayer(gamePlayer.game_id, playerId, sessions);
      sessions.setGameId(playerId, null);
      logger.info({ playerId, gameId: gamePlayer.game_id }, 'Stale spectator record cleaned up on identify');
    } else {
      sessions.setGameId(playerId, gamePlayer.game_id);
      currentGame = gameManager.getReconnectState(playerId, gamePlayer.game_id);
      gameManager.setPlayerConnected(gamePlayer.game_id, playerId, true);
      logger.info({ playerId, gameId: gamePlayer.game_id }, 'Player reconnected to game');
    }
  }

  sessions.send(playerId, {
    action: 'identified',
    payload: {
      playerId,
      reconnectToken,
      ...(currentGame ? { currentGame } : {}),
    },
  });
}

// ─── listGames ──────────────────────────────────────────────────────────────────

export function handleListGames(
  session: PlayerSession,
  sessions: SessionManager,
  gameManager: GameManager,
  _logger: FastifyBaseLogger
): void {
  const games = gameManager.getGameList();
  sessions.send(session.playerId, {
    action: 'gameList',
    payload: { games },
  });
}

// ─── joinGame ───────────────────────────────────────────────────────────────────

export function handleJoinGame(
  session: PlayerSession,
  payload: JoinGamePayload,
  sessions: SessionManager,
  gameManager: GameManager,
  logger: FastifyBaseLogger
): void {
  if (session.gameId) {
    sessions.send(session.playerId, {
      action: 'error',
      payload: { code: 'ALREADY_IN_GAME', message: 'You are already in a game. Leave first.' },
    });
    return;
  }

  const role = payload.role ?? 'player';
  const result = gameManager.joinGame(payload.gameId, session.playerId, session.displayName, role);
  if (!result.ok) {
    sessions.send(session.playerId, {
      action: 'error',
      payload: { code: result.errorCode!, message: result.errorMessage! },
    });
    return;
  }

  sessions.setGameId(session.playerId, payload.gameId);
  logger.info({ playerId: session.playerId, gameId: payload.gameId }, 'Player joined game');

  // Send gameJoined to the joining player
  sessions.send(session.playerId, {
    action: 'gameJoined',
    payload: { gameState: result.gameState, handEvents: result.handEvents },
  });

  // Broadcast PLAYER_JOINED event to others in the game
  if (result.joinEvent) {
    sessions.broadcastPersonalized(payload.gameId, (viewerId) => ({
      action: 'gameState',
      payload: gameManager.buildStatePayload(payload.gameId, result.joinEvent!, viewerId),
    }));
  }
}

// ─── ready ──────────────────────────────────────────────────────────────────────

export function handleReady(
  session: PlayerSession,
  sessions: SessionManager,
  gameManager: GameManager,
  logger: FastifyBaseLogger
): void {
  if (!session.gameId) {
    sessions.send(session.playerId, {
      action: 'error',
      payload: { code: 'NOT_IN_GAME', message: 'You are not in a game.' },
    });
    return;
  }

  gameManager.setPlayerReady(session.gameId, session.playerId);
  logger.info({ playerId: session.playerId, gameId: session.gameId }, 'Player ready');

  // Check if game can auto-start
  gameManager.tryStartGame(session.gameId, sessions);
}

// ─── playerAction ───────────────────────────────────────────────────────────────

export function handlePlayerAction(
  session: PlayerSession,
  payload: PlayerActionPayload,
  sessions: SessionManager,
  gameManager: GameManager,
  logger: FastifyBaseLogger
): void {
  if (!session.gameId) {
    sessions.send(session.playerId, {
      action: 'error',
      payload: { code: 'NOT_IN_GAME', message: 'You are not in a game.' },
    });
    return;
  }

  const result = gameManager.handleAction(
    session.gameId,
    session.playerId,
    payload.handNumber,
    payload.type,
    sessions,
    payload.amount
  );

  if (!result.ok) {
    sessions.send(session.playerId, {
      action: 'error',
      payload: { code: result.errorCode!, message: result.errorMessage! },
    });
    return;
  }

  logger.info(
    { playerId: session.playerId, gameId: session.gameId, action: payload.type, amount: payload.amount },
    'Player action processed'
  );

  // Transitions are broadcast by the game manager
}

// ─── revealCards ────────────────────────────────────────────────────────────────

export function handleRevealCards(
  session: PlayerSession,
  payload: RevealCardsPayload,
  sessions: SessionManager,
  gameManager: GameManager,
  logger: FastifyBaseLogger
): void {
  if (!session.gameId) {
    sessions.send(session.playerId, {
      action: 'error',
      payload: { code: 'NOT_IN_GAME', message: 'You are not in a game.' },
    });
    return;
  }

  const result = gameManager.handleRevealCards(session.gameId, session.playerId, payload.handNumber);
  if (!result.ok) {
    sessions.send(session.playerId, {
      action: 'error',
      payload: { code: result.errorCode!, message: result.errorMessage! },
    });
    return;
  }

  gameManager.broadcastRevealCards(session.gameId, session.playerId, sessions);
  logger.info({ playerId: session.playerId, gameId: session.gameId }, 'Player revealed cards');
}

// ─── chat ───────────────────────────────────────────────────────────────────────

export function handleChat(
  session: PlayerSession,
  payload: ChatSendPayload,
  sessions: SessionManager,
  gameManager: GameManager,
  _logger: FastifyBaseLogger
): void {
  if (!session.gameId) {
    sessions.send(session.playerId, {
      action: 'error',
      payload: { code: 'NOT_IN_GAME', message: 'You are not in a game.' },
    });
    return;
  }

  // Look up sender's role from the game engine state
  const engineState = gameManager.getActiveGameState(session.gameId);
  const senderPlayer = engineState?.players.find(p => p.id === session.playerId);
  const role = senderPlayer?.role ?? 'player';

  sessions.broadcast(session.gameId, {
    action: 'chatMessage',
    payload: {
      playerId: session.playerId,
      displayName: session.displayName,
      message: payload.message,
      timestamp: new Date().toISOString(),
      role,
    },
  });
}

// ─── leaveGame ──────────────────────────────────────────────────────────────────

export function handleLeaveGame(
  session: PlayerSession,
  sessions: SessionManager,
  gameManager: GameManager,
  logger: FastifyBaseLogger
): void {
  if (!session.gameId) {
    sessions.send(session.playerId, {
      action: 'error',
      payload: { code: 'NOT_IN_GAME', message: 'You are not in a game.' },
    });
    return;
  }

  const gameId = session.gameId;
  gameManager.removePlayer(gameId, session.playerId, sessions);
  sessions.setGameId(session.playerId, null);
  logger.info({ playerId: session.playerId, gameId }, 'Player left game');
}

// ─── Helpers ────────────────────────────────────────────────────────────────────

function sendError(socket: WebSocket, code: string, message: string): void {
  if (socket.readyState !== 1) return;
  socket.send(JSON.stringify({ action: 'error', payload: { code, message } }));
}
