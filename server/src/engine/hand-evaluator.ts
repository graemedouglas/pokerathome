/**
 * Poker hand evaluation. Thin wrapper around pokersolver.
 */

import { Hand } from 'pokersolver';
import type { HandRank, ShowdownResult } from '@pokerathome/schema';

const RANK_MAP: Record<number, HandRank> = {
  1: 'HIGH_CARD',
  2: 'PAIR',
  3: 'TWO_PAIR',
  4: 'THREE_OF_A_KIND',
  5: 'STRAIGHT',
  6: 'FLUSH',
  7: 'FULL_HOUSE',
  8: 'FOUR_OF_A_KIND',
  9: 'STRAIGHT_FLUSH',
  10: 'ROYAL_FLUSH',
};

export interface EvaluatedHand {
  playerId: string;
  hand: Hand;
  handRank: HandRank;
  handDescription: string;
  holeCards: [string, string];
}

/** Evaluate a single player's best hand from hole cards + community cards. */
export function evaluateHand(
  playerId: string,
  holeCards: [string, string],
  communityCards: string[]
): EvaluatedHand {
  const allCards = [...holeCards, ...communityCards];
  const hand = Hand.solve(allCards);
  const handRank = RANK_MAP[hand.rank] ?? 'HIGH_CARD';
  return {
    playerId,
    hand,
    handRank,
    handDescription: hand.descr,
    holeCards,
  };
}

/** Evaluate all non-folded players and determine winners per pot. */
export function evaluateShowdown(
  players: Array<{ id: string; holeCards: [string, string] | null; folded: boolean }>,
  communityCards: string[]
): { results: ShowdownResult[]; evaluatedHands: EvaluatedHand[] } {
  const evaluatedHands: EvaluatedHand[] = [];

  for (const player of players) {
    if (player.folded || !player.holeCards) continue;
    evaluatedHands.push(evaluateHand(player.id, player.holeCards, communityCards));
  }

  const results: ShowdownResult[] = evaluatedHands.map((eh) => ({
    playerId: eh.playerId,
    holeCards: eh.holeCards,
    handRank: eh.handRank,
    handDescription: eh.handDescription,
  }));

  return { results, evaluatedHands };
}

/**
 * Given evaluated hands and a list of eligible player IDs,
 * find the winner(s) among them.
 */
export function findWinners(
  evaluatedHands: EvaluatedHand[],
  eligiblePlayerIds: string[]
): EvaluatedHand[] {
  const eligible = evaluatedHands.filter((eh) => eligiblePlayerIds.includes(eh.playerId));
  if (eligible.length === 0) return [];
  if (eligible.length === 1) return eligible;

  const hands = eligible.map((eh) => eh.hand);
  const winningHands = Hand.winners(hands);
  return eligible.filter((eh) => winningHands.includes(eh.hand));
}
