/**
 * Pot calculation including side pots.
 *
 * The algorithm:
 * 1. Collect all unique non-zero potShare levels from players
 * 2. For each tier, compute the pot amount and eligible (non-folded) players
 * 3. Merge adjacent pots with identical eligible player sets
 */

import type { PotBreakdown, Winner } from '@pokerathome/schema';
import type { EvaluatedHand } from './hand-evaluator.js';
import { findWinners } from './hand-evaluator.js';

export interface PotPlayer {
  id: string;
  potShare: number;
  folded: boolean;
}

/** Calculate pot breakdown from player contributions. */
export function calculatePots(players: PotPlayer[]): { pot: number; pots: PotBreakdown[] } {
  const pot = players.reduce((sum, p) => sum + p.potShare, 0);

  const contributions = players
    .filter((p) => p.potShare > 0)
    .map((p) => p.potShare);

  const uniqueLevels = [...new Set(contributions)].sort((a, b) => a - b);

  if (uniqueLevels.length === 0) {
    return { pot: 0, pots: [] };
  }

  const rawPots: PotBreakdown[] = [];
  let previousLevel = 0;

  for (const level of uniqueLevels) {
    const increment = level - previousLevel;
    const contributors = players.filter((p) => p.potShare >= level);
    const amount = increment * contributors.length;
    const eligiblePlayerIds = contributors.filter((p) => !p.folded).map((p) => p.id);

    if (amount > 0) {
      rawPots.push({ amount, eligiblePlayerIds });
    }

    previousLevel = level;
  }

  // Merge adjacent pots with same eligible players
  const mergedPots: PotBreakdown[] = [];
  for (const rp of rawPots) {
    const last = mergedPots[mergedPots.length - 1];
    if (last && arraysEqual(last.eligiblePlayerIds, rp.eligiblePlayerIds)) {
      last.amount += rp.amount;
    } else {
      mergedPots.push({ ...rp, eligiblePlayerIds: [...rp.eligiblePlayerIds] });
    }
  }

  return { pot, pots: mergedPots.length > 0 ? mergedPots : [{ amount: pot, eligiblePlayerIds: [] }] };
}

/** Distribute pots to winners based on hand evaluation. */
export function distributePots(
  pots: PotBreakdown[],
  evaluatedHands: EvaluatedHand[]
): Winner[] {
  const winners: Winner[] = [];

  for (let i = 0; i < pots.length; i++) {
    const pot = pots[i];
    const potWinners = findWinners(evaluatedHands, pot.eligiblePlayerIds);

    if (potWinners.length === 0) {
      // Edge case: all eligible players somehow have no evaluated hand
      // This shouldn't happen, but if it does, carry the pot forward
      continue;
    }

    const share = Math.floor(pot.amount / potWinners.length);
    const remainder = pot.amount % potWinners.length;

    for (let j = 0; j < potWinners.length; j++) {
      winners.push({
        playerId: potWinners[j].playerId,
        amount: share + (j === 0 ? remainder : 0),
        potIndex: i,
      });
    }
  }

  return winners;
}

function arraysEqual(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const sa = [...a].sort();
  const sb = [...b].sort();
  return sa.every((v, i) => v === sb[i]);
}
