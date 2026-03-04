/**
 * Server integration test: verifies the full add-bot flow.
 *
 * Spawns a real server process, creates a game via the admin API,
 * adds bots, and verifies they connect, join, and play.
 */

import { spawn, execSync, type ChildProcess } from 'node:child_process'
import path from 'node:path'
import fs from 'node:fs'

const TEST_PORT = 13579
const SERVER_URL = `http://127.0.0.1:${TEST_PORT}`
const DB_PATH = path.resolve(__dirname, '..', 'test-bot-server.db')
const ADMIN_PASSWORD = 'test-pass'

let server: ChildProcess
let authToken: string

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function waitForServer(maxAttempts = 30): Promise<void> {
  for (let i = 0; i < maxAttempts; i++) {
    try {
      const res = await fetch(`${SERVER_URL}/health`)
      if (res.ok) return
    } catch { /* not ready yet */ }
    await sleep(200)
  }
  throw new Error('Server failed to start')
}

async function login(): Promise<string> {
  const res = await fetch(`${SERVER_URL}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password: ADMIN_PASSWORD }),
  })
  if (!res.ok) throw new Error('Login failed')
  const { token } = await res.json()
  return token
}

/** Authenticated fetch helper */
function authFetch(url: string, options: RequestInit = {}): Promise<Response> {
  const headers = new Headers(options.headers)
  headers.set('Authorization', `Bearer ${authToken}`)
  return fetch(url, { ...options, headers })
}

function cleanDb() {
  for (const suffix of ['', '-wal', '-shm']) {
    const f = DB_PATH + suffix
    try { fs.unlinkSync(f) } catch { /* doesn't exist */ }
  }
}

beforeAll(async () => {
  cleanDb()

  // Kill any leftover server from a previous crashed test run (Windows-specific)
  if (process.platform === 'win32') {
    try {
      execSync(
        `for /f "tokens=5" %a in ('netstat -ano ^| findstr :${TEST_PORT} ^| findstr LISTENING') do taskkill /F /PID %a`,
        { stdio: 'ignore', shell: true }
      )
    } catch { /* nothing listening — expected */ }
  }

  server = spawn('npx', ['tsx', 'src/index.ts'], {
    cwd: path.resolve(__dirname, '..'),
    env: {
      ...process.env,
      PORT: String(TEST_PORT),
      HOST: '127.0.0.1',
      DB_PATH,
      LOG_LEVEL: 'warn',
      ACTION_TIMEOUT_MS: '30000',
      HAND_DELAY_MS: '500',
      MIN_PLAYERS_TO_START: '2',
      SPECTATOR_CARD_VISIBILITY: 'delayed',
      ADMIN_PASSWORD,
    },
    stdio: 'pipe',
    shell: true, // Required on Windows where npx is npx.cmd
  })

  // Forward server errors for debugging
  server.stderr?.on('data', (data) => {
    const msg = data.toString()
    if (msg.includes('FATAL') || msg.includes('Error')) {
      console.error('[test-server]', msg.trim())
    }
  })

  await waitForServer()
  authToken = await login()
}, 15000)

afterAll(async () => {
  if (server && !server.killed) {
    if (process.platform === 'win32') {
      // On Windows, shell:true creates a process tree; SIGTERM only kills the shell wrapper
      spawn('taskkill', ['/F', '/T', '/PID', String(server.pid)], { stdio: 'ignore' })
    } else {
      server.kill('SIGTERM')
    }
    await new Promise<void>((resolve) => {
      const timeout = setTimeout(() => {
        if (process.platform !== 'win32') server.kill('SIGKILL')
        resolve()
      }, 3000)
      server.on('exit', () => {
        clearTimeout(timeout)
        resolve()
      })
    })
  }
  // Small delay to let file handles close before cleanup
  await sleep(500)
  cleanDb()
})

async function createGame(): Promise<string> {
  const res = await authFetch(`${SERVER_URL}/api/games`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: 'Bot Server Test',
      smallBlind: 5,
      bigBlind: 10,
      maxPlayers: 6,
      startingStack: 1000,
    }),
  })
  expect(res.status).toBe(201)
  const game = await res.json()
  return game.id
}

async function getGame(gameId: string): Promise<{ players: Array<{ player_id: string }>; status: string }> {
  const res = await authFetch(`${SERVER_URL}/api/games/${gameId}`)
  expect(res.status).toBe(200)
  return res.json()
}

async function startGame(gameId: string): Promise<void> {
  const res = await authFetch(`${SERVER_URL}/api/games/${gameId}/start`, {
    method: 'POST',
  })
  expect(res.status).toBe(200)
}

// ═══════════════════════════════════════════════════════════════════════════════
// Tests
// ═══════════════════════════════════════════════════════════════════════════════

describe('Add bot via admin API', () => {
  test('rejects unknown bot type', async () => {
    const gameId = await createGame()
    const res = await authFetch(`${SERVER_URL}/api/games/${gameId}/add-bot`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ botType: 'nonexistent' }),
    })
    expect(res.status).toBe(400)
  })

  test('rejects adding bot to non-existent game', async () => {
    const res = await authFetch(`${SERVER_URL}/api/games/00000000-0000-0000-0000-000000000000/add-bot`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ botType: 'calling-station' }),
    })
    expect(res.status).toBe(404)
  })

  test('calling-station bot connects, joins, and readies up', async () => {
    const gameId = await createGame()

    const res = await authFetch(`${SERVER_URL}/api/games/${gameId}/add-bot`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ botType: 'calling-station' }),
    })
    expect(res.status).toBe(201)
    const body = await res.json()
    expect(body.ok).toBe(true)
    expect(body.displayName).toBe('Bot (calling-station)')

    // Give the bot time to connect, identify, join, and ready
    await sleep(1000)

    // Verify the bot is registered as a game player in the DB
    const game = await getGame(gameId)
    expect(game.players.length).toBe(1)
  })

  test('tag-bot with custom name connects and joins', async () => {
    const gameId = await createGame()

    const res = await authFetch(`${SERVER_URL}/api/games/${gameId}/add-bot`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ botType: 'tag-bot', displayName: 'Aggressive Alice' }),
    })
    expect(res.status).toBe(201)
    const body = await res.json()
    expect(body.ok).toBe(true)
    expect(body.displayName).toBe('Aggressive Alice')

    await sleep(1000)

    const game = await getGame(gameId)
    expect(game.players.length).toBe(1)
  })

  test('game does not auto-start when two bots ready up', async () => {
    const gameId = await createGame()

    // Add two bots — they auto-ready on join
    const res1 = await authFetch(`${SERVER_URL}/api/games/${gameId}/add-bot`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ botType: 'calling-station' }),
    })
    expect(res1.status).toBe(201)

    const res2 = await authFetch(`${SERVER_URL}/api/games/${gameId}/add-bot`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ botType: 'tag-bot' }),
    })
    expect(res2.status).toBe(201)

    // Wait for bots to connect, join, and ready up
    await sleep(2000)

    // Game should still be in waiting status — no auto-start
    const game = await getGame(gameId)
    expect(game.players.length).toBe(2)
    expect(game.status).toBe('waiting')
  })

  test('two bots play after admin starts game', async () => {
    const gameId = await createGame()

    // Add two bots
    const res1 = await authFetch(`${SERVER_URL}/api/games/${gameId}/add-bot`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ botType: 'calling-station' }),
    })
    expect(res1.status).toBe(201)

    const res2 = await authFetch(`${SERVER_URL}/api/games/${gameId}/add-bot`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ botType: 'tag-bot' }),
    })
    expect(res2.status).toBe(201)

    // Wait for bots to join, then start via admin API
    await sleep(1000)
    const game = await getGame(gameId)
    expect(game.players.length).toBe(2)

    await startGame(gameId)

    // Wait for at least one hand to complete
    await sleep(4000)

    const res = await authFetch(`${SERVER_URL}/api/games/${gameId}`)
    expect(res.status).toBe(200)
    const updated = await res.json()
    expect(['in_progress', 'completed']).toContain(updated.status)
  }, 15000)
})

describe('Tournament bot game', () => {
  test('two bots play a tournament game after admin start', async () => {
    // Create a tournament game
    const res = await authFetch(`${SERVER_URL}/api/games`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Tournament Bot Test',
        gameType: 'tournament',
        smallBlind: 25,
        bigBlind: 50,
        maxPlayers: 6,
        startingStack: 5000,
        tournamentLengthHours: 0.25,
        roundLengthMinutes: 1,
      }),
    })
    expect(res.status).toBe(201)
    const game = await res.json()
    const gameId = game.id

    // Add two bots
    const res1 = await authFetch(`${SERVER_URL}/api/games/${gameId}/add-bot`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ botType: 'tag-bot', displayName: 'TAG Tourney' }),
    })
    expect(res1.status).toBe(201)

    const res2 = await authFetch(`${SERVER_URL}/api/games/${gameId}/add-bot`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ botType: 'calling-station', displayName: 'CS Tourney' }),
    })
    expect(res2.status).toBe(201)

    // Verify both bots joined, then start via admin API
    await sleep(1000)
    const gameData = await getGame(gameId)
    expect(gameData.players.length).toBe(2)

    await startGame(gameId)

    // Wait for at least one hand to complete
    await sleep(4000)

    const statusRes = await authFetch(`${SERVER_URL}/api/games/${gameId}`)
    expect(statusRes.status).toBe(200)
    const updated = await statusRes.json()
    expect(['in_progress', 'completed']).toContain(updated.status)
  }, 15000)
})
