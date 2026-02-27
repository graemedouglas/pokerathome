/**
 * Admin REST API routes for game management.
 */

import type { FastifyInstance } from 'fastify';
import type { FastifyBaseLogger } from 'fastify';
import { z } from 'zod';
import { ReplayFile } from '@pokerathome/schema';
import { createGame, getGameById, listGames, deleteGame, getGamePlayers, getGamePlayerCount } from './db/queries.js';
import type { GameManager } from './game-manager.js';
import type { SessionManager } from './ws/session.js';
import type { ReplayGameManager } from './replay/index.js';
import { listReplayFiles, saveReplayFile } from './replay/storage.js';

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
  tournamentLengthHours: z.number().min(0.25).max(24).optional(),
  roundLengthMinutes: z.number().int().min(1).max(120).optional(),
  antesEnabled: z.boolean().default(false),
});

const SetSpectatorVisibilityBody = z.object({
  spectatorVisibility: z.enum(['showdown', 'delayed', 'immediate']),
});

export function registerAdminRoutes(
  app: FastifyInstance,
  gameManager: GameManager,
  sessionManager: SessionManager,
  logger: FastifyBaseLogger,
  replayGameManager?: ReplayGameManager,
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

    // For tournaments, force starting blinds to 25/50 and stack to 5000
    const isTournament = body.data.gameType === 'tournament';
    const game = createGame({
      name: body.data.name,
      gameType: body.data.gameType,
      smallBlind: isTournament ? 25 : body.data.smallBlind,
      bigBlind: isTournament ? 50 : body.data.bigBlind,
      maxPlayers: body.data.maxPlayers,
      startingStack: isTournament ? 5000 : body.data.startingStack,
      spectatorVisibility: body.data.spectatorVisibility,
      tournamentLengthHours: body.data.tournamentLengthHours,
      roundLengthMinutes: body.data.roundLengthMinutes,
      antesEnabled: body.data.antesEnabled,
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

  // Pause a tournament game
  app.post<{ Params: { id: string } }>('/api/games/:id/pause', async (request, reply) => {
    const game = getGameById(request.params.id);
    if (!game) return reply.status(404).send({ error: 'Game not found' });
    if (game.game_type !== 'tournament') {
      return reply.status(400).send({ error: 'Only tournament games can be paused' });
    }

    const ok = gameManager.pauseGame(request.params.id, sessionManager);
    if (!ok) {
      return reply.status(400).send({ error: 'Cannot pause game (not in progress or already paused)' });
    }

    logger.info({ gameId: request.params.id }, 'Tournament paused via admin API');
    return reply.send({ ok: true });
  });

  // Resume a paused tournament game
  app.post<{ Params: { id: string } }>('/api/games/:id/resume', async (request, reply) => {
    const game = getGameById(request.params.id);
    if (!game) return reply.status(404).send({ error: 'Game not found' });
    if (game.game_type !== 'tournament') {
      return reply.status(400).send({ error: 'Only tournament games can be resumed' });
    }

    const ok = gameManager.resumeGame(request.params.id, sessionManager);
    if (!ok) {
      return reply.status(400).send({ error: 'Cannot resume game (not paused)' });
    }

    logger.info({ gameId: request.params.id }, 'Tournament resumed via admin API');
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

  // ─── Replay routes ──────────────────────────────────────────────────────────

  // List available replay files
  app.get('/api/replays', async (_request, reply) => {
    const replays = listReplayFiles();
    return reply.send(replays);
  });

  // Upload a replay file
  app.post('/api/replays/upload', async (request, reply) => {
    const body = ReplayFile.safeParse(request.body);
    if (!body.success) {
      return reply.status(400).send({ error: 'Invalid replay file format' });
    }
    const filePath = saveReplayFile(body.data.gameConfig.gameId, body.data);
    logger.info({ filePath }, 'Replay file uploaded');
    return reply.status(201).send({ filePath, gameId: body.data.gameConfig.gameId });
  });

  // Create a replay game from a file
  app.post('/api/replays/create-game', async (request, reply) => {
    if (!replayGameManager) {
      return reply.status(500).send({ error: 'Replay system not available' });
    }
    const body = z.object({ filePath: z.string() }).safeParse(request.body);
    if (!body.success) {
      return reply.status(400).send({ error: 'filePath is required' });
    }
    try {
      const replayGameId = replayGameManager.createReplayGame(body.data.filePath);
      logger.info({ replayGameId, filePath: body.data.filePath }, 'Replay game created via admin API');
      return reply.status(201).send({ replayGameId });
    } catch (err) {
      logger.error({ err }, 'Failed to create replay game');
      return reply.status(400).send({ error: 'Failed to create replay game' });
    }
  });

  // List active replay games
  app.get('/api/replay-games', async (_request, reply) => {
    if (!replayGameManager) {
      return reply.send([]);
    }
    return reply.send(replayGameManager.getReplayGameList());
  });

  // Get replay players (for card visibility panel)
  app.get<{ Params: { id: string } }>('/api/replay-games/:id/players', async (request, reply) => {
    if (!replayGameManager) {
      return reply.status(404).send({ error: 'Replay system not available' });
    }
    const players = replayGameManager.getReplayPlayers(request.params.id);
    return reply.send(players);
  });
}
