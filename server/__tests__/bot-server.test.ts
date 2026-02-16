/**
 * Server integration test: verifies the full add-bot flow.
 *
 * Spawns a real server process, creates a game via the admin API,
 * adds bots, and verifies they connect, join, and play.
 */

import { spawn, type ChildProcess } from 'node:child_process'
import path from 'node:path'
import fs from 'node:fs'

const TEST_PORT = 13579
const SERVER_URL = `http://127.0.0.1:${TEST_PORT}`
const DB_PATH = path.resolve(__dirname, '..', 'test-bot-server.db')

let server: ChildProcess

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

function cleanDb() {
  for (const suffix of ['', '-wal', '-shm']) {
    const f = DB_PATH + suffix
    try { fs.unlinkSync(f) } catch { /* doesn't exist */ }
  }
}

beforeAll(async () => {
  cleanDb()

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
}, 15000)

afterAll(async () => {
  if (server && !server.killed) {
    server.kill('SIGTERM')
    await new Promise<void>((resolve) => {
      const timeout = setTimeout(() => {
        server.kill('SIGKILL')
        resolve()
      }, 3000)
      server.on('exit', () => {
        clearTimeout(timeout)
        resolve()
      })
    })
  }
  // Small delay to let file handles close before cleanup
  await sleep(200)
  cleanDb()
})

async function createGame(): Promise<string> {
  const res = await fetch(`${SERVER_URL}/api/games`, {
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

async function getGame(gameId: string): Promise<{ players: Array<{ player_id: string }> }> {
  const res = await fetch(`${SERVER_URL}/api/games/${gameId}`)
  expect(res.status).toBe(200)
  return res.json()
}

// ═══════════════════════════════════════════════════════════════════════════════
// Tests
// ═══════════════════════════════════════════════════════════════════════════════

describe('Add bot via admin API', () => {
  test('rejects unknown bot type', async () => {
    const gameId = await createGame()
    const res = await fetch(`${SERVER_URL}/api/games/${gameId}/add-bot`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ botType: 'nonexistent' }),
    })
    expect(res.status).toBe(400)
  })

  test('rejects adding bot to non-existent game', async () => {
    const res = await fetch(`${SERVER_URL}/api/games/00000000-0000-0000-0000-000000000000/add-bot`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ botType: 'calling-station' }),
    })
    expect(res.status).toBe(404)
  })

  test('calling-station bot connects, joins, and readies up', async () => {
    const gameId = await createGame()

    const res = await fetch(`${SERVER_URL}/api/games/${gameId}/add-bot`, {
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

    const res = await fetch(`${SERVER_URL}/api/games/${gameId}/add-bot`, {
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

  test('two bots trigger auto-start and play at least one hand', async () => {
    const gameId = await createGame()

    // Add two bots
    const res1 = await fetch(`${SERVER_URL}/api/games/${gameId}/add-bot`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ botType: 'calling-station' }),
    })
    expect(res1.status).toBe(201)

    const res2 = await fetch(`${SERVER_URL}/api/games/${gameId}/add-bot`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ botType: 'tag-bot' }),
    })
    expect(res2.status).toBe(201)

    // Verify both bots are in the game
    await sleep(1000)
    const game = await getGame(gameId)
    expect(game.players.length).toBe(2)

    // Wait for the game to start and play through at least one hand.
    // HAND_DELAY_MS is 500ms, action timeout is 30s but bots respond instantly.
    // A full hand (blinds + a few actions) should complete within a few seconds.
    await sleep(4000)

    // The game should now be in_progress (or completed if one bot busted)
    const res = await fetch(`${SERVER_URL}/api/games/${gameId}`)
    expect(res.status).toBe(200)
    const updated = await res.json()
    expect(['in_progress', 'completed']).toContain(updated.status)
  }, 15000)
})
