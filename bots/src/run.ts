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
  console.error(`Usage: tsx src/run.ts --server <url> --game <gameId> --type <botType> [--name <displayName>]`)
  console.error(`  Bot types: ${Object.keys(strategyRegistry).join(', ')}`)
  process.exit(1)
}

function parseArgs(): { server: string; game: string; type: string; name: string } {
  const args = process.argv.slice(2)
  const parsed: Record<string, string> = {}

  for (let i = 0; i < args.length; i += 2) {
    const key = args[i]?.replace(/^--/, '')
    const value = args[i + 1]
    if (key && value) parsed[key] = value
  }

  if (!parsed.server || !parsed.game || !parsed.type) usage()
  return {
    server: parsed.server,
    game: parsed.game,
    type: parsed.type,
    name: parsed.name ?? `Bot (${parsed.type})`,
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
  })

  console.log(`Starting ${opts.type} bot "${opts.name}" → ${opts.server} game ${opts.game}`)

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
