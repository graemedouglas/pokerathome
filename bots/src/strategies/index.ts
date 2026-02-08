import type { GameState, ActionRequest, ActionType } from '@pokerathome/schema'

export interface BotStrategy {
  readonly name: string
  decide(
    gameState: GameState,
    actionRequest: ActionRequest,
    myPlayerId: string
  ): { type: ActionType; amount?: number }
}

import { CallingStationStrategy } from './calling-station.js'
import { TagBotStrategy } from './tag-bot.js'

export const strategyRegistry: Record<string, () => BotStrategy> = {
  'calling-station': () => new CallingStationStrategy(),
  'tag-bot': () => new TagBotStrategy(),
}

export { CallingStationStrategy } from './calling-station.js'
export { TagBotStrategy } from './tag-bot.js'
