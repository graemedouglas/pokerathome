/**
 * Hand strength evaluation utilities for bot strategies.
 *
 * - Preflop: Chen formula scoring for starting hand selection
 * - Postflop: pokersolver-based hand ranking
 */

import pokersolver from 'pokersolver'
const { Hand } = pokersolver

// ─── Preflop hand strength (Chen formula) ────────────────────────────────────

const RANK_VALUES: Record<string, number> = {
  'A': 10, 'K': 8, 'Q': 7, 'J': 6, 'T': 5,
  '9': 4.5, '8': 4, '7': 3.5, '6': 3, '5': 2.5,
  '4': 2, '3': 1.5, '2': 1,
}

const RANK_ORDER = 'AKQJT98765432'

function rankIndex(r: string): number {
  return RANK_ORDER.indexOf(r)
}

/**
 * Calculate Chen formula score for a starting hand.
 * Returns a number roughly 0-20, higher = stronger.
 */
export function chenScore(card1: string, card2: string): number {
  const r1 = card1[0]
  const r2 = card2[0]
  const s1 = card1[1]
  const s2 = card2[1]

  const v1 = RANK_VALUES[r1] ?? 0
  const v2 = RANK_VALUES[r2] ?? 0

  // Start with highest card value
  let score = Math.max(v1, v2)

  // Pair bonus
  if (r1 === r2) {
    score = Math.max(score * 2, 5)
    return Math.ceil(score)
  }

  // Suited bonus
  if (s1 === s2) {
    score += 2
  }

  // Gap penalty
  const gap = Math.abs(rankIndex(r1) - rankIndex(r2)) - 1
  if (gap === 1) score -= 1
  else if (gap === 2) score -= 2
  else if (gap === 3) score -= 4
  else if (gap >= 4) score -= 5

  // Straight potential bonus for close cards
  if (gap <= 1) {
    const highRank = Math.min(rankIndex(r1), rankIndex(r2))
    if (highRank >= RANK_ORDER.indexOf('Q')) {
      // Low cards (Q or worse index means higher value)
      // Actually index 0 = A, so higher index = lower card
    }
    // Bonus for connected/gapped cards that can make straights
    if (highRank <= 9) { // Both cards 5 or above
      score += 1
    }
  }

  return Math.max(Math.ceil(score), 0)
}

export type PreflopTier = 'premium' | 'strong' | 'playable' | 'weak'

/**
 * Categorize a starting hand into a tier based on Chen score.
 */
export function preflopTier(card1: string, card2: string): PreflopTier {
  const score = chenScore(card1, card2)
  if (score >= 12) return 'premium'   // AA, KK, QQ, AKs
  if (score >= 9) return 'strong'     // JJ, TT, AQs, AKo, AJs, KQs
  if (score >= 6) return 'playable'   // Mid pairs, suited connectors, suited aces
  return 'weak'
}

// ─── Postflop hand strength ──────────────────────────────────────────────────

export type PostflopStrength = 'monster' | 'strong' | 'medium' | 'weak'

/**
 * Evaluate postflop hand strength using pokersolver.
 * Returns a strength category based on the hand ranking.
 */
export function postflopStrength(
  holeCards: [string, string],
  communityCards: string[]
): PostflopStrength {
  if (communityCards.length === 0) return 'weak'

  const allCards = [...holeCards, ...communityCards]
  const hand = Hand.solve(allCards)

  // pokersolver rank: 1=high card, 2=pair, 3=two pair, 4=trips, 5=straight,
  // 6=flush, 7=full house, 8=quads, 9=straight flush, 10=royal flush
  if (hand.rank >= 7) return 'monster'   // Full house+
  if (hand.rank >= 4) return 'strong'    // Trips, straight, flush
  if (hand.rank >= 3) return 'medium'    // Two pair

  // For a pair, check if we're using a hole card (top pair vs board pair)
  if (hand.rank === 2) {
    const holeRanks = holeCards.map((c) => c[0])
    const communityRanks = communityCards.map((c) => c[0])
    const holePairWithBoard = holeRanks.some((r) => communityRanks.includes(r))
    return holePairWithBoard ? 'medium' : 'weak'
  }

  return 'weak'
}

/**
 * Get the pokersolver rank number for a hand.
 * Useful for more granular comparisons.
 */
export function handRankNumber(
  holeCards: [string, string],
  communityCards: string[]
): number {
  if (communityCards.length === 0) return 0
  const allCards = [...holeCards, ...communityCards]
  const hand = Hand.solve(allCards)
  return hand.rank
}
