/**
 * Pure stats accumulator for game session tracking.
 * No UI dependencies — easily testable.
 */
export class StatsTracker {
  handsPlayed = 0;
  handsWon = 0;
  biggestPot = 0;
  playerCount = 0;
  smallBlind = 0;
  bigBlind = 0;

  /** Record the end of a hand. */
  recordHandEnd(pot: number, humanWon: boolean): void {
    this.handsPlayed++;
    this.biggestPot = Math.max(this.biggestPot, pot);
    if (humanWon) {
      this.handsWon++;
    }
  }

  /** Update dynamic game info. */
  updateGameInfo(playerCount: number, smallBlind: number, bigBlind: number): void {
    this.playerCount = playerCount;
    this.smallBlind = smallBlind;
    this.bigBlind = bigBlind;
  }

  /** Win rate as a percentage (0-100). */
  get winRate(): number {
    return this.handsPlayed > 0 ? (this.handsWon / this.handsPlayed) * 100 : 0;
  }

  /** Format stats as a display string. */
  formatStats(): string {
    return [
      `Hands Played: ${this.handsPlayed}`,
      `Hands Won: ${this.handsWon}`,
      `Win Rate: ${this.winRate.toFixed(1)}%`,
      `Biggest Pot: $${this.biggestPot}`,
      '',
      `Blinds: $${this.smallBlind} / $${this.bigBlind}`,
      `Players: ${this.playerCount}`,
    ].join('\n');
  }
}
