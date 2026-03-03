/**
 * Client-side hand evaluation for displaying the player's current hand during play.
 * Uses the same pokersolver library as the server.
 */

import pokersolver from 'pokersolver';
import type { Card } from '../types';
const { Hand } = pokersolver;

/** Convert UI Card to pokersolver notation (e.g., "Ah", "Td") */
function toPokersolverCard(card: Card): string {
  return card.code;
}

/**
 * Evaluate the best 5-card hand from hole cards + community cards.
 * Returns a human-readable description (e.g., "Pair, J's") or null if not enough cards.
 */
export function evaluateHandDescription(holeCards: Card[], communityCards: Card[]): string | null {
  if (holeCards.length < 2) return null;

  const all = [...holeCards, ...communityCards].map(toPokersolverCard);
  if (all.length < 2) return null;

  try {
    const hand = Hand.solve(all);
    return hand.descr;
  } catch {
    return null;
  }
}

const RANK_MAP: Record<number, string> = {
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

/**
 * Evaluate the hand rank and description from hole cards + community cards.
 * Returns { rank: HandRank string, description: human-readable } or null.
 */
export function evaluateHandRank(holeCards: Card[], communityCards: Card[]): { rank: string; description: string } | null {
  if (holeCards.length < 2) return null;

  const all = [...holeCards, ...communityCards].map(toPokersolverCard);
  if (all.length < 2) return null;

  try {
    const hand = Hand.solve(all);
    // pokersolver returns rank 9 for both straight flush and royal flush
    const rank = hand.rank === 9 && hand.descr === 'Royal Flush'
      ? 'ROYAL_FLUSH'
      : (RANK_MAP[hand.rank] ?? 'HIGH_CARD');
    return { rank, description: hand.descr };
  } catch {
    return null;
  }
}
