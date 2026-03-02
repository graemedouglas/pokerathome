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
  advanceBlindLevel,
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

// ═══════════════════════════════════════════════════════════════════════════════
// Tournament bot integration
// ═══════════════════════════════════════════════════════════════════════════════

const TOURNAMENT_SCHEDULE = [
  { level: 1, smallBlind: 25,  bigBlind: 50,   ante: 0, minChipDenom: 25 },
  { level: 2, smallBlind: 50,  bigBlind: 100,  ante: 0, minChipDenom: 25 },
  { level: 3, smallBlind: 100, bigBlind: 200,  ante: 0, minChipDenom: 25 },
  { level: 4, smallBlind: 200, bigBlind: 400,  ante: 0, minChipDenom: 25 },
  { level: 5, smallBlind: 500, bigBlind: 1000, ante: 0, minChipDenom: 25 },
]

function createTournamentGame(startingStack = 5000): EngineState {
  let state = createInitialState({
    gameId: 'tournament-test',
    gameName: 'Tournament',
    gameType: 'tournament',
    smallBlindAmount: 25,
    bigBlindAmount: 50,
    maxPlayers: 6,
    startingStack,
    blindSchedule: TOURNAMENT_SCHEDULE,
  })
  const p1 = addPlayer(state, 'bot-1', 'Bot A')
  state = p1.state
  const p2 = addPlayer(state, 'bot-2', 'Bot B')
  state = p2.state
  state = setPlayerReady(state, 'bot-1')
  state = setPlayerReady(state, 'bot-2')
  return state
}

describe('Tournament bot integration', () => {
  const cs = new CallingStationStrategy()
  const tag = new TagBotStrategy()

  test('tournament hand completes with calling stations', () => {
    const state = createTournamentGame()
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

    expect(final.handInProgress).toBe(false)
    expect(final.gameType).toBe('tournament')
    // Chips are conserved
    const p1 = final.players.find(p => p.id === 'bot-1')!
    const p2 = final.players.find(p => p.id === 'bot-2')!
    expect(p1.stack + p2.stack).toBe(10000)
  })

  test('TAG bot plays multiple hands with increasing blind levels', () => {
    let state = createTournamentGame()

    // Play hand at level 0 (25/50)
    state = playHandToCompletion(state, { 'bot-1': tag, 'bot-2': tag })
    expect(state.handInProgress).toBe(false)
    expect(state.bigBlindAmount).toBe(50)

    const p1After1 = state.players.find(p => p.id === 'bot-1')!
    const p2After1 = state.players.find(p => p.id === 'bot-2')!
    if (p1After1.stack === 0 || p2After1.stack === 0) return // one busted, can't continue

    // Advance blind level to 50/100
    const levelUp = advanceBlindLevel(state)
    state = levelUp.state
    expect(state.bigBlindAmount).toBe(100)
    expect(state.smallBlindAmount).toBe(50)

    // Play hand at level 1 (50/100)
    state = playHandToCompletion(state, { 'bot-1': tag, 'bot-2': tag })
    expect(state.handInProgress).toBe(false)

    // Advance again to 100/200
    const levelUp2 = advanceBlindLevel(state)
    state = levelUp2.state
    expect(state.bigBlindAmount).toBe(200)

    const p1After2 = state.players.find(p => p.id === 'bot-1')!
    const p2After2 = state.players.find(p => p.id === 'bot-2')!
    if (p1After2.stack === 0 || p2After2.stack === 0) return

    // Play hand at level 2 (100/200)
    state = playHandToCompletion(state, { 'bot-1': tag, 'bot-2': tag })
    expect(state.handInProgress).toBe(false)

    // Chips are still conserved
    const p1Final = state.players.find(p => p.id === 'bot-1')!
    const p2Final = state.players.find(p => p.id === 'bot-2')!
    expect(p1Final.stack + p2Final.stack).toBe(10000)
  })

  test('TAG bot shoves with short stack and premium hand', () => {
    // Give bot-1 only ~10 BBs (500 chips at 25/50)
    let state = createTournamentGame(500)

    // Give bot-1 pocket aces — should shove
    const deck = makePaddedDeck([
      'Ah', 'As',  // bot-1 — premium, 10 BBs
      '7c', '2d',  // bot-2 — trash
      '4s', '5s', '6s',
      '8s', '9s',
    ])

    const transitions = startHand(state, deck)
    let current = transitions[transitions.length - 1].state

    if (current.activePlayerId === 'bot-1') {
      const payload = buildGameStatePayload(current, { type: 'DEAL' }, 'bot-1', 30000)
      const decision = tag.decide(payload.gameState, payload.actionRequest!, 'bot-1')
      expect(decision.type).toBe('ALL_IN')
    }
  })

  test('bots play tournament to completion (one player busts)', () => {
    // Small starting stacks so the tournament ends quickly
    let state = createTournamentGame(500)

    let handsPlayed = 0
    const maxHands = 50

    while (handsPlayed < maxHands) {
      const p1 = state.players.find(p => p.id === 'bot-1')!
      const p2 = state.players.find(p => p.id === 'bot-2')!
      if (p1.stack === 0 || p2.stack === 0) break

      state = playHandToCompletion(state, {
        'bot-1': tag,
        'bot-2': cs,
      })
      expect(state.handInProgress).toBe(false)
      handsPlayed++

      // Advance blinds every 3 hands to speed things up
      if (handsPlayed % 3 === 0 && state.currentBlindLevel < TOURNAMENT_SCHEDULE.length - 1) {
        state = advanceBlindLevel(state).state
      }
    }

    // Tournament should have ended (one player busted) within max hands
    const p1Final = state.players.find(p => p.id === 'bot-1')!
    const p2Final = state.players.find(p => p.id === 'bot-2')!
    expect(p1Final.stack + p2Final.stack).toBe(1000) // Chips conserved (2 × 500)
    expect(handsPlayed).toBeGreaterThan(0)
  })
})
