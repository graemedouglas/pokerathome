#!/usr/bin/env tsx
/**
 * CLI script to create a game directly in the database.
 *
 * Usage:
 *   pnpm --filter @pokerathome/server create-game --name "Test Table" --blinds 5/10 --stack 1000 --seats 6
 *
 * Or simply:
 *   pnpm --filter @pokerathome/server create-game
 *   (uses defaults: "Quick Game", 5/10 blinds, 1000 stack, 6 seats)
 */

import 'dotenv/config';
import pino from 'pino';
import { initDb, closeDb } from '../src/db/index.js';
import { createGame } from '../src/db/queries.js';

const logger = pino({ level: 'info', transport: { target: 'pino-pretty' } });

function parseArgs(): {
  name: string;
  smallBlind: number;
  bigBlind: number;
  startingStack: number;
  maxPlayers: number;
} {
  const args = process.argv.slice(2);
  let name = 'Quick Game';
  let smallBlind = 5;
  let bigBlind = 10;
  let startingStack = 1000;
  let maxPlayers = 6;

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--name':
        name = args[++i];
        break;
      case '--blinds': {
        const parts = args[++i].split('/');
        smallBlind = parseInt(parts[0], 10);
        bigBlind = parseInt(parts[1], 10);
        break;
      }
      case '--stack':
        startingStack = parseInt(args[++i], 10);
        break;
      case '--seats':
        maxPlayers = parseInt(args[++i], 10);
        break;
    }
  }

  return { name, smallBlind, bigBlind, startingStack, maxPlayers };
}

function main() {
  initDb(logger);

  const params = parseArgs();
  const game = createGame({
    name: params.name,
    smallBlind: params.smallBlind,
    bigBlind: params.bigBlind,
    maxPlayers: params.maxPlayers,
    startingStack: params.startingStack,
  });

  console.log('\nGame created:');
  console.log(`  ID:       ${game.id}`);
  console.log(`  Name:     ${game.name}`);
  console.log(`  Blinds:   ${game.small_blind}/${game.big_blind}`);
  console.log(`  Stack:    ${game.starting_stack}`);
  console.log(`  Seats:    ${game.max_players}`);
  console.log(`  Status:   ${game.status}`);
  console.log();

  closeDb(logger);
}

main();
