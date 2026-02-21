#!/usr/bin/env node
/**
 * Spectator WebSocket end-to-end test.
 *
 * Validates that the server sends consistent event+state pairs to spectators
 * across a full hand (showdown mode). Invariants checked:
 *   - Community cards never decrease across consecutive messages
 *   - FLOP event state has exactly 3 community cards
 *   - TURN event state has exactly 4 community cards
 *   - RIVER event state has exactly 5 community cards
 *   - Hole cards are null for opponent players during active play
 *   - Hole cards are non-null for opponent players at SHOWDOWN
 *
 * Prerequisites:
 *   Server running on http://localhost:3000 (bots package must be available)
 *
 * Usage:
 *   node e2e/test-spectator.mjs
 *   pnpm --filter e2e test:spectator
 */

const SERVER_URL = process.env.SERVER_URL ?? 'http://localhost:3000'
const WS_URL    = SERVER_URL.replace('http', 'ws') + '/ws'
const TIMEOUT_MS = parseInt(process.env.TIMEOUT_MS ?? '30000', 10)

// ─── Helpers ─────────────────────────────────────────────────────────────────

function log(msg) {
  const ts = new Date().toISOString().slice(11, 23)
  console.log(`[${ts}] [spectator-e2e] ${msg}`)
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

  // Create a fresh game (showdown mode, default)
  log('Creating game...')
  const game = await api('/api/games', 'POST', {
    name: 'Spectator E2E',
    smallBlind: 5,
    bigBlind: 10,
    maxPlayers: 6,
    startingStack: 500,
    spectatorVisibility: 'showdown',
  })
  const gameId = game.id
  log(`Game created: ${gameId}`)

  // Connect spectator via WebSocket
  log('Connecting spectator WS...')
  const { ws, send, waitFor, open } = connectWs(WS_URL)
  await open
  log('WS connected')

  // Identify
  send('identify', { displayName: 'SpecE2E' })
  const idMsg = await waitFor(m => m.action === 'identified')
  const spectatorPlayerId = idMsg.payload.playerId
  log(`Identified as ${spectatorPlayerId}`)

  // List games (ensures spectator receives the game in the list)
  send('listGames', {})
  await waitFor(m => m.action === 'gameList')

  // Join as spectator
  log(`Joining game ${gameId} as spectator...`)
  send('joinGame', { gameId, role: 'spectator' })
  await waitFor(m => m.action === 'gameJoined')
  log('Joined as spectator')

  // Collect all gameState messages until HAND_END
  const collectedMessages = []
  const handEndPromise = waitFor(m => {
    if (m.action === 'gameState') {
      collectedMessages.push(m.payload)
      return m.payload.event?.type === 'HAND_END'
    }
    return false
  }, TIMEOUT_MS)

  // Add 2 bots (they auto-ready, which triggers auto-start)
  log('Adding bots...')
  await api(`/api/games/${gameId}/add-bot`, 'POST', { botType: 'calling-station', displayName: 'Bot1' })
  await api(`/api/games/${gameId}/add-bot`, 'POST', { botType: 'calling-station', displayName: 'Bot2' })
  log('Bots added — waiting for hand to complete...')

  // Wait for the hand to finish
  await handEndPromise
  log(`Collected ${collectedMessages.length} gameState messages`)

  ws.close()

  // ─── Validate invariants ────────────────────────────────────────────────────

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

  // Invariant 1: Community cards never decrease across consecutive messages
  {
    let prev = -1
    let decreased = false
    let decreaseDetail = ''
    for (const msg of collectedMessages) {
      const count = msg.gameState?.communityCards?.length ?? 0
      const evType = msg.event?.type
      if (evType === 'HAND_START') { prev = 0; continue }
      if (prev >= 0 && count < prev) {
        decreased = true
        decreaseDetail = `${evType}: ${prev} → ${count}`
        break
      }
      prev = count
    }
    check(!decreased, `Community cards never decrease (${decreased ? 'VIOLATED: ' + decreaseDetail : 'ok'})`)
  }

  // Invariant 2: FLOP event has exactly 3 community cards in state
  {
    const flopMsg = collectedMessages.find(m => m.event?.type === 'FLOP')
    if (!flopMsg) {
      check(false, 'FLOP event was received')
    } else {
      const count = flopMsg.gameState?.communityCards?.length
      check(count === 3, `FLOP event state has 3 community cards (got ${count})`)
    }
  }

  // Invariant 3: TURN event has exactly 4 community cards in state
  {
    const turnMsg = collectedMessages.find(m => m.event?.type === 'TURN')
    if (!turnMsg) {
      log('  ℹ️  TURN not reached (pre-flop fold or all-in before turn) — skipping')
    } else {
      const count = turnMsg.gameState?.communityCards?.length
      check(count === 4, `TURN event state has 4 community cards (got ${count})`)
    }
  }

  // Invariant 4: RIVER event has exactly 5 community cards in state
  {
    const riverMsg = collectedMessages.find(m => m.event?.type === 'RIVER')
    if (!riverMsg) {
      log('  ℹ️  RIVER not reached — skipping')
    } else {
      const count = riverMsg.gameState?.communityCards?.length
      check(count === 5, `RIVER event state has 5 community cards (got ${count})`)
    }
  }

  // Invariant 5: Hole cards are null for opponent players during active play
  // (in showdown mode, hole cards hidden until SHOWDOWN stage)
  {
    const duringPlay = collectedMessages.filter(m => {
      const stage = m.gameState?.stage
      return stage && stage !== 'SHOWDOWN' && m.event?.type !== 'HAND_END'
    })
    let leakedHoleCards = false
    let leakDetail = ''
    for (const msg of duringPlay) {
      const players = msg.gameState?.players ?? []
      for (const p of players) {
        if (p.id !== spectatorPlayerId && p.role !== 'spectator' && p.holeCards !== null) {
          leakedHoleCards = true
          leakDetail = `${msg.event?.type} @ ${msg.gameState?.stage}: player ${p.displayName} has holeCards`
          break
        }
      }
      if (leakedHoleCards) break
    }
    check(!leakedHoleCards, `Opponent hole cards null during play (${leakedHoleCards ? 'VIOLATED: ' + leakDetail : 'ok'})`)
  }

  // Invariant 6: Hole cards visible at SHOWDOWN (if a showdown happened)
  {
    const showdownMsg = collectedMessages.find(m => m.event?.type === 'SHOWDOWN')
    if (!showdownMsg) {
      log('  ℹ️  SHOWDOWN not reached (folded pre-flop) — skipping')
    } else {
      const players = showdownMsg.gameState?.players ?? []
      const activePlayers = players.filter(p => p.role !== 'spectator' && !p.folded)
      const anyVisible = activePlayers.some(p => p.holeCards !== null)
      check(anyVisible, `Hole cards visible for at least one player at SHOWDOWN`)
    }
  }

  // Summary
  console.log('')
  if (errors > 0) {
    fail(`${errors} invariant(s) violated — see above`)
  } else {
    log(`All invariants passed (${collectedMessages.length} messages validated)`)
    process.exit(0)
  }
}

main().catch(err => {
  console.error('Unexpected error:', err)
  process.exit(1)
})
