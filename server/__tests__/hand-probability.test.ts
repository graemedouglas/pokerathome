import { calculateHandProbabilities, calculateWinEquity } from '../src/engine/hand-probability';

const ALL_RANK_KEYS = [
  'HIGH_CARD', 'PAIR', 'TWO_PAIR', 'THREE_OF_A_KIND',
  'STRAIGHT', 'FLUSH', 'FULL_HOUSE', 'FOUR_OF_A_KIND',
  'STRAIGHT_FLUSH', 'ROYAL_FLUSH',
];

function sumProbs(probs: Record<string, number>): number {
  return Object.values(probs).reduce((a, b) => a + b, 0);
}

// ═══════════════════════════════════════════════════════════════════════════════
// River (single evaluation)
// ═══════════════════════════════════════════════════════════════════════════════

describe('River (5 community cards)', () => {
  test('royal flush returns 1.0 for ROYAL_FLUSH', () => {
    const probs = calculateHandProbabilities(['Ah', 'Kh'], ['Qh', 'Jh', 'Th', '2d', '3c']);
    expect(probs.ROYAL_FLUSH).toBe(1);
    expect(probs.PAIR).toBe(0);
    expect(probs.HIGH_CARD).toBe(0);
  });

  test('pair of aces returns 1.0 for PAIR', () => {
    const probs = calculateHandProbabilities(['Ah', 'Ad'], ['2c', '5d', '7s', '9h', 'Jc']);
    expect(probs.PAIR).toBe(1);
  });

  test('full house returns 1.0 for FULL_HOUSE', () => {
    const probs = calculateHandProbabilities(['Ah', 'Ad'], ['As', '2c', '2d', '7s', '9h']);
    expect(probs.FULL_HOUSE).toBe(1);
  });

  test('probabilities sum to 1.0', () => {
    const probs = calculateHandProbabilities(['7h', '2d'], ['Ac', 'Ks', 'Qd', 'Jc', '9h']);
    expect(sumProbs(probs)).toBeCloseTo(1, 5);
  });

  test('all HandRank keys are present', () => {
    const probs = calculateHandProbabilities(['Ah', 'Kh'], ['Qh', 'Jh', 'Th', '2d', '3c']);
    for (const key of ALL_RANK_KEYS) {
      expect(probs).toHaveProperty(key);
      expect(typeof probs[key as keyof typeof probs]).toBe('number');
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Turn (46 combos, exhaustive)
// ═══════════════════════════════════════════════════════════════════════════════

describe('Turn (4 community cards)', () => {
  test('probabilities sum to 1.0', () => {
    const probs = calculateHandProbabilities(['Ah', 'Kh'], ['Qh', 'Jh', '2d', '3c']);
    expect(sumProbs(probs)).toBeCloseTo(1, 5);
  });

  test('flush draw has nonzero flush probability', () => {
    // Ah Kh on Qh Jh 2d 3c → 9 hearts remain out of 46 cards
    const probs = calculateHandProbabilities(['Ah', 'Kh'], ['Qh', 'Jh', '2d', '3c']);
    expect(probs.FLUSH).toBeGreaterThan(0);
    expect(probs.STRAIGHT).toBeGreaterThan(0);
  });

  test('Th is the only royal flush out on turn', () => {
    // Ah Kh Qh Jh + 2d 3c → exactly 1 card (Th) out of 46 makes royal flush
    const probs = calculateHandProbabilities(['Ah', 'Kh'], ['Qh', 'Jh', '2d', '3c']);
    expect(probs.ROYAL_FLUSH).toBeCloseTo(1 / 46, 4);
  });

  test('made hand on turn: pocket pair with trips board', () => {
    // Already have three of a kind on the turn
    const probs = calculateHandProbabilities(['Ah', 'Ad'], ['Ac', '5d', '7s', '9h']);
    // Should have chances for quads, full house, or stay at three of a kind
    expect(probs.THREE_OF_A_KIND).toBeGreaterThan(0);
    expect(probs.FULL_HOUSE).toBeGreaterThan(0);
    expect(probs.FOUR_OF_A_KIND).toBeGreaterThan(0);
  });

  test('all values between 0 and 1', () => {
    const probs = calculateHandProbabilities(['7h', '2d'], ['Ac', 'Ks', 'Qd', '4h']);
    for (const val of Object.values(probs)) {
      expect(val).toBeGreaterThanOrEqual(0);
      expect(val).toBeLessThanOrEqual(1);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Flop (1,081 combos, exhaustive)
// ═══════════════════════════════════════════════════════════════════════════════

describe('Flop (3 community cards)', () => {
  test('probabilities sum to 1.0', () => {
    const probs = calculateHandProbabilities(['Ah', 'Kh'], ['Qh', 'Jh', '2d']);
    expect(sumProbs(probs)).toBeCloseTo(1, 5);
  });

  test('pocket aces have chances for multiple hand types', () => {
    const probs = calculateHandProbabilities(['Ah', 'Ad'], ['2c', '5d', '7s']);
    expect(probs.PAIR).toBeGreaterThan(0);
    expect(probs.THREE_OF_A_KIND).toBeGreaterThan(0);
    expect(probs.FULL_HOUSE).toBeGreaterThan(0);
    expect(probs.FOUR_OF_A_KIND).toBeGreaterThan(0);
    // Pocket aces can never be just high card with this board
    expect(probs.HIGH_CARD).toBe(0);
  });

  test('flush draw on flop shows substantial flush probability', () => {
    // Ah Kh on 3h 7h 2d → 4 hearts known, need 1 more in 2 cards
    const probs = calculateHandProbabilities(['Ah', 'Kh'], ['3h', '7h', '2d']);
    expect(probs.FLUSH).toBeGreaterThan(0.05); // Should be a decent draw
  });

  test('all values between 0 and 1', () => {
    const probs = calculateHandProbabilities(['Ts', 'Jd'], ['Ac', '2h', '5c']);
    for (const val of Object.values(probs)) {
      expect(val).toBeGreaterThanOrEqual(0);
      expect(val).toBeLessThanOrEqual(1);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Pre-flop (Monte Carlo)
// ═══════════════════════════════════════════════════════════════════════════════

describe('Pre-flop (Monte Carlo)', () => {
  test('probabilities sum to approximately 1.0', () => {
    const probs = calculateHandProbabilities(['Ah', 'Kh'], [], 5000);
    expect(sumProbs(probs)).toBeCloseTo(1, 1);
  });

  test('pocket aces: HIGH_CARD is 0 (impossible)', () => {
    const probs = calculateHandProbabilities(['Ah', 'Ad'], [], 5000);
    // AA always makes at least a pair
    expect(probs.HIGH_CARD).toBe(0);
    expect(probs.PAIR).toBeGreaterThan(0.3);
  });

  test('suited connectors have nonzero straight and flush probabilities', () => {
    const probs = calculateHandProbabilities(['9h', 'Th'], [], 5000);
    expect(probs.STRAIGHT).toBeGreaterThan(0);
    expect(probs.FLUSH).toBeGreaterThan(0);
  });

  test('all values between 0 and 1', () => {
    const probs = calculateHandProbabilities(['7h', '2d'], [], 3000);
    for (const val of Object.values(probs)) {
      expect(val).toBeGreaterThanOrEqual(0);
      expect(val).toBeLessThanOrEqual(1);
    }
  });

  test('all HandRank keys are present', () => {
    const probs = calculateHandProbabilities(['Ah', 'Kh'], [], 1000);
    for (const key of ALL_RANK_KEYS) {
      expect(probs).toHaveProperty(key);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Win Equity (Monte Carlo with opponents)
// ═══════════════════════════════════════════════════════════════════════════════

describe('Win Equity — River', () => {
  test('royal flush vs 1 opponent: ROYAL_FLUSH equity ≈ 1.0', () => {
    const equity = calculateWinEquity(['Ah', 'Kh'], ['Qh', 'Jh', 'Th', '2d', '3c'], 1, 3000);
    // Royal flush is unbeatable — equity should be very close to 1.0
    expect(equity.ROYAL_FLUSH).toBeGreaterThan(0.95);
  });

  test('made pair vs 1 opponent: PAIR equity < 1.0', () => {
    const equity = calculateWinEquity(['Ah', 'Ad'], ['2c', '5d', '7s', '9h', 'Jc'], 1, 3000);
    // Pair of aces is beatable
    expect(equity.PAIR).toBeGreaterThan(0);
    expect(equity.PAIR).toBeLessThan(1);
  });

  test('all values between 0 and 1', () => {
    const equity = calculateWinEquity(['Ah', 'Kh'], ['Qh', 'Jh', 'Th', '2d', '3c'], 1, 1000);
    for (const val of Object.values(equity)) {
      expect(val).toBeGreaterThanOrEqual(0);
      expect(val).toBeLessThanOrEqual(1);
    }
  });

  test('all HandRank keys are present', () => {
    const equity = calculateWinEquity(['Ah', 'Kh'], ['Qh', 'Jh', 'Th', '2d', '3c'], 1, 1000);
    for (const key of ALL_RANK_KEYS) {
      expect(equity).toHaveProperty(key);
    }
  });
});

describe('Win Equity — Pre-flop', () => {
  test('pocket aces vs 1 opponent: total equity > 0.75', () => {
    const equity = calculateWinEquity(['Ah', 'Ad'], [], 1, 5000);
    const total = sumProbs(equity);
    // AA is ~85% favorite heads-up
    expect(total).toBeGreaterThan(0.75);
  });

  test('pocket aces vs 1 opponent: HIGH_CARD equity = 0', () => {
    const equity = calculateWinEquity(['Ah', 'Ad'], [], 1, 5000);
    // AA always makes at least a pair
    expect(equity.HIGH_CARD).toBe(0);
  });

  test('win equity sum < 1.0 (cannot win 100%)', () => {
    const equity = calculateWinEquity(['7h', '2d'], [], 1, 5000);
    const total = sumProbs(equity);
    expect(total).toBeLessThan(1);
    expect(total).toBeGreaterThan(0);
  });

  test('more opponents = lower total equity', () => {
    const equity1 = calculateWinEquity(['Ah', 'Kh'], [], 1, 5000);
    const equity5 = calculateWinEquity(['Ah', 'Kh'], [], 5, 5000);
    const total1 = sumProbs(equity1);
    const total5 = sumProbs(equity5);
    // Harder to beat 5 opponents than 1
    expect(total1).toBeGreaterThan(total5);
  });

  test('all values between 0 and 1', () => {
    const equity = calculateWinEquity(['Ts', 'Jd'], [], 3, 3000);
    for (const val of Object.values(equity)) {
      expect(val).toBeGreaterThanOrEqual(0);
      expect(val).toBeLessThanOrEqual(1);
    }
  });
});

describe('Win Equity — Turn/Flop', () => {
  test('turn: probabilities are reasonable', () => {
    const equity = calculateWinEquity(['Ah', 'Kh'], ['Qh', 'Jh', '2d', '3c'], 1, 3000);
    const total = sumProbs(equity);
    expect(total).toBeGreaterThan(0);
    expect(total).toBeLessThan(1);
  });

  test('flop: probabilities are reasonable', () => {
    const equity = calculateWinEquity(['Ah', 'Ad'], ['2c', '5d', '7s'], 2, 3000);
    const total = sumProbs(equity);
    expect(total).toBeGreaterThan(0);
    expect(total).toBeLessThan(1);
  });
});

describe('Win Equity — Edge cases', () => {
  test('0 opponents falls back to formation probability', () => {
    const equity = calculateWinEquity(['Ah', 'Ad'], ['2c', '5d', '7s', '9h', 'Jc'], 0);
    // Should return formation probability (100% PAIR)
    expect(equity.PAIR).toBe(1);
    expect(sumProbs(equity)).toBeCloseTo(1, 5);
  });

  test('ties count as half wins', () => {
    // Board is AAAKK — everyone plays the board. With 1 opponent, equity ≈ 0.5
    const equity = calculateWinEquity(['2h', '3d'], ['Ah', 'Ad', 'Ac', 'Kh', 'Kd'], 1, 5000);
    const total = sumProbs(equity);
    // Both players play the board (full house AAAKK), so ties → ~0.5
    expect(total).toBeGreaterThan(0.4);
    expect(total).toBeLessThan(0.6);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Schema validation
// ═══════════════════════════════════════════════════════════════════════════════

describe('HandProbabilities schema', () => {
  test('valid hand probability map parses', () => {
    const { HandProbabilities } = require('@pokerathome/schema');
    const probs = {
      HIGH_CARD: 0.5,
      PAIR: 0.3,
      TWO_PAIR: 0.1,
      THREE_OF_A_KIND: 0.05,
      STRAIGHT: 0.02,
      FLUSH: 0.015,
      FULL_HOUSE: 0.01,
      FOUR_OF_A_KIND: 0.004,
      STRAIGHT_FLUSH: 0.0009,
      ROYAL_FLUSH: 0.0001,
    };
    const result = HandProbabilities.safeParse(probs);
    expect(result.success).toBe(true);
  });

  test('rejects values above 1', () => {
    const { HandProbabilities } = require('@pokerathome/schema');
    const result = HandProbabilities.safeParse({ HIGH_CARD: 1.5 });
    expect(result.success).toBe(false);
  });

  test('rejects negative values', () => {
    const { HandProbabilities } = require('@pokerathome/schema');
    const result = HandProbabilities.safeParse({ PAIR: -0.1 });
    expect(result.success).toBe(false);
  });
});
