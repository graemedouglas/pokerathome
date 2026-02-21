#!/usr/bin/env node
/**
 * Chat WebSocket end-to-end test.
 *
 * Validates that chat messages are correctly delivered to all participants
 * (players and spectators) with correct role tags.
 *
 * Invariants checked:
 *   - Player sends chat -> all participants receive it with role 'player'
 *   - Spectator sends chat -> all participants receive it with role 'spectator'
 *   - Messages include correct displayName, message text, and timestamp
 *   - Player's own message is echoed back
 *   - Spectator's own message is echoed back
 *
 * Prerequisites:
 *   Server running on http://localhost:3000
 *
 * Usage:
 *   node e2e/test-chat.mjs
 *   pnpm --filter e2e test:chat
 */

const SERVER_URL = process.env.SERVER_URL ?? 'http://localhost:3000'
const WS_URL    = SERVER_URL.replace('http', 'ws') + '/ws'
const TIMEOUT_MS = parseInt(process.env.TIMEOUT_MS ?? '15000', 10)

// ─── Helpers ─────────────────────────────────────────────────────────────────

function log(msg) {
  const ts = new Date().toISOString().slice(11, 23)
  console.log(`[${ts}] [chat-e2e] ${msg}`)
}

function fail(msg) {
  console.error(`\n❌ FAIL: ${msg}\n`)
  process.exit(1)
}

async function api(path, method = 'GET', body = undefined) {
  const res = await fetch(`${SERVER_URL}${path}`, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
  })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`${method} ${path} → ${res.status}: ${text}`)
  }
  return res.json()
}

/** Connect a WebSocket and return a simple send/receive helper. */
function connectWs(url) {
  const ws = new WebSocket(url)
  const handlers = []

  ws.addEventListener('message', (ev) => {
    const msg = JSON.parse(ev.data)
    for (const h of [...handlers]) h(msg)
  })

  const send = (action, payload) => {
    ws.send(JSON.stringify({ action, payload }))
  }

  const waitFor = (predicate, timeoutMs = TIMEOUT_MS) =>
    new Promise((resolve, reject) => {
      const t = setTimeout(() => {
        handlers.splice(handlers.indexOf(h), 1)
        reject(new Error(`Timeout waiting for WS message (${timeoutMs}ms)`))
      }, timeoutMs)

      function h(msg) {
        if (predicate(msg)) {
          clearTimeout(t)
          handlers.splice(handlers.indexOf(h), 1)
          resolve(msg)
        }
      }

      handlers.push(h)
    })

  const open = new Promise((resolve, reject) => {
    ws.addEventListener('open', resolve)
    ws.addEventListener('error', reject)
  })

  return { ws, send, waitFor, open }
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  // Health check
  log('Checking server health...')
  const health = await api('/health').catch(() => null)
  if (!health) fail('Server not reachable at ' + SERVER_URL)
  log(`Server healthy (sessions: ${health.sessions})`)

  // Create a fresh game
  log('Creating game...')
  const game = await api('/api/games', 'POST', {
    name: 'Chat E2E',
    smallBlind: 5,
    bigBlind: 10,
    maxPlayers: 6,
    startingStack: 500,
  })
  const gameId = game.id
  log(`Game created: ${gameId}`)

  // --- Connect Player 1 ---
  log('Connecting Player1 WS...')
  const p1 = connectWs(WS_URL)
  await p1.open
  p1.send('identify', { displayName: 'Player1' })
  const p1Id = (await p1.waitFor(m => m.action === 'identified')).payload.playerId
  log(`Player1 identified: ${p1Id}`)

  p1.send('joinGame', { gameId, role: 'player' })
  await p1.waitFor(m => m.action === 'gameJoined')
  log('Player1 joined as player')

  // --- Connect Spectator ---
  log('Connecting Spectator WS...')
  const spec = connectWs(WS_URL)
  await spec.open
  spec.send('identify', { displayName: 'SpecChat' })
  const specId = (await spec.waitFor(m => m.action === 'identified')).payload.playerId
  log(`Spectator identified: ${specId}`)

  spec.send('joinGame', { gameId, role: 'spectator' })
  await spec.waitFor(m => m.action === 'gameJoined')
  log('Spectator joined')

  // Small delay to ensure connections are fully established
  await new Promise(r => setTimeout(r, 200))

  // --- Test 1: Player sends chat ---
  log('Test 1: Player sends chat message...')
  const p1ChatPromise = p1.waitFor(m => m.action === 'chatMessage' && m.payload.message === 'hello from player')
  const specChatPromise1 = spec.waitFor(m => m.action === 'chatMessage' && m.payload.message === 'hello from player')

  p1.send('chat', { message: 'hello from player' })

  const p1Received = await p1ChatPromise
  const specReceived1 = await specChatPromise1
  log('Both received player chat message')

  // --- Test 2: Spectator sends chat ---
  log('Test 2: Spectator sends chat message...')
  const p1ChatPromise2 = p1.waitFor(m => m.action === 'chatMessage' && m.payload.message === 'hello from spectator')
  const specChatPromise2 = spec.waitFor(m => m.action === 'chatMessage' && m.payload.message === 'hello from spectator')

  spec.send('chat', { message: 'hello from spectator' })

  const p1Received2 = await p1ChatPromise2
  const specReceived2 = await specChatPromise2
  log('Both received spectator chat message')

  // --- Cleanup ---
  p1.ws.close()
  spec.ws.close()

  // --- Validate ---
  let errors = 0

  function check(condition, description) {
    if (!condition) {
      console.error(`  ❌ ${description}`)
      errors++
    } else {
      console.log(`  ✅ ${description}`)
    }
  }

  log('\nValidating invariants...')

  // Test 1 checks: Player's chat received by both
  check(p1Received.payload.displayName === 'Player1',
    'Player receives own message with correct displayName')
  check(p1Received.payload.role === 'player',
    'Player chat has role "player"')
  check(p1Received.payload.playerId === p1Id,
    'Player chat has correct playerId')
  check(typeof p1Received.payload.timestamp === 'string' && p1Received.payload.timestamp.length > 0,
    'Player chat has timestamp')

  check(specReceived1.payload.displayName === 'Player1',
    'Spectator receives player message with correct displayName')
  check(specReceived1.payload.role === 'player',
    'Spectator sees role "player" on player message')
  check(specReceived1.payload.message === 'hello from player',
    'Spectator receives correct message text from player')

  // Test 2 checks: Spectator's chat received by both
  check(p1Received2.payload.displayName === 'SpecChat',
    'Player receives spectator message with correct displayName')
  check(p1Received2.payload.role === 'spectator',
    'Spectator chat has role "spectator" (received by player)')
  check(p1Received2.payload.playerId === specId,
    'Spectator chat has correct playerId (received by player)')

  check(specReceived2.payload.displayName === 'SpecChat',
    'Spectator receives own message with correct displayName')
  check(specReceived2.payload.role === 'spectator',
    'Spectator receives own message with role "spectator"')
  check(specReceived2.payload.message === 'hello from spectator',
    'Spectator receives correct own message text')

  // Summary
  console.log('')
  if (errors > 0) {
    fail(`${errors} check(s) failed — see above`)
  } else {
    log(`All checks passed!`)
    process.exit(0)
  }
}

main().catch(err => {
  console.error('Unexpected error:', err)
  process.exit(1)
})
