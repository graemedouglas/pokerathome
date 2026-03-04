import { getRunoutAnimationDelay } from '../src/engine/game.js';
import {
  RUNOUT_PAUSE_FLOP,
  RUNOUT_PAUSE_TURN,
  RUNOUT_PAUSE_RIVER,
  RUNOUT_PAUSE_SHOWDOWN,
} from '@pokerathome/schema';
import type { Event } from '@pokerathome/schema';

const UUID_A = '00000000-0000-0000-0000-000000000001';
const UUID_B = '00000000-0000-0000-0000-000000000002';

/** Helper to build a minimal PLAYER_ACTION event. */
function action(type: string, playerId = UUID_A, amount?: number): Event {
  return { type: 'PLAYER_ACTION', playerId, action: { type, ...(amount != null ? { amount } : {}) } } as Event;
}

/** Helper to build a FLOP event. */
function flop(): Event {
  return { type: 'FLOP', cards: ['Ah', 'Kd', 'Qc'] } as Event;
}

/** Helper to build a TURN event. */
function turn(): Event {
  return { type: 'TURN', card: '7s' } as Event;
}

/** Helper to build a RIVER event. */
function river(): Event {
  return { type: 'RIVER', card: '2h' } as Event;
}

/** Helper to build a SHOWDOWN event. */
function showdown(): Event {
  return {
    type: 'SHOWDOWN',
    results: [{
      playerId: UUID_A,
      holeCards: ['Ah', 'Kd'],
      handRank: 1,
      handDescription: 'Pair',
    }],
  } as Event;
}

/** Helper to build a HAND_END event. */
function handEnd(): Event {
  return { type: 'HAND_END', winners: [{ playerId: UUID_A, amount: 100 }] } as Event;
}

describe('getRunoutAnimationDelay', () => {
  test('full runout (all-in preflop): sums all four pause constants', () => {
    const events: Event[] = [
      { type: 'HAND_START', handNumber: 1, dealerSeatIndex: 0 } as Event,
      { type: 'BLINDS_POSTED', smallBlind: { playerId: UUID_A, amount: 5 }, bigBlind: { playerId: UUID_B, amount: 10 } } as Event,
      { type: 'DEAL' } as Event,
      action('ALL_IN', UUID_A, 990),
      action('ALL_IN', UUID_B, 990),
      flop(),
      turn(),
      river(),
      showdown(),
      handEnd(),
    ];

    expect(getRunoutAnimationDelay(events)).toBe(
      RUNOUT_PAUSE_FLOP + RUNOUT_PAUSE_TURN + RUNOUT_PAUSE_RIVER + RUNOUT_PAUSE_SHOWDOWN
    );
  });

  test('partial runout (all-in on flop): only TURN + RIVER + SHOWDOWN pauses', () => {
    const events: Event[] = [
      { type: 'DEAL' } as Event,
      action('CALL', UUID_A),
      action('CHECK', UUID_B),
      flop(),
      action('ALL_IN', UUID_A, 500),
      action('CALL', UUID_B, 500),
      turn(),
      river(),
      showdown(),
      handEnd(),
    ];

    expect(getRunoutAnimationDelay(events)).toBe(
      RUNOUT_PAUSE_TURN + RUNOUT_PAUSE_RIVER + RUNOUT_PAUSE_SHOWDOWN
    );
  });

  test('partial runout (all-in on turn): only RIVER + SHOWDOWN pauses', () => {
    const events: Event[] = [
      { type: 'DEAL' } as Event,
      action('CALL', UUID_A),
      action('CHECK', UUID_B),
      flop(),
      action('CHECK', UUID_A),
      action('CHECK', UUID_B),
      turn(),
      action('ALL_IN', UUID_A, 500),
      action('CALL', UUID_B, 500),
      river(),
      showdown(),
      handEnd(),
    ];

    expect(getRunoutAnimationDelay(events)).toBe(
      RUNOUT_PAUSE_RIVER + RUNOUT_PAUSE_SHOWDOWN
    );
  });

  test('no runout (normal hand with actions on every street): returns 0', () => {
    const events: Event[] = [
      { type: 'DEAL' } as Event,
      action('CALL', UUID_A),
      action('CHECK', UUID_B),
      flop(),
      action('BET', UUID_A, 20),
      action('CALL', UUID_B, 20),
      turn(),
      action('BET', UUID_A, 40),
      action('CALL', UUID_B, 40),
      river(),
      action('CHECK', UUID_A),
      action('CHECK', UUID_B),
      showdown(),
      handEnd(),
    ];

    expect(getRunoutAnimationDelay(events)).toBe(0);
  });

  test('no runout (fold before showdown): returns 0', () => {
    const events: Event[] = [
      { type: 'DEAL' } as Event,
      action('RAISE', UUID_A, 30),
      action('FOLD', UUID_B),
      handEnd(),
    ];

    expect(getRunoutAnimationDelay(events)).toBe(0);
  });

  test('no player actions at all: returns 0', () => {
    expect(getRunoutAnimationDelay([])).toBe(0);
    expect(getRunoutAnimationDelay([
      { type: 'HAND_START', handNumber: 1, dealerSeatIndex: 0 } as Event,
    ])).toBe(0);
  });
});
