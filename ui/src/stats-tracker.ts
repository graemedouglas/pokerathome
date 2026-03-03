/**
 * Pure stats accumulator for game session tracking.
 * No UI dependencies — easily testable.
 */

const HAND_RANK_ORDER: Record<string, number> = {
  HIGH_CARD: 1,
  PAIR: 2,
  TWO_PAIR: 3,
  THREE_OF_A_KIND: 4,
  STRAIGHT: 5,
  FLUSH: 6,
  FULL_HOUSE: 7,
  FOUR_OF_A_KIND: 8,
  STRAIGHT_FLUSH: 9,
  ROYAL_FLUSH: 10,
};

export class StatsTracker {
  // Cumulative stats
  handsPlayed = 0;
  handsWon = 0;
  handsFolded = 0;
  biggestPotSeen = 0;
  biggestPotWon = 0;
  bestHandRank: string | null = null;
  bestHandDescription: string | null = null;

  // Street visibility
  handsSeenFlop = 0;
  handsSeenTurn = 0;
  handsSeenRiver = 0;
  handsSeenShowdown = 0;

  // Spend tracking
  private spendHistory: number[] = [];
  private spendAtFlop: number[] = [];
  private spendAtTurn: number[] = [];
  private spendAtRiver: number[] = [];
  private spendAtShowdown: number[] = [];

  // Per-hand state (reset each hand)
  private handStartStack = 0;
  private handActive = false;
  handFolded = false;

  // Game info
  playerCount = 0;
  smallBlind = 0;
  bigBlind = 0;

  /** Start tracking a new hand. */
  beginHand(startStack: number): void {
    this.handStartStack = startStack;
    this.handActive = true;
    this.handFolded = false;
  }

  /** Record that the player reached a street. */
  recordStreet(street: 'flop' | 'turn' | 'river' | 'showdown', currentStack: number): void {
    if (!this.handActive) return;
    const spent = this.handStartStack - currentStack;

    switch (street) {
      case 'flop':
        this.handsSeenFlop++;
        this.spendAtFlop.push(spent);
        break;
      case 'turn':
        this.handsSeenTurn++;
        this.spendAtTurn.push(spent);
        break;
      case 'river':
        this.handsSeenRiver++;
        this.spendAtRiver.push(spent);
        break;
      case 'showdown':
        this.handsSeenShowdown++;
        this.spendAtShowdown.push(spent);
        break;
    }
  }

  /** Record that the player folded this hand. */
  recordFold(): void {
    if (!this.handActive) return;
    this.handFolded = true;
  }

  /** Record a hand rank if it's the player's best so far. */
  recordBestHand(handRank: string, handDescription: string): void {
    const newOrder = HAND_RANK_ORDER[handRank] ?? 0;
    const currentOrder = this.bestHandRank ? (HAND_RANK_ORDER[this.bestHandRank] ?? 0) : 0;
    if (newOrder > currentOrder) {
      this.bestHandRank = handRank;
      this.bestHandDescription = handDescription;
    }
  }

  /** Finalize a hand. Call after all street/fold/bestHand calls. */
  endHand(pot: number, amountWon: number, endStack: number): void {
    this.handsPlayed++;
    this.biggestPotSeen = Math.max(this.biggestPotSeen, pot);

    if (amountWon > 0) {
      this.handsWon++;
      this.biggestPotWon = Math.max(this.biggestPotWon, amountWon);
    }

    if (this.handFolded) {
      this.handsFolded++;
    }

    // Track spend: startStack - endStack + amountWon
    if (this.handActive) {
      const spent = this.handStartStack - endStack + amountWon;
      this.spendHistory.push(Math.max(0, spent));
    }

    this.handActive = false;
  }

  /** Update dynamic game info. */
  updateGameInfo(playerCount: number, smallBlind: number, bigBlind: number): void {
    this.playerCount = playerCount;
    this.smallBlind = smallBlind;
    this.bigBlind = bigBlind;
  }

  get winRate(): number {
    return this.handsPlayed > 0 ? (this.handsWon / this.handsPlayed) * 100 : 0;
  }

  get foldRate(): number {
    return this.handsPlayed > 0 ? (this.handsFolded / this.handsPlayed) * 100 : 0;
  }

  get medianSpend(): number {
    if (this.spendHistory.length === 0) return 0;
    const sorted = [...this.spendHistory].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 === 0
      ? (sorted[mid - 1] + sorted[mid]) / 2
      : sorted[mid];
  }

  /** Format stats as a display string. */
  formatStats(): string {
    const lines: string[] = [];

    // Summary line
    lines.push(`Hands: ${this.handsPlayed} (Won ${this.handsWon} / Folded ${this.handsFolded})`);
    lines.push(`Win Rate: ${this.winRate.toFixed(1)}%`);

    // Pot stats
    const potWonStr = this.biggestPotWon > 0 ? ` (Won: $${this.biggestPotWon})` : '';
    lines.push(`Biggest Pot: $${this.biggestPotSeen}${potWonStr}`);

    // Best hand
    if (this.bestHandDescription) {
      lines.push(`Best Hand: ${this.bestHandDescription}`);
    }

    // Median spend
    if (this.spendHistory.length > 0) {
      lines.push(`Median Spend: $${Math.round(this.medianSpend)}/hand`);
    }

    lines.push('');

    // Street stats
    if (this.handsPlayed > 0) {
      const streetLine = (label: string, count: number, spends: number[]): string => {
        const pct = ((count / this.handsPlayed) * 100).toFixed(0);
        const avg = spends.length > 0
          ? Math.round(spends.reduce((a, b) => a + b, 0) / spends.length)
          : 0;
        return `${label.padEnd(10)} ${pct.padStart(3)}%   avg $${avg}`;
      };
      lines.push(streetLine('Flop', this.handsSeenFlop, this.spendAtFlop));
      lines.push(streetLine('Turn', this.handsSeenTurn, this.spendAtTurn));
      lines.push(streetLine('River', this.handsSeenRiver, this.spendAtRiver));
      lines.push(streetLine('Showdown', this.handsSeenShowdown, this.spendAtShowdown));
    }

    lines.push('');
    lines.push(`Blinds: $${this.smallBlind}/$${this.bigBlind}  Players: ${this.playerCount}`);

    return lines.join('\n');
  }
}
