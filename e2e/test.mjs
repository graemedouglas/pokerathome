#!/usr/bin/env node
/**
 * Poker@Home end-to-end test.
 *
 * Spins up two browser tabs, connects both players, joins a game,
 * readies up, and verifies the game starts and renders on a PixiJS canvas.
 *
 * Prerequisites:
 *   - Server running on http://localhost:3000
 *   - UI dev server running on http://localhost:5173
 *   - At least one game created via the admin API
 *
 * Usage:
 *   pnpm e2e            # creates a game automatically and runs the test
 *   node e2e/test.mjs   # same thing from the repo root
 */

import { chromium } from 'playwright-core'
import { mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const SCREENSHOT_DIR = join(__dirname, 'screenshots')

const SERVER_URL = process.env.SERVER_URL ?? 'http://localhost:3000'
const UI_URL = process.env.UI_URL ?? 'http://localhost:5173'
const HEADLESS = process.env.HEADLESS !== 'false'
const GAME_WAIT_MS = parseInt(process.env.GAME_WAIT_MS ?? '6000', 10)

// ─── Helpers ────────────────────────────────────────────────────────────────────

function log(msg) {
  const ts = new Date().toISOString().slice(11, 23)
  console.log(`[${ts}] ${msg}`)
}

async function checkServer() {
  try {
    const res = await fetch(`${SERVER_URL}/health`)
    if (!res.ok) throw new Error(`Health check returned ${res.status}`)
    const data = await res.json()
    log(`Server healthy (sessions: ${data.sessions})`)
    return true
  } catch {
    return false
  }
}

async function checkUI() {
  try {
    const res = await fetch(UI_URL)
    return res.ok
  } catch {
    return false
  }
}

async function createGame() {
  const res = await fetch(`${SERVER_URL}/api/games`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: 'E2E Test Table',
      smallBlind: 5,
      bigBlind: 10,
      maxPlayers: 6,
      startingStack: 1000,
    }),
  })
  if (!res.ok) throw new Error(`Failed to create game: ${res.status}`)
  const game = await res.json()
  log(`Game created: ${game.id} (${game.name})`)
  return game
}

// ─── Player flow ────────────────────────────────────────────────────────────────

async function runPlayer(browser, name, screenshotPrefix) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } })
  const errors = []

  page.on('pageerror', (err) => {
    errors.push(err.message)
    log(`[${name}] PAGE ERROR: ${err.message}`)
  })

  // Navigate
  log(`[${name}] Navigating to ${UI_URL}...`)
  await page.goto(UI_URL, { waitUntil: 'networkidle' })
  await page.waitForTimeout(1500)

  // Connect screen
  const input = await page.waitForSelector('.lobby-input', { timeout: 5000 })
  await input.fill(name)
  const connectBtn = await page.waitForSelector('.lobby-btn-primary', { timeout: 3000 })
  await connectBtn.click()
  log(`[${name}] Identifying...`)

  // Game list
  await page.waitForSelector('.lobby-game-card', { timeout: 5000 })
  log(`[${name}] Game list loaded`)
  await screenshot(page, `${screenshotPrefix}-01-gamelist`)

  // Join first game
  const joinBtn = await page.$('.lobby-game-card .lobby-btn-primary')
  if (!joinBtn) throw new Error(`${name}: No game to join`)
  await joinBtn.click()
  log(`[${name}] Joined game`)

  // Wait for waiting screen and click Ready
  await page.waitForTimeout(500)
  await screenshot(page, `${screenshotPrefix}-02-waiting`)

  const readyBtn = await page.waitForSelector(
    '.lobby-btn-primary:not([disabled])',
    { timeout: 3000 }
  )
  const readyText = await readyBtn.textContent()
  if (readyText === 'Ready!') {
    await readyBtn.click()
    log(`[${name}] Ready!`)
  }

  return { page, errors }
}

async function screenshot(page, name) {
  const path = join(SCREENSHOT_DIR, `${name}.png`)
  await page.screenshot({ path, fullPage: true })
}

// ─── Main ───────────────────────────────────────────────────────────────────────

async function main() {
  mkdirSync(SCREENSHOT_DIR, { recursive: true })

  log('=== Poker@Home E2E Test ===')
  log('')

  // Pre-flight checks
  const serverOk = await checkServer()
  if (!serverOk) {
    console.error('ERROR: Server not running. Start it with: pnpm dev')
    process.exit(1)
  }

  const uiOk = await checkUI()
  if (!uiOk) {
    console.error('ERROR: UI dev server not running. Start it with: pnpm dev:ui')
    process.exit(1)
  }

  // Create a fresh game
  await createGame()

  // Launch browser
  const browser = await chromium.launch({ headless: HEADLESS })
  let exitCode = 0

  try {
    // Run two players sequentially (avoids race conditions in game list)
    const { page: page1, errors: errors1 } = await runPlayer(browser, 'Alice', 'alice')
    const { page: page2, errors: errors2 } = await runPlayer(browser, 'Bob', 'bob')

    // Wait for game to start
    log('Waiting for game to start...')
    await page1.waitForTimeout(GAME_WAIT_MS)

    // Take game screenshots
    await screenshot(page1, 'alice-03-game')
    await screenshot(page2, 'bob-03-game')
    log('Game screenshots captured')

    // Verify final state
    const verify = async (page, name) => {
      return page.evaluate(() => {
        const overlay = document.querySelector('#lobby-overlay')
        const canvas = document.querySelector('canvas')
        return {
          overlayHidden: overlay ? overlay.style.display === 'none' : true,
          canvasExists: !!canvas,
        }
      })
    }

    const alice = await verify(page1, 'Alice')
    const bob = await verify(page2, 'Bob')

    log('')
    log('─── Results ───')

    const checks = [
      { name: 'Alice: lobby hidden', pass: alice.overlayHidden },
      { name: 'Alice: canvas rendered', pass: alice.canvasExists },
      { name: 'Bob: lobby hidden', pass: bob.overlayHidden },
      { name: 'Bob: canvas rendered', pass: bob.canvasExists },
      { name: 'Alice: no page errors', pass: errors1.length === 0 },
      { name: 'Bob: no page errors', pass: errors2.length === 0 },
    ]

    for (const check of checks) {
      const icon = check.pass ? 'PASS' : 'FAIL'
      log(`  ${icon}  ${check.name}`)
    }

    const allPassed = checks.every((c) => c.pass)
    log('')

    if (errors1.length > 0) log(`Alice errors: ${errors1.join('; ')}`)
    if (errors2.length > 0) log(`Bob errors: ${errors2.join('; ')}`)

    if (allPassed) {
      log('All checks passed!')
    } else {
      log('Some checks failed.')
      exitCode = 1
    }
  } catch (err) {
    log(`FATAL: ${err.message}`)
    exitCode = 1
  } finally {
    await browser.close()
  }

  log(`Screenshots saved to ${SCREENSHOT_DIR}/`)
  log('=== Done ===')
  process.exit(exitCode)
}

main()
