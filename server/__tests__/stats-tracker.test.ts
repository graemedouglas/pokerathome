import { StatsTracker } from '../../ui/src/stats-tracker';

/** Helper: simulate a full hand lifecycle */
function playHand(
  tracker: StatsTracker,
  opts: {
    startStack: number;
    pot: number;
    amountWon?: number;
    endStack: number;
    fold?: boolean;
    streets?: Array<{ street: 'flop' | 'turn' | 'river' | 'showdown'; chips: number }>;
    bestHand?: { rank: string; description: string };
  },
): void {
  tracker.beginHand(opts.startStack);
  if (opts.fold) tracker.recordFold();
  if (opts.streets) {
    for (const s of opts.streets) tracker.recordStreet(s.street, s.chips);
  }
  if (opts.bestHand) tracker.recordBestHand(opts.bestHand.rank, opts.bestHand.description);
  tracker.endHand(opts.pot, opts.amountWon ?? 0, opts.endStack);
}

describe('StatsTracker', () => {
  let tracker: StatsTracker;

  beforeEach(() => {
    tracker = new StatsTracker();
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // Initial state
  // ═══════════════════════════════════════════════════════════════════════════

  test('starts with all zeros', () => {
    expect(tracker.handsPlayed).toBe(0);
    expect(tracker.handsWon).toBe(0);
    expect(tracker.handsFolded).toBe(0);
    expect(tracker.biggestPotSeen).toBe(0);
    expect(tracker.biggestPotWon).toBe(0);
    expect(tracker.bestHandRank).toBeNull();
    expect(tracker.bestHandDescription).toBeNull();
    expect(tracker.playerCount).toBe(0);
    expect(tracker.smallBlind).toBe(0);
    expect(tracker.bigBlind).toBe(0);
  });

  test('win rate and fold rate are 0 with no hands played', () => {
    expect(tracker.winRate).toBe(0);
    expect(tracker.foldRate).toBe(0);
  });

  test('median spend is 0 with no hands played', () => {
    expect(tracker.medianSpend).toBe(0);
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // Hand lifecycle
  // ═══════════════════════════════════════════════════════════════════════════

  test('beginHand → endHand increments handsPlayed', () => {
    playHand(tracker, { startStack: 1000, pot: 50, endStack: 975 });
    expect(tracker.handsPlayed).toBe(1);
    playHand(tracker, { startStack: 975, pot: 100, endStack: 925 });
    expect(tracker.handsPlayed).toBe(2);
  });

  test('beginHand → recordFold → endHand increments handsFolded', () => {
    playHand(tracker, { startStack: 1000, pot: 50, endStack: 990, fold: true });
    expect(tracker.handsFolded).toBe(1);
    expect(tracker.handsPlayed).toBe(1);
  });

  test('beginHand → endHand with win increments handsWon', () => {
    playHand(tracker, { startStack: 1000, pot: 200, amountWon: 200, endStack: 1200 });
    expect(tracker.handsWon).toBe(1);
    playHand(tracker, { startStack: 1200, pot: 100, amountWon: 0, endStack: 1150 });
    expect(tracker.handsWon).toBe(1); // didn't win second hand
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // Pot tracking
  // ═══════════════════════════════════════════════════════════════════════════

  test('biggestPotSeen tracks max pot across all hands', () => {
    playHand(tracker, { startStack: 1000, pot: 100, endStack: 950 });
    expect(tracker.biggestPotSeen).toBe(100);
    playHand(tracker, { startStack: 950, pot: 50, endStack: 925 });
    expect(tracker.biggestPotSeen).toBe(100); // max stays
    playHand(tracker, { startStack: 925, pot: 500, endStack: 675 });
    expect(tracker.biggestPotSeen).toBe(500);
  });

  test('biggestPotWon tracks max pot won by player', () => {
    playHand(tracker, { startStack: 1000, pot: 200, amountWon: 0, endStack: 900 });
    expect(tracker.biggestPotWon).toBe(0); // lost
    playHand(tracker, { startStack: 900, pot: 150, amountWon: 150, endStack: 1050 });
    expect(tracker.biggestPotWon).toBe(150);
    playHand(tracker, { startStack: 1050, pot: 300, amountWon: 300, endStack: 1350 });
    expect(tracker.biggestPotWon).toBe(300);
    playHand(tracker, { startStack: 1350, pot: 100, amountWon: 100, endStack: 1450 });
    expect(tracker.biggestPotWon).toBe(300); // max stays
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // Best hand
  // ═══════════════════════════════════════════════════════════════════════════

  test('recordBestHand keeps higher-ranked hand', () => {
    tracker.recordBestHand('TWO_PAIR', "Two Pair, A's & K's");
    expect(tracker.bestHandRank).toBe('TWO_PAIR');
    tracker.recordBestHand('FULL_HOUSE', 'Full House, A over K');
    expect(tracker.bestHandRank).toBe('FULL_HOUSE');
    expect(tracker.bestHandDescription).toBe('Full House, A over K');
  });

  test('recordBestHand does NOT downgrade', () => {
    tracker.recordBestHand('FULL_HOUSE', 'Full House, A over K');
    tracker.recordBestHand('PAIR', "Pair, J's");
    expect(tracker.bestHandRank).toBe('FULL_HOUSE');
    expect(tracker.bestHandDescription).toBe('Full House, A over K');
  });

  test('Royal Flush is the absolute best', () => {
    tracker.recordBestHand('STRAIGHT_FLUSH', 'Straight Flush, K High');
    tracker.recordBestHand('ROYAL_FLUSH', 'Royal Flush');
    expect(tracker.bestHandRank).toBe('ROYAL_FLUSH');
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // Win rate / fold rate
  // ═══════════════════════════════════════════════════════════════════════════

  test('win rate is correct after multiple hands', () => {
    playHand(tracker, { startStack: 1000, pot: 100, amountWon: 100, endStack: 1100 });
    playHand(tracker, { startStack: 1100, pot: 100, amountWon: 0, endStack: 1050 });
    playHand(tracker, { startStack: 1050, pot: 100, amountWon: 100, endStack: 1150 });
    playHand(tracker, { startStack: 1150, pot: 100, amountWon: 0, endStack: 1100 });
    expect(tracker.winRate).toBe(50);
  });

  test('fold rate tracks correctly', () => {
    playHand(tracker, { startStack: 1000, pot: 50, endStack: 990, fold: true });
    playHand(tracker, { startStack: 990, pot: 100, amountWon: 100, endStack: 1090 });
    playHand(tracker, { startStack: 1090, pot: 50, endStack: 1080, fold: true });
    expect(tracker.foldRate).toBeCloseTo(66.67, 0);
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // Spend tracking
  // ═══════════════════════════════════════════════════════════════════════════

  test('medianSpend with odd number of hands', () => {
    // Spend = startStack - endStack + amountWon
    playHand(tracker, { startStack: 1000, pot: 100, amountWon: 0, endStack: 950 }); // spent 50
    playHand(tracker, { startStack: 950, pot: 200, amountWon: 0, endStack: 850 });  // spent 100
    playHand(tracker, { startStack: 850, pot: 60, amountWon: 0, endStack: 820 });   // spent 30
    // sorted: [30, 50, 100] → median = 50
    expect(tracker.medianSpend).toBe(50);
  });

  test('medianSpend with even number of hands', () => {
    playHand(tracker, { startStack: 1000, pot: 100, amountWon: 0, endStack: 960 }); // spent 40
    playHand(tracker, { startStack: 960, pot: 200, amountWon: 0, endStack: 900 });  // spent 60
    // sorted: [40, 60] → median = 50
    expect(tracker.medianSpend).toBe(50);
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // Street stats
  // ═══════════════════════════════════════════════════════════════════════════

  test('recordStreet increments street counters', () => {
    tracker.beginHand(1000);
    tracker.recordStreet('flop', 975);
    tracker.recordStreet('turn', 950);
    tracker.recordStreet('river', 900);
    tracker.recordStreet('showdown', 900);
    tracker.endHand(200, 200, 1100);

    expect(tracker.handsSeenFlop).toBe(1);
    expect(tracker.handsSeenTurn).toBe(1);
    expect(tracker.handsSeenRiver).toBe(1);
    expect(tracker.handsSeenShowdown).toBe(1);
  });

  test('recordStreet does nothing when hand is not active', () => {
    // No beginHand called
    tracker.recordStreet('flop', 975);
    expect(tracker.handsSeenFlop).toBe(0);
  });

  test('street spend is tracked correctly', () => {
    // Hand 1: start 1000, flop at 975 (spent 25), turn at 950 (spent 50)
    tracker.beginHand(1000);
    tracker.recordStreet('flop', 975);
    tracker.recordStreet('turn', 950);
    tracker.endHand(100, 0, 900);

    // Hand 2: start 900, flop at 850 (spent 50), turn at 800 (spent 100)
    tracker.beginHand(900);
    tracker.recordStreet('flop', 850);
    tracker.recordStreet('turn', 800);
    tracker.endHand(200, 0, 700);

    expect(tracker.handsSeenFlop).toBe(2);
    expect(tracker.handsSeenTurn).toBe(2);

    // Verify via formatStats that averages are shown
    const output = tracker.formatStats();
    expect(output).toContain('Flop');
    expect(output).toContain('Turn');
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // updateGameInfo
  // ═══════════════════════════════════════════════════════════════════════════

  test('updates player count, small blind, big blind', () => {
    tracker.updateGameInfo(6, 5, 10);
    expect(tracker.playerCount).toBe(6);
    expect(tracker.smallBlind).toBe(5);
    expect(tracker.bigBlind).toBe(10);
  });

  test('game info updates when blinds change', () => {
    tracker.updateGameInfo(6, 5, 10);
    tracker.updateGameInfo(5, 10, 20);
    expect(tracker.playerCount).toBe(5);
    expect(tracker.smallBlind).toBe(10);
    expect(tracker.bigBlind).toBe(20);
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // formatStats
  // ═══════════════════════════════════════════════════════════════════════════

  test('formatStats includes all fields', () => {
    tracker.updateGameInfo(6, 5, 10);
    playHand(tracker, {
      startStack: 1000, pot: 200, amountWon: 200, endStack: 1200,
      bestHand: { rank: 'FLUSH', description: 'Flush, A High' },
    });
    playHand(tracker, { startStack: 1200, pot: 100, amountWon: 0, endStack: 1150, fold: true });

    const output = tracker.formatStats();
    expect(output).toContain('Hands: 2');
    expect(output).toContain('Won 1');
    expect(output).toContain('Folded 1');
    expect(output).toContain('Win Rate: 50.0%');
    expect(output).toContain('Biggest Pot: $200');
    expect(output).toContain('Won: $200');
    expect(output).toContain('Best Hand: Flush, A High');
    expect(output).toContain('Blinds: $5/$10');
    expect(output).toContain('Players: 6');
  });

  test('formatStats shows 0.0% win rate with no hands', () => {
    const output = tracker.formatStats();
    expect(output).toContain('Win Rate: 0.0%');
    expect(output).toContain('Hands: 0');
  });

  test('formatStats includes median spend when hands exist', () => {
    playHand(tracker, { startStack: 1000, pot: 100, amountWon: 0, endStack: 960 }); // spent 40
    playHand(tracker, { startStack: 960, pot: 200, amountWon: 0, endStack: 900 });  // spent 60
    const output = tracker.formatStats();
    expect(output).toContain('Median Spend: $50/hand');
  });

  test('formatStats updates after game info change', () => {
    tracker.updateGameInfo(4, 25, 50);
    const output = tracker.formatStats();
    expect(output).toContain('Blinds: $25/$50');
    expect(output).toContain('Players: 4');
  });
});
