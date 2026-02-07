/**
 * Admin REST API routes for game management.
 */

import type { FastifyInstance } from 'fastify';
import type { Logger } from 'pino';
import { z } from 'zod';
import { createGame, getGameById, listGames, deleteGame, getGamePlayers, getGamePlayerCount } from './db/queries.js';
import type { GameManager } from './game-manager.js';
import type { SessionManager } from './ws/session.js';

const CreateGameBody = z.object({
  name: z.string().min(1).max(64),
  gameType: z.enum(['cash', 'tournament']).default('cash'),
  smallBlind: z.number().int().min(1),
  bigBlind: z.number().int().min(1),
  maxPlayers: z.number().int().min(2).max(10).default(9),
  startingStack: z.number().int().min(1).default(1000),
});

export function registerAdminRoutes(
  app: FastifyInstance,
  gameManager: GameManager,
  sessionManager: SessionManager,
  logger: Logger
): void {
  // List all games
  app.get('/api/games', async (_request, reply) => {
    const games = listGames();
    const result = games.map((g) => ({
      ...g,
      playerCount: getGamePlayerCount(g.id),
    }));
    return reply.send(result);
  });

  // Get game detail
  app.get<{ Params: { id: string } }>('/api/games/:id', async (request, reply) => {
    const game = getGameById(request.params.id);
    if (!game) return reply.status(404).send({ error: 'Game not found' });

    const players = getGamePlayers(game.id);
    return reply.send({ ...game, players });
  });

  // Create a game
  app.post('/api/games', async (request, reply) => {
    const body = CreateGameBody.safeParse(request.body);
    if (!body.success) {
      return reply.status(400).send({ error: body.error.issues.map((i) => i.message).join('; ') });
    }

    const game = createGame({
      name: body.data.name,
      gameType: body.data.gameType,
      smallBlind: body.data.smallBlind,
      bigBlind: body.data.bigBlind,
      maxPlayers: body.data.maxPlayers,
      startingStack: body.data.startingStack,
    });

    // Activate in memory
    gameManager.activateGame(game.id);

    logger.info({ gameId: game.id, name: game.name }, 'Game created via admin API');
    return reply.status(201).send(game);
  });

  // Force-start a game
  app.post<{ Params: { id: string } }>('/api/games/:id/start', async (request, reply) => {
    const game = getGameById(request.params.id);
    if (!game) return reply.status(404).send({ error: 'Game not found' });

    const started = gameManager.forceStartGame(request.params.id, sessionManager);
    if (!started) {
      return reply.status(400).send({ error: 'Cannot start game (already in progress or not enough players)' });
    }

    logger.info({ gameId: request.params.id }, 'Game force-started via admin API');
    return reply.send({ ok: true });
  });

  // Delete (cancel) a game
  app.delete<{ Params: { id: string } }>('/api/games/:id', async (request, reply) => {
    const deleted = deleteGame(request.params.id);
    if (!deleted) {
      return reply.status(400).send({ error: 'Cannot delete game (not found or already in progress)' });
    }

    logger.info({ gameId: request.params.id }, 'Game deleted via admin API');
    return reply.send({ ok: true });
  });
}
