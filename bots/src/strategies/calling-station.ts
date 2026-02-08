/**
 * Calling Station strategy — the simplest possible bot.
 *
 * - CHECK when it's free
 * - CALL any bet
 * - FOLD only when forced (can't afford to call and no check available)
 * - Never bets, never raises
 *
 * Trivially exploitable: just value-bet relentlessly.
 */

import type { GameState, ActionRequest, ActionType } from '@pokerathome/schema'
import type { BotStrategy } from './index.js'

export class CallingStationStrategy implements BotStrategy {
  readonly name = 'Calling Station'

  decide(
    _gameState: GameState,
    actionRequest: ActionRequest,
    _myPlayerId: string
  ): { type: ActionType; amount?: number } {
    const actions = actionRequest.availableActions
    const types = actions.map((a) => a.type)

    if (types.includes('CHECK')) {
      return { type: 'CHECK' }
    }

    if (types.includes('CALL')) {
      return { type: 'CALL' }
    }

    return { type: 'FOLD' }
  }
}
