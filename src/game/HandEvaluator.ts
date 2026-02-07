import { Card, HandRank, RANK_VALUES } from '../types';

/** Evaluate the best 5-card hand from up to 7 cards */
export function evaluateHand(cards: Card[]): HandRank {
  if (cards.length < 5) {
    return { rank: -1, description: 'Not enough cards', tiebreaker: [] };
  }

  const combos = combinations(cards, 5);
  let bestHand: HandRank | null = null;

  for (const combo of combos) {
    const hand = evaluate5(combo);
    if (!bestHand || compareHands(hand, bestHand) > 0) {
      bestHand = hand;
    }
  }

  return bestHand!;
}

function evaluate5(cards: Card[]): HandRank {
  const values = cards.map(c => RANK_VALUES[c.rank]).sort((a, b) => b - a);
  const suits = cards.map(c => c.suit);

  const isFlush = suits.every(s => s === suits[0]);
  const isStraight = checkStraight(values);

  // Check for ace-low straight (wheel)
  const isWheel = !isStraight && checkWheel(values);
  const straightValues = isWheel ? [5, 4, 3, 2, 1] : values;

  const counts = getValueCounts(values);
  const groups = Object.entries(counts)
    .map(([v, c]) => ({ value: parseInt(v), count: c }))
    .sort((a, b) => b.count - a.count || b.value - a.value);

  // Royal flush
  if (isFlush && isStraight && values[0] === 14) {
    return { rank: 9, description: 'Royal Flush', tiebreaker: values };
  }

  // Straight flush
  if (isFlush && (isStraight || isWheel)) {
    return { rank: 8, description: 'Straight Flush', tiebreaker: straightValues };
  }

  // Four of a kind
  if (groups[0].count === 4) {
    const quad = groups[0].value;
    const kicker = groups[1].value;
    return { rank: 7, description: 'Four of a Kind', tiebreaker: [quad, kicker] };
  }

  // Full house
  if (groups[0].count === 3 && groups[1].count === 2) {
    return { rank: 6, description: 'Full House', tiebreaker: [groups[0].value, groups[1].value] };
  }

  // Flush
  if (isFlush) {
    return { rank: 5, description: 'Flush', tiebreaker: values };
  }

  // Straight
  if (isStraight || isWheel) {
    return { rank: 4, description: 'Straight', tiebreaker: straightValues };
  }

  // Three of a kind
  if (groups[0].count === 3) {
    const trips = groups[0].value;
    const kickers = groups.slice(1).map(g => g.value).sort((a, b) => b - a);
    return { rank: 3, description: 'Three of a Kind', tiebreaker: [trips, ...kickers] };
  }

  // Two pair
  if (groups[0].count === 2 && groups[1].count === 2) {
    const highPair = Math.max(groups[0].value, groups[1].value);
    const lowPair = Math.min(groups[0].value, groups[1].value);
    const kicker = groups[2].value;
    return { rank: 2, description: 'Two Pair', tiebreaker: [highPair, lowPair, kicker] };
  }

  // One pair
  if (groups[0].count === 2) {
    const pair = groups[0].value;
    const kickers = groups.slice(1).map(g => g.value).sort((a, b) => b - a);
    return { rank: 1, description: 'Pair', tiebreaker: [pair, ...kickers] };
  }

  // High card
  return { rank: 0, description: 'High Card', tiebreaker: values };
}

function checkStraight(values: number[]): boolean {
  for (let i = 0; i < values.length - 1; i++) {
    if (values[i] - values[i + 1] !== 1) return false;
  }
  return true;
}

function checkWheel(values: number[]): boolean {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[0] === 2 && sorted[1] === 3 && sorted[2] === 4 && sorted[3] === 5 && sorted[4] === 14;
}

function getValueCounts(values: number[]): Record<number, number> {
  const counts: Record<number, number> = {};
  for (const v of values) {
    counts[v] = (counts[v] || 0) + 1;
  }
  return counts;
}

export function compareHands(a: HandRank, b: HandRank): number {
  if (a.rank !== b.rank) return a.rank - b.rank;
  for (let i = 0; i < Math.min(a.tiebreaker.length, b.tiebreaker.length); i++) {
    if (a.tiebreaker[i] !== b.tiebreaker[i]) return a.tiebreaker[i] - b.tiebreaker[i];
  }
  return 0;
}

function combinations<T>(arr: T[], k: number): T[][] {
  if (k === 0) return [[]];
  if (arr.length < k) return [];
  const result: T[][] = [];

  function helper(start: number, combo: T[]) {
    if (combo.length === k) {
      result.push([...combo]);
      return;
    }
    for (let i = start; i < arr.length; i++) {
      combo.push(arr[i]);
      helper(i + 1, combo);
      combo.pop();
    }
  }

  helper(0, []);
  return result;
}
