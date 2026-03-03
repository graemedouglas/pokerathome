import { StatsTracker } from '../../ui/src/stats-tracker';

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
    expect(tracker.biggestPot).toBe(0);
    expect(tracker.playerCount).toBe(0);
    expect(tracker.smallBlind).toBe(0);
    expect(tracker.bigBlind).toBe(0);
  });

  test('win rate is 0 with no hands played', () => {
    expect(tracker.winRate).toBe(0);
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // recordHandEnd
  // ═══════════════════════════════════════════════════════════════════════════

  test('increments hands played on each hand end', () => {
    tracker.recordHandEnd(100, false);
    expect(tracker.handsPlayed).toBe(1);
    tracker.recordHandEnd(200, false);
    expect(tracker.handsPlayed).toBe(2);
    tracker.recordHandEnd(300, true);
    expect(tracker.handsPlayed).toBe(3);
  });

  test('increments hands won only when human wins', () => {
    tracker.recordHandEnd(100, false);
    expect(tracker.handsWon).toBe(0);
    tracker.recordHandEnd(200, true);
    expect(tracker.handsWon).toBe(1);
    tracker.recordHandEnd(300, false);
    expect(tracker.handsWon).toBe(1);
    tracker.recordHandEnd(400, true);
    expect(tracker.handsWon).toBe(2);
  });

  test('tracks biggest pot across multiple hands', () => {
    tracker.recordHandEnd(100, false);
    expect(tracker.biggestPot).toBe(100);
    tracker.recordHandEnd(50, false);
    expect(tracker.biggestPot).toBe(100); // max stays at 100
    tracker.recordHandEnd(500, true);
    expect(tracker.biggestPot).toBe(500);
    tracker.recordHandEnd(200, false);
    expect(tracker.biggestPot).toBe(500); // max stays at 500
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // Win rate calculation
  // ═══════════════════════════════════════════════════════════════════════════

  test('win rate is correct after multiple hands', () => {
    tracker.recordHandEnd(100, true);
    tracker.recordHandEnd(100, false);
    tracker.recordHandEnd(100, true);
    tracker.recordHandEnd(100, false);
    expect(tracker.winRate).toBe(50);
  });

  test('win rate 100% when all hands won', () => {
    tracker.recordHandEnd(100, true);
    tracker.recordHandEnd(200, true);
    expect(tracker.winRate).toBe(100);
  });

  test('win rate 0% when no hands won', () => {
    tracker.recordHandEnd(100, false);
    tracker.recordHandEnd(200, false);
    expect(tracker.winRate).toBe(0);
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
    tracker.recordHandEnd(200, true);
    tracker.recordHandEnd(100, false);

    const output = tracker.formatStats();
    expect(output).toContain('Hands Played: 2');
    expect(output).toContain('Hands Won: 1');
    expect(output).toContain('Win Rate: 50.0%');
    expect(output).toContain('Biggest Pot: $200');
    expect(output).toContain('Blinds: $5 / $10');
    expect(output).toContain('Players: 6');
  });

  test('formatStats shows 0.0% win rate with no hands', () => {
    const output = tracker.formatStats();
    expect(output).toContain('Win Rate: 0.0%');
    expect(output).toContain('Hands Played: 0');
  });

  test('formatStats updates after game info change', () => {
    tracker.updateGameInfo(4, 25, 50);
    const output = tracker.formatStats();
    expect(output).toContain('Blinds: $25 / $50');
    expect(output).toContain('Players: 4');
  });
});
