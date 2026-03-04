/**
 * Tests for admin authentication: login, logout, auth check,
 * and that all admin routes are protected.
 *
 * Uses Fastify inject() for fast in-process testing — no server spawn needed.
 */

import Fastify, { type FastifyInstance } from 'fastify'
import { registerAuthRoutes, adminAuthHook, clearSessions } from '../src/admin-auth.js'

let app: FastifyInstance

beforeAll(async () => {
  // Config defaults ADMIN_PASSWORD to 'admin'
  app = Fastify()

  // Register auth routes + global hook
  registerAuthRoutes(app)
  app.addHook('onRequest', adminAuthHook)

  // Stub admin routes (real admin-api.ts has heavy dependencies; we only
  // need route existence so the auth hook fires before them)
  app.get('/api/games', async () => ({ games: [] }))
  app.post('/api/games', async () => ({ id: 'stub' }))
  app.get('/api/games/:id', async () => ({ id: 'stub' }))
  app.post('/api/games/:id/start', async () => ({ ok: true }))
  app.post('/api/games/:id/add-bot', async () => ({ ok: true }))
  app.post('/api/games/:id/pause', async () => ({ ok: true }))
  app.post('/api/games/:id/resume', async () => ({ ok: true }))
  app.patch('/api/games/:id/spectator-visibility', async () => ({ ok: true }))
  app.delete('/api/games/:id', async () => ({ ok: true }))
  app.get('/api/replays', async () => ({ replays: [] }))
  app.post('/api/replays/upload', async () => ({ ok: true }))
  app.post('/api/replays/create-game', async () => ({ ok: true }))
  app.get('/api/replay-games', async () => ({ games: [] }))
  app.get('/api/replay-games/:id/players', async () => ({ players: [] }))

  // Non-admin route
  app.get('/health', async () => ({ status: 'ok' }))

  await app.ready()
})

afterAll(async () => {
  await app.close()
})

afterEach(() => {
  clearSessions()
})

/** Login helper — returns the auth token */
async function login(password = 'admin'): Promise<string> {
  const res = await app.inject({
    method: 'POST',
    url: '/api/auth/login',
    payload: { password },
  })
  expect(res.statusCode).toBe(200)
  return res.json().token
}

// ═══════════════════════════════════════════════════════════════════════════════
// Auth endpoints
// ═══════════════════════════════════════════════════════════════════════════════

describe('Auth endpoints', () => {
  test('login with correct password returns token', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { password: 'admin' },
    })
    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.token).toBeDefined()
    expect(typeof body.token).toBe('string')
    expect(body.token.length).toBeGreaterThan(0)
  })

  test('login with wrong password returns 401', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { password: 'wrong' },
    })
    expect(res.statusCode).toBe(401)
    expect(res.json().error).toBe('Invalid password')
  })

  test('login with empty password returns 401', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { password: '' },
    })
    expect(res.statusCode).toBe(401)
  })

  test('login with missing password returns 401', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: {},
    })
    expect(res.statusCode).toBe(401)
  })

  test('auth check with valid token returns 200', async () => {
    const token = await login()
    const res = await app.inject({
      method: 'GET',
      url: '/api/auth/check',
      headers: { authorization: `Bearer ${token}` },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json().authenticated).toBe(true)
  })

  test('auth check without token returns 401', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/auth/check',
    })
    expect(res.statusCode).toBe(401)
    expect(res.json().authenticated).toBe(false)
  })

  test('auth check with invalid token returns 401', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/auth/check',
      headers: { authorization: 'Bearer fake-token-12345' },
    })
    expect(res.statusCode).toBe(401)
  })

  test('logout invalidates the token', async () => {
    const token = await login()

    // Token works before logout
    const check1 = await app.inject({
      method: 'GET',
      url: '/api/auth/check',
      headers: { authorization: `Bearer ${token}` },
    })
    expect(check1.statusCode).toBe(200)

    // Logout
    const logoutRes = await app.inject({
      method: 'POST',
      url: '/api/auth/logout',
      headers: { authorization: `Bearer ${token}` },
    })
    expect(logoutRes.statusCode).toBe(200)

    // Token no longer works
    const check2 = await app.inject({
      method: 'GET',
      url: '/api/auth/check',
      headers: { authorization: `Bearer ${token}` },
    })
    expect(check2.statusCode).toBe(401)
  })

  test('multiple sessions can coexist', async () => {
    const token1 = await login()
    const token2 = await login()
    expect(token1).not.toBe(token2)

    // Both tokens are valid
    const check1 = await app.inject({
      method: 'GET',
      url: '/api/auth/check',
      headers: { authorization: `Bearer ${token1}` },
    })
    expect(check1.statusCode).toBe(200)

    const check2 = await app.inject({
      method: 'GET',
      url: '/api/auth/check',
      headers: { authorization: `Bearer ${token2}` },
    })
    expect(check2.statusCode).toBe(200)
  })
})

// ═══════════════════════════════════════════════════════════════════════════════
// Protected routes reject without auth
// ═══════════════════════════════════════════════════════════════════════════════

describe('Protected routes require auth', () => {
  const protectedRoutes: Array<{ method: 'GET' | 'POST' | 'PATCH' | 'DELETE'; url: string }> = [
    { method: 'GET',    url: '/api/games' },
    { method: 'POST',   url: '/api/games' },
    { method: 'GET',    url: '/api/games/some-id' },
    { method: 'POST',   url: '/api/games/some-id/start' },
    { method: 'POST',   url: '/api/games/some-id/add-bot' },
    { method: 'POST',   url: '/api/games/some-id/pause' },
    { method: 'POST',   url: '/api/games/some-id/resume' },
    { method: 'PATCH',  url: '/api/games/some-id/spectator-visibility' },
    { method: 'DELETE', url: '/api/games/some-id' },
    { method: 'GET',    url: '/api/replays' },
    { method: 'POST',   url: '/api/replays/upload' },
    { method: 'POST',   url: '/api/replays/create-game' },
    { method: 'GET',    url: '/api/replay-games' },
    { method: 'GET',    url: '/api/replay-games/some-id/players' },
  ]

  test.each(protectedRoutes)(
    '$method $url returns 401 without auth',
    async ({ method, url }) => {
      const res = await app.inject({ method, url })
      expect(res.statusCode).toBe(401)
      expect(res.json().error).toBe('Unauthorized')
    },
  )
})

// ═══════════════════════════════════════════════════════════════════════════════
// Authenticated requests pass through
// ═══════════════════════════════════════════════════════════════════════════════

describe('Authenticated requests succeed', () => {
  test('GET /api/games with valid token returns 200', async () => {
    const token = await login()
    const res = await app.inject({
      method: 'GET',
      url: '/api/games',
      headers: { authorization: `Bearer ${token}` },
    })
    expect(res.statusCode).toBe(200)
  })

  test('POST /api/games with valid token returns 200', async () => {
    const token = await login()
    const res = await app.inject({
      method: 'POST',
      url: '/api/games',
      headers: { authorization: `Bearer ${token}` },
    })
    expect(res.statusCode).toBe(200)
  })

  test('DELETE /api/games/:id with valid token returns 200', async () => {
    const token = await login()
    const res = await app.inject({
      method: 'DELETE',
      url: '/api/games/some-id',
      headers: { authorization: `Bearer ${token}` },
    })
    expect(res.statusCode).toBe(200)
  })
})

// ═══════════════════════════════════════════════════════════════════════════════
// Non-protected routes
// ═══════════════════════════════════════════════════════════════════════════════

describe('Non-protected routes', () => {
  test('GET /health does not require auth', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/health',
    })
    expect(res.statusCode).toBe(200)
    expect(res.json().status).toBe('ok')
  })

  test('POST /api/auth/login does not require auth', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { password: 'admin' },
    })
    expect(res.statusCode).toBe(200)
  })
})
