/**
 * Hand probability calculator. Given a player's hole cards and community cards,
 * calculates the probability of making each poker hand type.
 *
 * Uses exhaustive enumeration for flop/turn/river (fast) and Monte Carlo
 * sampling for pre-flop.
 *
 * Also provides win equity calculation via Monte Carlo simulation against
 * random opponent hands. Win equity shows the probability of winning WITH
 * each hand type (factoring in opponents). Ties count as half wins.
 */

import pokersolver from 'pokersolver';
const { Hand } = pokersolver;
import type { HandRank } from '@pokerathome/schema';
import { createDeck } from './deck.js';

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

const ALL_RANKS: HandRank[] = [
  'HIGH_CARD', 'PAIR', 'TWO_PAIR', 'THREE_OF_A_KIND',
  'STRAIGHT', 'FLUSH', 'FULL_HOUSE', 'FOUR_OF_A_KIND',
  'STRAIGHT_FLUSH', 'ROYAL_FLUSH',
];

export type HandProbabilities = Record<HandRank, number>;

function emptyProbabilities(): Record<HandRank, number> {
  const result = {} as Record<HandRank, number>;
  for (const rank of ALL_RANKS) {
    result[rank] = 0;
  }
  return result;
}

function getRemainingDeck(holeCards: [string, string], communityCards: string[]): string[] {
  const known = new Set([...holeCards, ...communityCards]);
  return createDeck().filter((c) => !known.has(c));
}

function resolveRank(cards: string[]): HandRank {
  const hand = Hand.solve(cards);
  // pokersolver returns rank 9 for both straight flush and royal flush
  if (hand.rank === 9 && hand.descr === 'Royal Flush') {
    return 'ROYAL_FLUSH';
  }
  return RANK_MAP[hand.rank] ?? 'HIGH_CARD';
}

/**
 * Calculate the probability of making each hand type.
 * @param holeCards Player's 2 hole cards
 * @param communityCards 0-5 community cards
 * @param sampleSize Monte Carlo sample count for pre-flop (default 3000)
 */
export function calculateHandProbabilities(
  holeCards: [string, string],
  communityCards: string[],
  sampleSize = 3000
): HandProbabilities {
  const remaining = getRemainingDeck(holeCards, communityCards);
  const needed = 5 - communityCards.length;

  if (needed === 0) {
    // River: just evaluate the hand
    return evaluateRiver(holeCards, communityCards);
  } else if (needed === 1) {
    // Turn: 46 possible cards
    return evaluateTurn(holeCards, communityCards, remaining);
  } else if (needed === 2) {
    // Flop: C(47,2) = 1,081 combos
    return evaluateFlop(holeCards, communityCards, remaining);
  } else {
    // Pre-flop: Monte Carlo
    return evaluatePreFlop(holeCards, remaining, sampleSize);
  }
}

function evaluateRiver(holeCards: [string, string], communityCards: string[]): HandProbabilities {
  const probs = emptyProbabilities();
  const rank = resolveRank([...holeCards, ...communityCards]);
  probs[rank] = 1;
  return probs;
}

function evaluateTurn(
  holeCards: [string, string],
  communityCards: string[],
  remaining: string[]
): HandProbabilities {
  const counts = emptyProbabilities();
  const total = remaining.length;

  for (const card of remaining) {
    const rank = resolveRank([...holeCards, ...communityCards, card]);
    counts[rank]++;
  }

  for (const rank of ALL_RANKS) {
    counts[rank] /= total;
  }
  return counts;
}

function evaluateFlop(
  holeCards: [string, string],
  communityCards: string[],
  remaining: string[]
): HandProbabilities {
  const counts = emptyProbabilities();
  let total = 0;

  for (let i = 0; i < remaining.length; i++) {
    for (let j = i + 1; j < remaining.length; j++) {
      const rank = resolveRank([...holeCards, ...communityCards, remaining[i], remaining[j]]);
      counts[rank]++;
      total++;
    }
  }

  for (const rank of ALL_RANKS) {
    counts[rank] /= total;
  }
  return counts;
}

function evaluatePreFlop(
  holeCards: [string, string],
  remaining: string[],
  sampleSize: number
): HandProbabilities {
  const counts = emptyProbabilities();
  const deck = [...remaining];

  for (let s = 0; s < sampleSize; s++) {
    // Partial Fisher-Yates: only shuffle first 5 positions
    for (let i = 0; i < 5; i++) {
      const j = i + Math.floor(Math.random() * (deck.length - i));
      [deck[i], deck[j]] = [deck[j], deck[i]];
    }
    const rank = resolveRank([...holeCards, deck[0], deck[1], deck[2], deck[3], deck[4]]);
    counts[rank]++;
  }

  for (const rank of ALL_RANKS) {
    counts[rank] /= sampleSize;
  }
  return counts;
}

/**
 * Calculate win equity per hand type via Monte Carlo simulation.
 * For each trial, deals remaining community cards and random opponent hands,
 * then checks if the player wins. Wins are tallied by the player's hand type.
 * Ties count as 0.5 wins.
 *
 * @param holeCards Player's 2 hole cards
 * @param communityCards 0-5 community cards
 * @param numOpponents Number of opponents to simulate
 * @param sampleSize Monte Carlo sample count (default 3000)
 */
export function calculateWinEquity(
  holeCards: [string, string],
  communityCards: string[],
  numOpponents: number,
  sampleSize = 3000
): HandProbabilities {
  if (numOpponents <= 0) {
    // No opponents — formation probability equals win probability
    return calculateHandProbabilities(holeCards, communityCards, sampleSize);
  }

  const remaining = getRemainingDeck(holeCards, communityCards);
  const needed = 5 - communityCards.length;
  const cardsPerTrial = needed + numOpponents * 2;

  // Need enough remaining cards for board completion + opponent hands
  if (remaining.length < cardsPerTrial) {
    return emptyProbabilities();
  }

  const counts = emptyProbabilities();
  const deck = [...remaining];

  for (let s = 0; s < sampleSize; s++) {
    // Partial Fisher-Yates: shuffle only the positions we need
    for (let i = 0; i < cardsPerTrial; i++) {
      const j = i + Math.floor(Math.random() * (deck.length - i));
      [deck[i], deck[j]] = [deck[j], deck[i]];
    }

    // Deal board completion
    const board = [...communityCards];
    for (let i = 0; i < needed; i++) {
      board.push(deck[i]);
    }

    // Evaluate player's hand
    const playerCards = [...holeCards, ...board];
    const playerHand = Hand.solve(playerCards);
    const playerRank = resolveRank(playerCards);

    // Evaluate opponent hands
    const allHands = [playerHand];
    for (let o = 0; o < numOpponents; o++) {
      const offset = needed + o * 2;
      const oppCards = [deck[offset], deck[offset + 1], ...board];
      allHands.push(Hand.solve(oppCards));
    }

    // Determine winner(s)
    const winners = Hand.winners(allHands);
    if (winners.includes(playerHand)) {
      // Player won or tied
      const credit = winners.length === 1 ? 1.0 : 0.5;
      counts[playerRank] += credit;
    }
  }

  for (const rank of ALL_RANKS) {
    counts[rank] /= sampleSize;
  }
  return counts;
}
