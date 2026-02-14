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
