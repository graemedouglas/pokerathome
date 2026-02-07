import { Card, SUITS, RANKS, Suit, Rank } from '../types';

function suitCode(suit: Suit): string {
  return { hearts: 'H', diamonds: 'D', clubs: 'C', spades: 'S' }[suit];
}

function makeCard(rank: Rank, suit: Suit): Card {
  return { rank, suit, code: `${rank}${suitCode(suit)}` };
}

export class Deck {
  private cards: Card[] = [];

  constructor() {
    this.reset();
  }

  reset(): void {
    this.cards = [];
    for (const suit of SUITS) {
      for (const rank of RANKS) {
        this.cards.push(makeCard(rank, suit));
      }
    }
    this.shuffle();
  }

  /** Fisher-Yates shuffle */
  shuffle(): void {
    for (let i = this.cards.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [this.cards[i], this.cards[j]] = [this.cards[j], this.cards[i]];
    }
  }

  deal(): Card {
    const card = this.cards.pop();
    if (!card) throw new Error('Deck is empty');
    return card;
  }

  get remaining(): number {
    return this.cards.length;
  }
}
