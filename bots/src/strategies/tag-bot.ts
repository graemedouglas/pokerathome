/**
 * TAG (Tight-Aggressive) Bot strategy — a somewhat competitive bot.
 *
 * Pre-flop: Only plays strong starting hands, raises with premiums.
 * Post-flop: Bets/raises strong hands, calls medium, folds weak to aggression.
 *
 * Not perfect, but plays a sound enough game to challenge casual players
 * and dominate the Calling Station.
 */

import type { GameState, ActionRequest, ActionType, ActionOption } from '@pokerathome/schema'
import type { BotStrategy } from './index.js'
import { preflopTier, postflopStrength } from '../hand-strength.js'

export class TagBotStrategy implements BotStrategy {
  readonly name = 'TAG Bot'

  decide(
    gameState: GameState,
    actionRequest: ActionRequest,
    myPlayerId: string
  ): { type: ActionType; amount?: number } {
    const me = gameState.players.find((p) => p.id === myPlayerId)
    if (!me?.holeCards || me.holeCards.length !== 2) {
      return this.fallback(actionRequest)
    }

    const holeCards = me.holeCards as [string, string]
    const isPreflop = gameState.stage === 'PRE_FLOP'

    if (isPreflop) {
      return this.decidePreflopAction(holeCards, gameState, actionRequest)
    }

    return this.decidePostflopAction(holeCards, gameState, actionRequest)
  }

  private decidePreflopAction(
    holeCards: [string, string],
    gameState: GameState,
    actionRequest: ActionRequest
  ): { type: ActionType; amount?: number } {
    const tier = preflopTier(holeCards[0], holeCards[1])
    const actions = actionRequest.availableActions
    const bb = gameState.bigBlindAmount

    switch (tier) {
      case 'premium': {
        // Raise 3x BB (or raise the min if 3x isn't enough)
        const raiseAmount = this.findRaiseAmount(actions, bb * 3)
        if (raiseAmount !== null) return raiseAmount
        const callAction = actions.find((a) => a.type === 'CALL')
        if (callAction) return { type: 'CALL' }
        return this.fallback(actionRequest)
      }

      case 'strong': {
        // Raise 2.5x BB
        const raiseAmount = this.findRaiseAmount(actions, Math.round(bb * 2.5))
        if (raiseAmount !== null) return raiseAmount
        const callAction = actions.find((a) => a.type === 'CALL')
        if (callAction) return { type: 'CALL' }
        return this.fallback(actionRequest)
      }

      case 'playable': {
        // Call if cheap, fold to large raises
        const callAction = actions.find((a) => a.type === 'CALL')
        if (callAction && callAction.amount !== undefined && callAction.amount <= bb * 4) {
          return { type: 'CALL' }
        }
        if (actions.find((a) => a.type === 'CHECK')) {
          return { type: 'CHECK' }
        }
        return { type: 'FOLD' }
      }

      case 'weak':
      default: {
        if (actions.find((a) => a.type === 'CHECK')) {
          return { type: 'CHECK' }
        }
        return { type: 'FOLD' }
      }
    }
  }

  private decidePostflopAction(
    holeCards: [string, string],
    gameState: GameState,
    actionRequest: ActionRequest
  ): { type: ActionType; amount?: number } {
    const strength = postflopStrength(holeCards, gameState.communityCards)
    const actions = actionRequest.availableActions
    const pot = gameState.pot

    switch (strength) {
      case 'monster': {
        // Bet/raise ~75% pot
        const betAmount = this.findBetAmount(actions, Math.round(pot * 0.75))
        if (betAmount !== null) return betAmount
        const raiseAmount = this.findRaiseAmount(actions, Math.round(pot * 0.75))
        if (raiseAmount !== null) return raiseAmount
        if (actions.find((a) => a.type === 'CALL')) return { type: 'CALL' }
        return this.fallback(actionRequest)
      }

      case 'strong': {
        // Bet/raise ~60% pot
        const betAmount = this.findBetAmount(actions, Math.round(pot * 0.6))
        if (betAmount !== null) return betAmount
        const raiseAmount = this.findRaiseAmount(actions, Math.round(pot * 0.6))
        if (raiseAmount !== null) return raiseAmount
        if (actions.find((a) => a.type === 'CALL')) return { type: 'CALL' }
        return this.fallback(actionRequest)
      }

      case 'medium': {
        // Bet ~40% pot if we can, otherwise call
        const betAmount = this.findBetAmount(actions, Math.round(pot * 0.4))
        if (betAmount !== null) return betAmount
        if (actions.find((a) => a.type === 'CALL')) return { type: 'CALL' }
        if (actions.find((a) => a.type === 'CHECK')) return { type: 'CHECK' }
        return { type: 'FOLD' }
      }

      case 'weak':
      default: {
        if (actions.find((a) => a.type === 'CHECK')) return { type: 'CHECK' }
        return { type: 'FOLD' }
      }
    }
  }

  /**
   * Find a BET action with an amount clamped to the available range.
   */
  private findBetAmount(
    actions: ActionOption[],
    targetAmount: number
  ): { type: ActionType; amount: number } | null {
    const bet = actions.find((a) => a.type === 'BET')
    if (!bet || bet.min === undefined || bet.max === undefined) return null
    const amount = Math.max(bet.min, Math.min(targetAmount, bet.max))
    return { type: 'BET', amount }
  }

  /**
   * Find a RAISE action with an amount clamped to the available range.
   */
  private findRaiseAmount(
    actions: ActionOption[],
    targetAmount: number
  ): { type: ActionType; amount: number } | null {
    const raise = actions.find((a) => a.type === 'RAISE')
    if (!raise || raise.min === undefined || raise.max === undefined) return null
    const amount = Math.max(raise.min, Math.min(targetAmount, raise.max))
    return { type: 'RAISE', amount }
  }

  /**
   * Fallback: check if possible, otherwise fold.
   */
  private fallback(
    actionRequest: ActionRequest
  ): { type: ActionType; amount?: number } {
    if (actionRequest.availableActions.find((a) => a.type === 'CHECK')) {
      return { type: 'CHECK' }
    }
    return { type: 'FOLD' }
  }
}
