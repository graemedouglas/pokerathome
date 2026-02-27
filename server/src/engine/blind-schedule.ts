/**
 * Blind schedule generation for sit-and-go tournaments.
 *
 * Pure function — no I/O, no side effects. Generates an escalating blind
 * schedule using exponential growth with nice-number rounding.
 */

import type { BlindLevel } from '@pokerathome/schema';

// ═══════════════════════════════════════════════════════════════════════════════
// Configuration
// ═══════════════════════════════════════════════════════════════════════════════

export const STARTING_STACK = 5000;
const STARTING_BB = 50;

/** After tournament_length, total chips / BB should be roughly this many. */
const TARGET_BB_REMAINING = 20;

/** Antes kick in at this level (1-indexed). */
const ANTE_START_LEVEL = 4;

/** Ante as a fraction of BB. */
const ANTE_FRACTION = 0.1;

/** Cap growth between consecutive levels to prevent jarring jumps. */
const MAX_GROWTH_RATIO = 2.0;

/** Chip-up thresholds: when BB reaches the threshold, min chip denom changes. */
const CHIP_UP_THRESHOLDS: Array<{ bbThreshold: number; newDenom: number }> = [
  { bbThreshold: 200, newDenom: 100 },
  { bbThreshold: 2000, newDenom: 500 },
  { bbThreshold: 10000, newDenom: 1000 },
];

const STARTING_MIN_CHIP = 25;

// ═══════════════════════════════════════════════════════════════════════════════
// Public API
// ═══════════════════════════════════════════════════════════════════════════════

export interface BlindScheduleConfig {
  numPlayers: number;
  tournamentLengthHours: number;
  roundLengthMinutes: number;
  antesEnabled: boolean;
}

/**
 * Generate a complete blind schedule for a sit-and-go tournament.
 *
 * The schedule starts at 25/50 and grows exponentially so that after
 * `tournamentLengthHours`, the total chips in play represent ~20 big blinds.
 * Levels continue past the target until BB exceeds total chips, ensuring the
 * tournament must eventually end.
 */
export function generateBlindSchedule(config: BlindScheduleConfig): BlindLevel[] {
  const { numPlayers, tournamentLengthHours, roundLengthMinutes, antesEnabled } = config;

  const totalChips = numPlayers * STARTING_STACK;
  const numRounds = Math.max(1, Math.floor((tournamentLengthHours * 60) / roundLengthMinutes));
  const targetFinalBB = Math.round(totalChips / TARGET_BB_REMAINING);

  // Growth factor per level: BB_n = STARTING_BB * growthRate^n
  // At level numRounds, BB ≈ targetFinalBB
  const growthRate = Math.pow(targetFinalBB / STARTING_BB, 1 / numRounds);

  const levels: BlindLevel[] = [];
  let levelNumber = 1;
  let prevBB = 0;
  let n = 0;

  // Generate until BB exceeds total chips (ensures game must end)
  while (prevBB < totalChips) {
    const rawBB = STARTING_BB * Math.pow(growthRate, n);
    n++;

    const minChipDenom = getMinChipDenom(rawBB);
    let bb = roundToNiceNumber(rawBB, minChipDenom);

    // Ensure strictly increasing
    if (bb <= prevBB) {
      bb = prevBB + minChipDenom;
      bb = roundToNiceNumber(bb + minChipDenom * 0.5, minChipDenom);
      if (bb <= prevBB) {
        bb = prevBB + minChipDenom;
      }
    }

    // Cap growth ratio between consecutive levels
    if (prevBB > 0 && bb > prevBB * MAX_GROWTH_RATIO) {
      bb = roundToNiceNumber(prevBB * MAX_GROWTH_RATIO, minChipDenom);
      if (bb <= prevBB) bb = prevBB + minChipDenom;
    }

    const finalMinChipDenom = getMinChipDenom(bb);
    const sb = calculateSmallBlind(bb, finalMinChipDenom);
    const ante = calculateAnte(bb, finalMinChipDenom, levelNumber, antesEnabled);

    levels.push({
      level: levelNumber,
      smallBlind: sb,
      bigBlind: bb,
      ante,
      minChipDenom: finalMinChipDenom,
    });

    prevBB = bb;
    levelNumber++;
  }

  return levels;
}

// ═══════════════════════════════════════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Round a raw BB value to a "nice" tournament number, respecting the
 * current minimum chip denomination.
 *
 * Uses tier-based step sizes that match professional tournament conventions:
 *   BB < 200:     multiples of 25
 *   BB 200-600:   multiples of 50
 *   BB 600-1000:  multiples of 100
 *   BB 1000-3000: multiples of 250
 *   BB 3000-5000: multiples of 500
 *   BB 5000-20k:  multiples of 1000
 *   BB 20k+:      multiples of 5000
 */
function roundToNiceNumber(raw: number, minChipDenom: number): number {
  let step: number;

  if (raw < 200) {
    step = 25;
  } else if (raw < 600) {
    step = 50;
  } else if (raw < 1000) {
    step = 100;
  } else if (raw < 3000) {
    step = 250;
  } else if (raw < 5000) {
    step = 500;
  } else if (raw < 20000) {
    step = 1000;
  } else {
    step = 5000;
  }

  // Step must be at least minChipDenom and a multiple of it
  step = Math.max(step, minChipDenom);
  if (step % minChipDenom !== 0) {
    step = Math.ceil(step / minChipDenom) * minChipDenom;
  }

  const rounded = Math.round(raw / step) * step;
  return Math.max(rounded, minChipDenom * 2);
}

/** Determine the minimum chip denomination for a given BB. */
export function getMinChipDenom(bb: number): number {
  let denom = STARTING_MIN_CHIP;
  for (const { bbThreshold, newDenom } of CHIP_UP_THRESHOLDS) {
    if (bb >= bbThreshold) {
      denom = newDenom;
    }
  }
  return denom;
}

/** SB = BB / 2, rounded to the nearest minChipDenom. */
function calculateSmallBlind(bb: number, minChipDenom: number): number {
  const raw = bb / 2;
  const rounded = Math.round(raw / minChipDenom) * minChipDenom;
  return Math.max(rounded, minChipDenom);
}

/** Ante = ~10% of BB, rounded to the nearest minChipDenom. */
function calculateAnte(
  bb: number,
  minChipDenom: number,
  level: number,
  antesEnabled: boolean
): number {
  if (!antesEnabled) return 0;
  if (level < ANTE_START_LEVEL) return 0;

  const raw = bb * ANTE_FRACTION;
  const rounded = Math.round(raw / minChipDenom) * minChipDenom;
  return Math.max(rounded, minChipDenom);
}
