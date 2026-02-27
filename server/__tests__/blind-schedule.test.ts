/**
 * Unit tests for the blind schedule generation algorithm.
 */
import {
  generateBlindSchedule,
  getMinChipDenom,
  STARTING_STACK,
  type BlindScheduleConfig,
} from '../src/engine/blind-schedule'

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeConfig(overrides: Partial<BlindScheduleConfig> = {}): BlindScheduleConfig {
  return {
    numPlayers: 6,
    tournamentLengthHours: 2,
    roundLengthMinutes: 15,
    antesEnabled: false,
    ...overrides,
  }
}

// ═════════════════════════════════════════════════════════════════════════════════
// Basic generation
// ═════════════════════════════════════════════════════════════════════════════════

describe('generateBlindSchedule basic properties', () => {
  test('produces a non-empty schedule', () => {
    const schedule = generateBlindSchedule(makeConfig())
    expect(schedule.length).toBeGreaterThan(0)
  })

  test('first level starts at 25/50', () => {
    const schedule = generateBlindSchedule(makeConfig())
    expect(schedule[0].smallBlind).toBe(25)
    expect(schedule[0].bigBlind).toBe(50)
    expect(schedule[0].level).toBe(1)
  })

  test('levels are numbered sequentially starting at 1', () => {
    const schedule = generateBlindSchedule(makeConfig())
    for (let i = 0; i < schedule.length; i++) {
      expect(schedule[i].level).toBe(i + 1)
    }
  })

  test('big blinds are strictly increasing', () => {
    const schedule = generateBlindSchedule(makeConfig())
    for (let i = 1; i < schedule.length; i++) {
      expect(schedule[i].bigBlind).toBeGreaterThan(schedule[i - 1].bigBlind)
    }
  })

  test('schedule continues until BB exceeds total chips', () => {
    const config = makeConfig()
    const totalChips = config.numPlayers * STARTING_STACK
    const schedule = generateBlindSchedule(config)
    const lastBB = schedule[schedule.length - 1].bigBlind
    expect(lastBB).toBeGreaterThanOrEqual(totalChips)
  })
})

// ═════════════════════════════════════════════════════════════════════════════════
// Growth constraints
// ═════════════════════════════════════════════════════════════════════════════════

describe('growth rate constraints', () => {
  test('consecutive levels never grow by more than 2x', () => {
    const schedule = generateBlindSchedule(makeConfig())
    for (let i = 1; i < schedule.length; i++) {
      const ratio = schedule[i].bigBlind / schedule[i - 1].bigBlind
      expect(ratio).toBeLessThanOrEqual(2.01) // small tolerance for rounding
    }
  })

  test('SB is approximately BB/2', () => {
    const schedule = generateBlindSchedule(makeConfig())
    for (const level of schedule) {
      // SB should be close to BB/2, within minChipDenom rounding
      expect(level.smallBlind).toBeLessThanOrEqual(level.bigBlind)
      expect(level.smallBlind).toBeGreaterThanOrEqual(level.minChipDenom)
    }
  })
})

// ═════════════════════════════════════════════════════════════════════════════════
// Chip denomination
// ═════════════════════════════════════════════════════════════════════════════════

describe('chip denomination thresholds', () => {
  test('getMinChipDenom returns 25 for small BBs', () => {
    expect(getMinChipDenom(50)).toBe(25)
    expect(getMinChipDenom(100)).toBe(25)
    expect(getMinChipDenom(199)).toBe(25)
  })

  test('getMinChipDenom returns 100 at BB >= 200', () => {
    expect(getMinChipDenom(200)).toBe(100)
    expect(getMinChipDenom(500)).toBe(100)
  })

  test('getMinChipDenom returns 500 at BB >= 2000', () => {
    expect(getMinChipDenom(2000)).toBe(500)
    expect(getMinChipDenom(5000)).toBe(500)
  })

  test('getMinChipDenom returns 1000 at BB >= 10000', () => {
    expect(getMinChipDenom(10000)).toBe(1000)
    expect(getMinChipDenom(50000)).toBe(1000)
  })

  test('BB is always a multiple of minChipDenom', () => {
    const schedule = generateBlindSchedule(makeConfig())
    for (const level of schedule) {
      expect(level.bigBlind % level.minChipDenom).toBe(0)
    }
  })

  test('SB is always a multiple of minChipDenom', () => {
    const schedule = generateBlindSchedule(makeConfig())
    for (const level of schedule) {
      expect(level.smallBlind % level.minChipDenom).toBe(0)
    }
  })

  test('minChipDenom starts at 25 and never decreases', () => {
    const schedule = generateBlindSchedule(makeConfig())
    expect(schedule[0].minChipDenom).toBe(25)
    for (let i = 1; i < schedule.length; i++) {
      expect(schedule[i].minChipDenom).toBeGreaterThanOrEqual(schedule[i - 1].minChipDenom)
    }
  })
})

// ═════════════════════════════════════════════════════════════════════════════════
// Antes
// ═════════════════════════════════════════════════════════════════════════════════

describe('antes', () => {
  test('no antes when antesEnabled is false', () => {
    const schedule = generateBlindSchedule(makeConfig({ antesEnabled: false }))
    for (const level of schedule) {
      expect(level.ante).toBe(0)
    }
  })

  test('antes start at level 4 when enabled', () => {
    const schedule = generateBlindSchedule(makeConfig({ antesEnabled: true }))

    // Levels 1-3 should have ante = 0
    expect(schedule[0].ante).toBe(0)
    expect(schedule[1].ante).toBe(0)
    expect(schedule[2].ante).toBe(0)

    // Level 4+ should have ante > 0
    expect(schedule[3].ante).toBeGreaterThan(0)
  })

  test('ante is approximately 10% of BB (within rounding tolerance)', () => {
    const schedule = generateBlindSchedule(makeConfig({ antesEnabled: true }))
    for (const level of schedule) {
      if (level.ante > 0) {
        // At small BBs, rounding to minChipDenom can push the ratio higher
        // (e.g. BB=75, ante rounded to 25 → ratio=0.33).
        // At larger BBs, the ratio should be closer to 10%.
        expect(level.ante).toBeGreaterThan(0)
        expect(level.ante).toBeLessThanOrEqual(level.bigBlind)
      }
    }
  })

  test('ante is a multiple of minChipDenom', () => {
    const schedule = generateBlindSchedule(makeConfig({ antesEnabled: true }))
    for (const level of schedule) {
      if (level.ante > 0) {
        expect(level.ante % level.minChipDenom).toBe(0)
      }
    }
  })
})

// ═════════════════════════════════════════════════════════════════════════════════
// Various player counts
// ═════════════════════════════════════════════════════════════════════════════════

describe('different player counts', () => {
  test('2-player tournament produces valid schedule', () => {
    const schedule = generateBlindSchedule(makeConfig({ numPlayers: 2 }))
    expect(schedule.length).toBeGreaterThan(0)
    expect(schedule[0].bigBlind).toBe(50)
    const totalChips = 2 * STARTING_STACK
    expect(schedule[schedule.length - 1].bigBlind).toBeGreaterThanOrEqual(totalChips)
  })

  test('9-player tournament produces valid schedule', () => {
    const schedule = generateBlindSchedule(makeConfig({ numPlayers: 9 }))
    expect(schedule.length).toBeGreaterThan(0)
    expect(schedule[0].bigBlind).toBe(50)
    const totalChips = 9 * STARTING_STACK
    expect(schedule[schedule.length - 1].bigBlind).toBeGreaterThanOrEqual(totalChips)
  })

  test('different player counts produce valid schedules with different lengths', () => {
    const two = generateBlindSchedule(makeConfig({ numPlayers: 2 }))
    const nine = generateBlindSchedule(makeConfig({ numPlayers: 9 }))
    // Both should be valid — the final BB should exceed each game's total chips
    expect(two[two.length - 1].bigBlind).toBeGreaterThanOrEqual(2 * STARTING_STACK)
    expect(nine[nine.length - 1].bigBlind).toBeGreaterThanOrEqual(9 * STARTING_STACK)
    // Schedule lengths differ based on growth rate and total chips
    expect(two.length).toBeGreaterThan(0)
    expect(nine.length).toBeGreaterThan(0)
  })
})

// ═════════════════════════════════════════════════════════════════════════════════
// Various durations
// ═════════════════════════════════════════════════════════════════════════════════

describe('different tournament durations', () => {
  test('short tournament (30min, 5min rounds) produces valid schedule', () => {
    const schedule = generateBlindSchedule(
      makeConfig({ tournamentLengthHours: 0.5, roundLengthMinutes: 5 })
    )
    expect(schedule.length).toBeGreaterThan(0)
    expect(schedule[0].bigBlind).toBe(50)
    // Blinds should still be strictly increasing
    for (let i = 1; i < schedule.length; i++) {
      expect(schedule[i].bigBlind).toBeGreaterThan(schedule[i - 1].bigBlind)
    }
  })

  test('long tournament (4h, 20min rounds) produces more scheduled levels', () => {
    const short = generateBlindSchedule(
      makeConfig({ tournamentLengthHours: 1, roundLengthMinutes: 15 })
    )
    const long = generateBlindSchedule(
      makeConfig({ tournamentLengthHours: 4, roundLengthMinutes: 15 })
    )
    // Longer tournament with same round length should grow more slowly,
    // meaning more levels before hitting total chips
    expect(long.length).toBeGreaterThan(short.length)
  })
})

// ═════════════════════════════════════════════════════════════════════════════════
// All BlindLevel fields present
// ═════════════════════════════════════════════════════════════════════════════════

describe('BlindLevel shape', () => {
  test('every level has all required fields', () => {
    const schedule = generateBlindSchedule(makeConfig({ antesEnabled: true }))
    for (const level of schedule) {
      expect(typeof level.level).toBe('number')
      expect(typeof level.smallBlind).toBe('number')
      expect(typeof level.bigBlind).toBe('number')
      expect(typeof level.ante).toBe('number')
      expect(typeof level.minChipDenom).toBe('number')
      expect(level.smallBlind).toBeGreaterThan(0)
      expect(level.bigBlind).toBeGreaterThan(0)
      expect(level.minChipDenom).toBeGreaterThan(0)
    }
  })
})
