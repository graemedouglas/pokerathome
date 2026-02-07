declare module 'pokersolver' {
  class Hand {
    rank: number;
    name: string;
    descr: string;
    cards: Array<{ value: string; suit: string }>;
    static solve(cards: string[], game?: string, canDisqualify?: boolean): Hand;
    static winners(hands: Hand[]): Hand[];
  }

  const pokersolver: { Hand: typeof Hand };
  export default pokersolver;
  export { Hand };
}
