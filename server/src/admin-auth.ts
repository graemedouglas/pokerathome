import crypto from 'node:crypto';
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { config } from './config.js';

const activeSessions = new Set<string>();

export function registerAuthRoutes(app: FastifyInstance): void {
  app.post('/api/auth/login', async (request, reply) => {
    const { password } = request.body as { password?: string };
    if (!password || password !== config.ADMIN_PASSWORD) {
      return reply.status(401).send({ error: 'Invalid password' });
    }
    const token = crypto.randomUUID();
    activeSessions.add(token);
    return { token };
  });

  app.post('/api/auth/logout', async (request) => {
    const token = extractBearerToken(request);
    if (token) activeSessions.delete(token);
    return { ok: true };
  });

  app.get('/api/auth/check', async (request, reply) => {
    const token = extractBearerToken(request);
    if (!token || !activeSessions.has(token)) {
      return reply.status(401).send({ authenticated: false });
    }
    return { authenticated: true };
  });
}

/** Fastify onRequest hook — rejects unauthenticated requests to /api/* */
export function adminAuthHook(
  request: FastifyRequest,
  reply: FastifyReply,
  done: () => void,
): void {
  // Skip auth endpoints and health check
  if (request.url.startsWith('/api/auth/') || request.url === '/health') {
    return done();
  }
  // Only protect /api/* routes
  if (!request.url.startsWith('/api/')) {
    return done();
  }

  const token = extractBearerToken(request);
  if (!token || !activeSessions.has(token)) {
    reply.status(401).send({ error: 'Unauthorized' });
    return;
  }
  done();
}

function extractBearerToken(request: FastifyRequest): string | null {
  const auth = request.headers.authorization;
  if (auth?.startsWith('Bearer ')) return auth.slice(7);
  return null;
}

/** For testing: clear all active sessions */
export function clearSessions(): void {
  activeSessions.clear();
}
