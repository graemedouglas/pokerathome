#!/usr/bin/env node
/**
 * Analyze a poker replay file and print a structured summary.
 *
 * Usage:
 *   node server/scripts/analyze-replay.cjs [path/to/replay.json]
 *
 * If no path is given, uses the most recently modified .replay.json in server/replays/.
 */

const fs = require('fs');
const path = require('path');

// ─── Find replay file ──────────────────────────────────────────────────────────

function findReplayFile(arg) {
  if (arg) {
    // Try as-is, then under server/replays/
    if (fs.existsSync(arg)) return arg;
    const inReplays = path.join(__dirname, '..', 'replays', arg);
    if (fs.existsSync(inReplays)) return inReplays;
    console.error(`Replay file not found: ${arg}`);
    process.exit(1);
  }

  const dir = path.join(__dirname, '..', 'replays');
  if (!fs.existsSync(dir)) {
    console.error('No replays directory found');
    process.exit(1);
  }
  const files = fs.readdirSync(dir)
    .filter(f => f.endsWith('.replay.json'))
    .map(f => ({ name: f, mtime: fs.statSync(path.join(dir, f)).mtimeMs }))
    .sort((a, b) => b.mtime - a.mtime);

  if (files.length === 0) {
    console.error('No replay files found in server/replays/');
    process.exit(1);
  }
  return path.join(dir, files[0].name);
}

// ─── Helpers ────────────────────────────────────────────────────────────────────

function short(id) { return id ? id.slice(0, 8) : '??'; }

function playerName(players, id) {
  const p = players.find(p2 => p2.id === id);
  return p ? p.displayName : short(id);
}

function isHuman(player) {
  return !player.displayName.startsWith('Bot');
}

function padRight(s, n) { return (s + ' '.repeat(n)).slice(0, n); }

function playerStateLine(p, humanId) {
  const mark = p.id === humanId ? ' <<<' : '';
  const cards = p.holeCards ? p.holeCards.join(' ') : 'none';
  return `  ${padRight(short(p.id), 9)} ${padRight(p.displayName, 24)} sit=${padRight(String(p.sittingOut), 6)} fold=${padRight(String(p.folded), 6)} stack=${padRight(String(p.stack), 7)} cards=${cards}${mark}`;
}

// ─── Main ───────────────────────────────────────────────────────────────────────

const filePath = findReplayFile(process.argv[2]);
const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
const cfg = data.gameConfig;
const allPlayers = data.players;
const humanPlayer = allPlayers.find(isHuman);
const humanId = humanPlayer ? humanPlayer.id : null;

// ─── Game Setup ─────────────────────────────────────────────────────────────────

console.log('=== GAME SETUP ===');
console.log(`File: ${path.basename(filePath)}`);
console.log(`Type: ${cfg.gameType} | Stakes: ${cfg.smallBlindAmount}/${cfg.bigBlindAmount} | Starting stack: ${cfg.startingStack} | Max players: ${cfg.maxPlayers}`);
console.log('');
console.log('Players:');
allPlayers.forEach(p => {
  const mark = isHuman(p) ? ' <<< HUMAN' : '';
  console.log(`  Seat ${p.seatIndex}: ${p.displayName} (${short(p.id)})${mark}`);
});
console.log('');

// ─── Hand-by-hand analysis ─────────────────────────────────────────────────────

console.log('=== HAND-BY-HAND ===');

const sitOutEvents = []; // track for summary

data.entries.forEach((e, i) => {
  const evt = e.event;
  const st = e.engineState;
  if (!st || !st.players) return;

  const players = st.players.filter(p => p.role === 'player');

  switch (evt.type) {
    case 'HAND_START':
      console.log('');
      console.log(`${'='.repeat(70)}`);
      console.log(`HAND ${st.handNumber} START (entry ${i})`);
      console.log(`${'='.repeat(70)}`);
      players.forEach(p => console.log(playerStateLine(p, humanId)));
      break;

    case 'BLINDS_POSTED':
      console.log(`  Blinds: ${playerName(players, evt.smallBlind.playerId)} SB $${evt.smallBlind.amount}, ${playerName(players, evt.bigBlind.playerId)} BB $${evt.bigBlind.amount}`);
      break;

    case 'DEAL':
      console.log(`  --- DEAL (preflop) ---`);
      players.forEach(p => console.log(playerStateLine(p, humanId)));
      break;

    case 'FLOP':
      console.log(`  --- FLOP: ${evt.cards.join(' ')} ---`);
      break;

    case 'TURN':
      console.log(`  --- TURN: ${evt.card} ---`);
      break;

    case 'RIVER':
      console.log(`  --- RIVER: ${evt.card} ---`);
      break;

    case 'PLAYER_ACTION': {
      const act = evt.action;
      const amount = act.amount ? ` $${act.amount}` : '';
      const name = playerName(players, evt.playerId);
      const mark = evt.playerId === humanId ? ' <<<' : '';
      console.log(`  ${name}: ${act.type}${amount}${mark}`);
      break;
    }

    case 'PLAYER_SITTING_OUT': {
      const name = playerName(players, evt.playerId);
      const label = evt.sittingOut ? 'SITTING OUT' : "I'M BACK";
      const mark = evt.playerId === humanId ? ' <<<' : '';
      console.log(`  *** ${name}: ${label} (entry ${i})${mark} ***`);
      sitOutEvents.push({
        entry: i,
        hand: st.handNumber,
        playerId: evt.playerId,
        playerName: name,
        sittingOut: evt.sittingOut,
        handInProgress: st.handInProgress,
        stage: st.stage,
      });
      break;
    }

    case 'PLAYER_TIMEOUT': {
      const name = playerName(players, evt.playerId);
      const mark = evt.playerId === humanId ? ' <<<' : '';
      console.log(`  *** ${name}: TIMED OUT (entry ${i})${mark} ***`);
      break;
    }

    case 'SHOWDOWN':
      console.log('  --- SHOWDOWN ---');
      evt.results.forEach(r => {
        const name = playerName(players, r.playerId);
        const cards = r.holeCards ? `[${r.holeCards.join(' ')}]` : '';
        const mark = r.playerId === humanId ? ' <<<' : '';
        console.log(`  ${name}: ${r.handDescription} ${cards}${mark}`);
      });
      break;

    case 'HAND_END':
      console.log('  --- HAND END ---');
      evt.winners.forEach(w => {
        const name = playerName(players, w.playerId);
        console.log(`  Winner: ${name} +$${w.amount}`);
      });
      console.log('  Final stacks:');
      players.forEach(p => {
        const mark = p.id === humanId ? ' <<<' : '';
        console.log(`    ${padRight(p.displayName, 24)} $${p.stack}${mark}`);
      });
      break;

    case 'BLIND_LEVEL_UP':
      console.log(`  *** BLINDS UP: ${evt.level.smallBlind}/${evt.level.bigBlind}${evt.level.ante > 0 ? ` ante ${evt.level.ante}` : ''} ***`);
      break;
  }
});

// ─── Sit-out summary ────────────────────────────────────────────────────────────

if (sitOutEvents.length > 0) {
  console.log('');
  console.log('=== SIT-OUT ANALYSIS ===');
  console.log('');

  // Group by player
  const byPlayer = {};
  sitOutEvents.forEach(e => {
    if (!byPlayer[e.playerId]) byPlayer[e.playerId] = [];
    byPlayer[e.playerId].push(e);
  });

  for (const [pid, events] of Object.entries(byPlayer)) {
    const name = events[0].playerName;
    const mark = pid === humanId ? ' <<< HUMAN' : '';
    console.log(`${name}${mark}:`);

    events.forEach(e => {
      const when = e.handInProgress ? `mid-hand ${e.hand} (${e.stage})` : `between hands (after hand ${e.hand})`;
      const label = e.sittingOut ? 'SAT OUT' : 'RETURNED';
      console.log(`  Entry ${padRight(String(e.entry), 4)} ${padRight(label, 10)} ${when}`);
    });

    // Check for missing returns
    let sitting = false;
    let satOutEntry = null;
    const handStarts = data.entries.filter(e2 => e2.event.type === 'HAND_START');

    events.forEach(e => {
      if (e.sittingOut) {
        sitting = true;
        satOutEntry = e;
      } else {
        if (sitting && satOutEntry) {
          // Check if a HAND_START happened between sat-out and return
          const missedHands = handStarts.filter(hs =>
            hs.index > satOutEntry.entry && hs.index < e.entry
          );
          if (missedHands.length > 0) {
            console.log(`  !! Missed ${missedHands.length} hand(s) while sitting out (entries ${satOutEntry.entry}-${e.entry})`);
          }
        }
        sitting = false;
        satOutEntry = null;
      }
    });

    if (sitting) {
      console.log(`  !! Still sitting out at end of replay`);
    }
    console.log('');
  }
}

// ─── Final summary ──────────────────────────────────────────────────────────────

const totalHands = data.entries.filter(e => e.event.type === 'HAND_START').length;
console.log('=== SUMMARY ===');
console.log(`${totalHands} hands played, ${data.entries.length} total events, ${allPlayers.length} players`);
if (humanPlayer) {
  const lastEntry = data.entries[data.entries.length - 1];
  const finalState = lastEntry.engineState;
  if (finalState) {
    const hp = finalState.players.find(p => p.id === humanId);
    if (hp) {
      const diff = hp.stack - cfg.startingStack;
      const sign = diff >= 0 ? '+' : '';
      console.log(`${humanPlayer.displayName}: $${cfg.startingStack} -> $${hp.stack} (${sign}$${diff})`);
    }
  }
}
