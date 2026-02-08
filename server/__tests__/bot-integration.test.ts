/**
 * Integration tests: bot strategies running against the game engine.
 * Uses rigged decks to verify deterministic bot behavior.
 */

import {
  createInitialState,
  addPlayer,
  setPlayerReady,
  startHand,
  processAction,
  buildGameStatePayload,
  type EngineState,
} from '../src/engine/game'
import { createDeck } from '../src/engine/deck'
import { getAvailableActions } from '../src/engine/action-validator'
import { CallingStationStrategy, TagBotStrategy } from '@pokerathome/bots'
import type { BotStrategy } from '@pokerathome/bots'

// ═══════════════════════════════════════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════════════════════════════════════

function createHeadsUpGame(): EngineState {
  let state = createInitialState({
    gameId: 'integration-test',
    gameName: 'Integration',
    gameType: 'cash',
    smallBlindAmount: 5,
    bigBlindAmount: 10,
    maxPlayers: 6,
    startingStack: 1000,
  })
  const p1 = addPlayer(state, 'bot-1', 'Bot A')
  state = p1.state
  const p2 = addPlayer(state, 'bot-2', 'Bot B')
  state = p2.state
  state = setPlayerReady(state, 'bot-1')
  state = setPlayerReady(state, 'bot-2')
  return state
}

function makePaddedDeck(knownCards: string[]): string[] {
  const remaining = createDeck().filter(c => !knownCards.includes(c))
  return [...knownCards, ...remaining]
}

/**
 * Play a hand to completion using two bot strategies.
 * Returns the final engine state.
 */
function playHandToCompletion(
  state: EngineState,
  strategies: Record<string, BotStrategy>,
  deck?: string[]
): EngineState {
  const transitions = startHand(state, deck)
  let current = transitions[transitions.length - 1].state

  let safety = 0
  while (current.handInProgress && current.activePlayerId && safety < 100) {
    safety++
    const playerId = current.activePlayerId
    const strategy = strategies[playerId]
    if (!strategy) throw new Error(`No strategy for ${playerId}`)

    const payload = buildGameStatePayload(current, { type: 'DEAL' }, playerId, 30000)
    if (!payload.actionRequest) break

    const decision = strategy.decide(payload.gameState, payload.actionRequest, playerId)
    const actionTransitions = processAction(current, playerId, decision.type, decision.amount)
    current = actionTransitions[actionTransitions.length - 1].state
  }

  return current
}

// ═══════════════════════════════════════════════════════════════════════════════
// Calling Station integration
// ═══════════════════════════════════════════════════════════════════════════════

describe('Calling Station integration', () => {
  const cs = new CallingStationStrategy()

  test('calling station always calls through a hand', () => {
    const state = createHeadsUpGame()
    const deck = makePaddedDeck([
      'Ah', 'Kh',  // bot-1
      '2c', '3d',  // bot-2
      '4s', '5s', '6s',  // flop
      '7s',  // turn
      '8s',  // river
    ])

    const final = playHandToCompletion(state, {
      'bot-1': cs,
      'bot-2': cs,
    }, deck)

    // Both calling stations should check/call through, hand completes
    expect(final.handInProgress).toBe(false)
  })

  test('calling station never raises', () => {
    const state = createHeadsUpGame()

    const transitions = startHand(state)
    let current = transitions[transitions.length - 1].state

    // Simulate a few rounds manually, verify calling station only checks/calls
    let safety = 0
    while (current.handInProgress && current.activePlayerId && safety < 20) {
      safety++
      const playerId = current.activePlayerId
      const payload = buildGameStatePayload(current, { type: 'DEAL' }, playerId, 30000)
      if (!payload.actionRequest) break

      const decision = cs.decide(payload.gameState, payload.actionRequest, playerId)
      expect(decision.type).not.toBe('BET')
      expect(decision.type).not.toBe('RAISE')
      expect(decision.type).not.toBe('ALL_IN')

      const actionTransitions = processAction(current, playerId, decision.type, decision.amount)
      current = actionTransitions[actionTransitions.length - 1].state
    }
  })
})

// ═══════════════════════════════════════════════════════════════════════════════
// TAG Bot integration
// ═══════════════════════════════════════════════════════════════════════════════

describe('TAG Bot integration', () => {
  const tag = new TagBotStrategy()

  test('TAG bot folds trash hands preflop when facing a raise', () => {
    const state = createHeadsUpGame()
    // Give bot-1 trash: 7h 2c
    const deck = makePaddedDeck([
      '7h', '2c',  // bot-1 — trash
      'As', 'Ks',  // bot-2 — premium
      '4d', '5d', '6d',
      '8d', '9d',
    ])

    const transitions = startHand(state, deck)
    let current = transitions[transitions.length - 1].state

    // Find bot-1's turn; if bot-1 is first to act, they should fold
    if (current.activePlayerId === 'bot-1') {
      const payload = buildGameStatePayload(current, { type: 'DEAL' }, 'bot-1', 30000)
      const decision = tag.decide(payload.gameState, payload.actionRequest!, 'bot-1')
      expect(decision.type).toBe('FOLD')
    }
  })

  test('TAG bot raises premium hands preflop', () => {
    const state = createHeadsUpGame()
    // Give bot-1 pocket aces
    const deck = makePaddedDeck([
      'Ah', 'As',  // bot-1 — premium
      '7c', '2d',  // bot-2 — trash
      '4s', '5s', '6s',
      '8s', '9s',
    ])

    const transitions = startHand(state, deck)
    let current = transitions[transitions.length - 1].state

    if (current.activePlayerId === 'bot-1') {
      const payload = buildGameStatePayload(current, { type: 'DEAL' }, 'bot-1', 30000)
      const decision = tag.decide(payload.gameState, payload.actionRequest!, 'bot-1')
      expect(decision.type).toBe('RAISE')
    }
  })

  test('TAG vs Calling Station completes a full hand', () => {
    const state = createHeadsUpGame()
    const deck = makePaddedDeck([
      'Ah', 'Kh',  // bot-1 (TAG) — strong hand
      '2c', '3d',  // bot-2 (Calling Station) — weak
      'As', 'Ks', 'Qs',  // flop (pairs bot-1)
      'Td',  // turn
      '9d',  // river
    ])

    const final = playHandToCompletion(state, {
      'bot-1': tag,
      'bot-2': new CallingStationStrategy(),
    }, deck)

    expect(final.handInProgress).toBe(false)
    // TAG bot with AK on AKQ board should win against 2c3d
    const bot1 = final.players.find(p => p.id === 'bot-1')!
    const bot2 = final.players.find(p => p.id === 'bot-2')!
    expect(bot1.stack).toBeGreaterThan(bot2.stack)
  })

  test('TAG vs TAG completes multiple hands', () => {
    let state = createHeadsUpGame()

    for (let hand = 0; hand < 3; hand++) {
      const final = playHandToCompletion(state, {
        'bot-1': tag,
        'bot-2': tag,
      })

      expect(final.handInProgress).toBe(false)

      // Check both players still have stacks (game can continue)
      const p1 = final.players.find(p => p.id === 'bot-1')!
      const p2 = final.players.find(p => p.id === 'bot-2')!
      const totalChips = p1.stack + p2.stack
      expect(totalChips).toBe(2000) // Chips are conserved

      // If either player busted, stop
      if (p1.stack === 0 || p2.stack === 0) break
      state = final
    }
  })
})
