/**
 * Compute available actions for the active player given the current engine state.
 */

import type { ActionOption } from '@pokerathome/schema';
import type { EnginePlayer, EngineState } from './game.js';
import { getMinChipDenom } from './blind-schedule.js';

/**
 * Returns the list of ActionOptions available to the given player.
 * Assumes the player IS the active player (caller validates this).
 */
export function getAvailableActions(state: EngineState, playerId: string): ActionOption[] {
  const player = state.players.find((p) => p.id === playerId);
  if (!player || player.folded || player.role !== 'player') return [];

  const actions: ActionOption[] = [];
  const callAmount = state.currentBet - player.bet;
  const canCheck = callAmount === 0;

  // For tournaments, min bet/raise amounts must align to the chip denomination
  const chipDenom = state.gameType === 'tournament'
    ? getCurrentMinChipDenom(state)
    : 1;

  // FOLD is always available (even when checking is free -- dumb but legal)
  actions.push({ type: 'FOLD' });

  if (canCheck) {
    actions.push({ type: 'CHECK' });
  } else if (callAmount > 0 && callAmount <= player.stack) {
    // Player can fully match the current bet
    actions.push({ type: 'CALL', amount: callAmount });
  }

  // BET: only when no bet has been made this round (currentBet === 0)
  // Pre-flop the blinds set currentBet, so BET is not available pre-flop
  if (state.currentBet === 0 && player.stack > 0) {
    let min = Math.min(state.bigBlindAmount, player.stack);
    min = roundUpToChipDenom(min, chipDenom);
    const max = roundDownToChipDenom(player.stack, chipDenom) || player.stack;
    if (min <= max) {
      actions.push({ type: 'BET', min, max });
    }
  }

  // RAISE: when there's a bet to raise above
  if (state.currentBet > 0 && player.stack > callAmount) {
    let minRaiseTotal = callAmount + state.lastRaiseSize;
    minRaiseTotal = roundUpToChipDenom(minRaiseTotal, chipDenom);
    const maxRaiseTotal = roundDownToChipDenom(player.stack, chipDenom) || player.stack;

    if (minRaiseTotal <= maxRaiseTotal) {
      actions.push({ type: 'RAISE', min: minRaiseTotal, max: maxRaiseTotal });
    }
  }

  // ALL_IN: always available when player has chips
  if (player.stack > 0) {
    actions.push({ type: 'ALL_IN', amount: player.stack });
  }

  return actions;
}

/** Get current minimum chip denomination from the blind schedule. */
function getCurrentMinChipDenom(state: EngineState): number {
  if (state.blindSchedule.length > 0 && state.currentBlindLevel < state.blindSchedule.length) {
    return state.blindSchedule[state.currentBlindLevel].minChipDenom;
  }
  return getMinChipDenom(state.bigBlindAmount);
}

function roundUpToChipDenom(value: number, chipDenom: number): number {
  if (chipDenom <= 1) return value;
  return Math.ceil(value / chipDenom) * chipDenom;
}

function roundDownToChipDenom(value: number, chipDenom: number): number {
  if (chipDenom <= 1) return value;
  return Math.floor(value / chipDenom) * chipDenom;
}

export interface ValidationError {
  code: 'INVALID_ACTION' | 'INVALID_AMOUNT';
  message: string;
}

/**
 * Validate that a submitted action is legal.
 * Returns a ValidationError if invalid, or null if valid.
 */
export function validateAction(
  state: EngineState,
  playerId: string,
  actionType: string,
  actionAmount?: number
): ValidationError | null {
  const available = getAvailableActions(state, playerId);
  const option = available.find((a) => a.type === actionType);

  if (!option) {
    return {
      code: 'INVALID_ACTION',
      message: `Action ${actionType} is not available. Available: ${available.map((a) => a.type).join(', ')}`,
    };
  }

  if (actionType === 'BET' || actionType === 'RAISE') {
    if (actionAmount === undefined) {
      return { code: 'INVALID_AMOUNT', message: `${actionType} requires an amount` };
    }
    if (option.min !== undefined && actionAmount < option.min) {
      return { code: 'INVALID_AMOUNT', message: `${actionType} amount ${actionAmount} is below minimum ${option.min}` };
    }
    if (option.max !== undefined && actionAmount > option.max) {
      return { code: 'INVALID_AMOUNT', message: `${actionType} amount ${actionAmount} is above maximum ${option.max}` };
    }
    // Tournament chip denomination enforcement
    if (state.gameType === 'tournament') {
      const chipDenom = getCurrentMinChipDenom(state);
      if (chipDenom > 1 && actionAmount % chipDenom !== 0) {
        return { code: 'INVALID_AMOUNT', message: `${actionType} amount ${actionAmount} must be a multiple of ${chipDenom}` };
      }
    }
  }

  return null;
}
