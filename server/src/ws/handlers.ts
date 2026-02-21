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
  ReplayControlPayload,
  ReplayCardVisibilityPayload,
} from '@pokerathome/schema';
import type { SessionManager, PlayerSession } from './session.js';
import type { GameManager } from '../game-manager.js';
import type { ReplayGameManager } from '../replay/index.js';
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
  _logger: FastifyBaseLogger,
  replayGameManager?: ReplayGameManager,
): void {
  const games = gameManager.getGameList();

  // Append active replay games to the list
  const replayGames = replayGameManager?.getReplayGameList() ?? [];
  const replayListItems = replayGames.map(rg => ({
    gameId: rg.replayGameId,
    name: `[Replay] ${rg.gameName}`,
    gameType: rg.gameType as 'cash' | 'tournament',
    playerCount: rg.spectatorCount,
    maxPlayers: 99,
    smallBlindAmount: rg.smallBlindAmount,
    bigBlindAmount: rg.bigBlindAmount,
    status: 'in_progress' as const,
    isReplay: true,
  }));

  sessions.send(session.playerId, {
    action: 'gameList',
    payload: { games: [...games, ...replayListItems] },
  });
}

// ─── joinGame ───────────────────────────────────────────────────────────────────

export function handleJoinGame(
  session: PlayerSession,
  payload: JoinGamePayload,
  sessions: SessionManager,
  gameManager: GameManager,
  logger: FastifyBaseLogger,
  replayGameManager?: ReplayGameManager,
): void {
  if (session.gameId) {
    sessions.send(session.playerId, {
      action: 'error',
      payload: { code: 'ALREADY_IN_GAME', message: 'You are already in a game. Leave first.' },
    });
    return;
  }

  // Check if this is a replay game
  if (replayGameManager?.isReplayGame(payload.gameId)) {
    const joined = replayGameManager.joinReplayGame(payload.gameId, session.playerId);
    if (!joined) {
      sessions.send(session.playerId, {
        action: 'error',
        payload: { code: 'GAME_NOT_FOUND', message: 'Replay game not found' },
      });
      return;
    }
    sessions.setGameId(session.playerId, payload.gameId);
    logger.info({ playerId: session.playerId, replayGameId: payload.gameId }, 'Player joined replay game');
    // ReplayInstance.addSpectator() already sends initial replayState
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

  const chatPayload = {
    playerId: session.playerId,
    displayName: session.displayName,
    message: payload.message,
    timestamp: new Date().toISOString(),
    role,
  };

  sessions.broadcast(session.gameId, {
    action: 'chatMessage',
    payload: chatPayload,
  });

  // Record chat for replay
  gameManager.getRecorder(session.gameId)?.recordChat(chatPayload);
}

// ─── leaveGame ──────────────────────────────────────────────────────────────────

export function handleLeaveGame(
  session: PlayerSession,
  sessions: SessionManager,
  gameManager: GameManager,
  logger: FastifyBaseLogger,
  replayGameManager?: ReplayGameManager,
): void {
  if (!session.gameId) {
    sessions.send(session.playerId, {
      action: 'error',
      payload: { code: 'NOT_IN_GAME', message: 'You are not in a game.' },
    });
    return;
  }

  const gameId = session.gameId;

  // Check if this is a replay game
  if (replayGameManager?.isReplayGame(gameId)) {
    replayGameManager.leaveReplayGame(gameId, session.playerId);
    sessions.setGameId(session.playerId, null);
    logger.info({ playerId: session.playerId, replayGameId: gameId }, 'Player left replay game');
    return;
  }

  gameManager.removePlayer(gameId, session.playerId, sessions);
  sessions.setGameId(session.playerId, null);
  logger.info({ playerId: session.playerId, gameId }, 'Player left game');
}

// ─── replayControl ──────────────────────────────────────────────────────────────

export function handleReplayControl(
  session: PlayerSession,
  payload: ReplayControlPayload,
  replayGameManager: ReplayGameManager,
  _logger: FastifyBaseLogger,
): void {
  if (!session.gameId) return;
  replayGameManager.handleControl(
    session.gameId,
    session.playerId,
    payload.command,
    payload.speed,
    payload.position,
  );
}

// ─── replayCardVisibility ───────────────────────────────────────────────────────

export function handleReplayCardVisibility(
  session: PlayerSession,
  payload: ReplayCardVisibilityPayload,
  replayGameManager: ReplayGameManager,
  _logger: FastifyBaseLogger,
): void {
  if (!session.gameId) return;
  replayGameManager.handleCardVisibility(
    session.gameId,
    session.playerId,
    payload.showAllCards,
    payload.playerVisibility,
  );
}

// ─── Helpers ────────────────────────────────────────────────────────────────────

function sendError(socket: WebSocket, code: string, message: string): void {
  if (socket.readyState !== 1) return;
  socket.send(JSON.stringify({ action: 'error', payload: { code, message } }));
}
