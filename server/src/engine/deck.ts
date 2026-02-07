/**
 * Standard 52-card deck operations. Pure functions, no side effects.
 */

const RANKS = ['2', '3', '4', '5', '6', '7', '8', '9', 'T', 'J', 'Q', 'K', 'A'] as const;
const SUITS = ['h', 'd', 'c', 's'] as const;

/** Create a fresh 52-card deck in deterministic order. */
export function createDeck(): string[] {
  const deck: string[] = [];
  for (const rank of RANKS) {
    for (const suit of SUITS) {
      deck.push(`${rank}${suit}`);
    }
  }
  return deck;
}

/** Fisher-Yates shuffle. Returns a new array. */
export function shuffle(deck: string[]): string[] {
  const shuffled = [...deck];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
}

/** Deal cards off the top of the deck. Returns dealt cards and remaining deck. */
export function deal(deck: string[], count: number): { cards: string[]; remaining: string[] } {
  if (count > deck.length) {
    throw new Error(`Cannot deal ${count} cards from deck of ${deck.length}`);
  }
  return {
    cards: deck.slice(0, count),
    remaining: deck.slice(count),
  };
}
