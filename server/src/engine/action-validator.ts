/**
 * Compute available actions for the active player given the current engine state.
 */

import type { ActionOption } from '@pokerathome/schema';
import type { EnginePlayer, EngineState } from './game.js';

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
    const min = Math.min(state.bigBlindAmount, player.stack);
    const max = player.stack;
    if (min <= max) {
      actions.push({ type: 'BET', min, max });
    }
  }

  // RAISE: when there's a bet to raise above
  if (state.currentBet > 0 && player.stack > callAmount) {
    const minRaiseTotal = callAmount + state.lastRaiseSize;
    const maxRaiseTotal = player.stack;

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

/**
 * Validate that a submitted action is legal.
 * Returns an error message if invalid, or null if valid.
 */
export function validateAction(
  state: EngineState,
  playerId: string,
  actionType: string,
  actionAmount?: number
): string | null {
  const available = getAvailableActions(state, playerId);
  const option = available.find((a) => a.type === actionType);

  if (!option) {
    return `Action ${actionType} is not available. Available: ${available.map((a) => a.type).join(', ')}`;
  }

  if (actionType === 'BET' || actionType === 'RAISE') {
    if (actionAmount === undefined) {
      return `${actionType} requires an amount`;
    }
    if (option.min !== undefined && actionAmount < option.min) {
      return `${actionType} amount ${actionAmount} is below minimum ${option.min}`;
    }
    if (option.max !== undefined && actionAmount > option.max) {
      return `${actionType} amount ${actionAmount} is above maximum ${option.max}`;
    }
  }

  return null;
}
