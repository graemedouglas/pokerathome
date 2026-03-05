#!/usr/bin/env node
/**
 * CLI entry point for running a bot standalone.
 *
 * Usage:
 *   tsx src/run.ts --server ws://localhost:3000/ws --game <gameId> --type calling-station --name "Bot Alice"
 */

import { BotClient } from './client.js'
import { strategyRegistry } from './strategies/index.js'

function usage(): never {
  console.error(`Usage: tsx src/run.ts --server <url> --game <gameId> --type <botType> [options]`)
  console.error(`  --name <displayName>     Bot display name`)
  console.error(`  --passphrase <value>     Server or player passphrase`)
  console.error(`  --invite-code <value>    Per-table invite code (makes --game optional)`)
  console.error(`  --auth-token <value>     Saved auth token from previous run`)
  console.error(`  Bot types: ${Object.keys(strategyRegistry).join(', ')}`)
  process.exit(1)
}

interface ParsedArgs {
  server: string
  game: string
  type: string
  name: string
  passphrase?: string
  inviteCode?: string
  authToken?: string
}

function parseArgs(): ParsedArgs {
  const args = process.argv.slice(2)
  const parsed: Record<string, string> = {}

  for (let i = 0; i < args.length; i += 2) {
    const key = args[i]?.replace(/^--/, '')
    const value = args[i + 1]
    if (key && value) parsed[key] = value
  }

  // --game is optional if --invite-code is provided (server auto-routes)
  if (!parsed.server || !parsed.type) usage()
  if (!parsed.game && !parsed['invite-code']) usage()

  return {
    server: parsed.server,
    game: parsed.game ?? '',
    type: parsed.type,
    name: parsed.name ?? `Bot (${parsed.type})`,
    passphrase: parsed.passphrase,
    inviteCode: parsed['invite-code'],
    authToken: parsed['auth-token'],
  }
}

async function main() {
  const opts = parseArgs()

  const createStrategy = strategyRegistry[opts.type]
  if (!createStrategy) {
    console.error(`Unknown bot type: ${opts.type}`)
    console.error(`Available types: ${Object.keys(strategyRegistry).join(', ')}`)
    process.exit(1)
  }

  const bot = new BotClient({
    serverUrl: opts.server,
    gameId: opts.game,
    strategy: createStrategy(),
    displayName: opts.name,
    passphrase: opts.passphrase,
    inviteCode: opts.inviteCode,
    authToken: opts.authToken,
  })

  const target = opts.inviteCode ? `invite-code ${opts.inviteCode}` : `game ${opts.game}`
  console.log(`Starting ${opts.type} bot "${opts.name}" → ${opts.server} ${target}`)

  process.on('SIGINT', () => {
    console.log('Stopping bot...')
    bot.stop()
    process.exit(0)
  })

  await bot.start()
  console.log('Bot is running. Press Ctrl+C to stop.')
}

main().catch((err) => {
  console.error('Fatal error:', err)
  process.exit(1)
})
