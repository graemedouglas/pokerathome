/**
 * Admin REST API routes for game management.
 */

import type { FastifyInstance } from 'fastify';
import type { FastifyBaseLogger } from 'fastify';
import { z } from 'zod';
import { createGame, getGameById, listGames, deleteGame, getGamePlayers, getGamePlayerCount } from './db/queries.js';
import type { GameManager } from './game-manager.js';
import type { SessionManager } from './ws/session.js';

const AddBotBody = z.object({
  botType: z.enum(['calling-station', 'tag-bot']),
  displayName: z.string().min(1).max(64).optional(),
});

const CreateGameBody = z.object({
  name: z.string().min(1).max(64),
  gameType: z.enum(['cash', 'tournament']).default('cash'),
  smallBlind: z.number().int().min(1),
  bigBlind: z.number().int().min(1),
  maxPlayers: z.number().int().min(2).max(10).default(9),
  startingStack: z.number().int().min(1).default(1000),
  spectatorVisibility: z.enum(['showdown', 'delayed', 'immediate']).default('showdown'),
});

const SetSpectatorVisibilityBody = z.object({
  spectatorVisibility: z.enum(['showdown', 'delayed', 'immediate']),
});

export function registerAdminRoutes(
  app: FastifyInstance,
  gameManager: GameManager,
  sessionManager: SessionManager,
  logger: FastifyBaseLogger
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
      return reply.status(400).send({ error: body.error.issues.map((i: { message: string }) => i.message).join('; ') });
    }

    const game = createGame({
      name: body.data.name,
      gameType: body.data.gameType,
      smallBlind: body.data.smallBlind,
      bigBlind: body.data.bigBlind,
      maxPlayers: body.data.maxPlayers,
      startingStack: body.data.startingStack,
      spectatorVisibility: body.data.spectatorVisibility,
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

  // Add a bot to a game
  app.post<{ Params: { id: string } }>('/api/games/:id/add-bot', async (request, reply) => {
    const game = getGameById(request.params.id);
    if (!game) return reply.status(404).send({ error: 'Game not found' });
    if (game.status !== 'waiting') {
      return reply.status(400).send({ error: 'Can only add bots to waiting games' });
    }

    const body = AddBotBody.safeParse(request.body);
    if (!body.success) {
      return reply.status(400).send({ error: body.error.issues.map((i: { message: string }) => i.message).join('; ') });
    }

    const currentCount = getGamePlayerCount(request.params.id);
    if (currentCount >= game.max_players) {
      return reply.status(400).send({ error: 'Game is full' });
    }

    const displayName = body.data.displayName ?? `Bot (${body.data.botType})`;
    const result = await gameManager.addBot(request.params.id, body.data.botType, displayName);

    if (!result.ok) {
      return reply.status(500).send({ error: result.error });
    }

    logger.info({ gameId: request.params.id, botType: body.data.botType, displayName }, 'Bot added via admin API');
    return reply.status(201).send({ ok: true, displayName });
  });

  // Update spectator visibility for a game
  app.patch<{ Params: { id: string } }>('/api/games/:id/spectator-visibility', async (request, reply) => {
    const game = getGameById(request.params.id);
    if (!game) return reply.status(404).send({ error: 'Game not found' });

    const body = SetSpectatorVisibilityBody.safeParse(request.body);
    if (!body.success) {
      return reply.status(400).send({ error: body.error.issues.map((i: { message: string }) => i.message).join('; ') });
    }

    const ok = gameManager.setSpectatorVisibility(request.params.id, body.data.spectatorVisibility);
    if (!ok) {
      return reply.status(404).send({ error: 'Game not found' });
    }

    logger.info({ gameId: request.params.id, spectatorVisibility: body.data.spectatorVisibility }, 'Spectator visibility updated via admin API');
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
