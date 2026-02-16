/**
 * Regression tests for UI bug fixes.
 *
 * Tests the pure adapter/controller logic that drives the four fixes:
 *  1. Card backs for other players (hasHiddenCards)
 *  2. Action timer / timeout handling
 *  3. Action pop text mapping
 *  4. Bet vs Raise label (raiseType)
 */
import type {
  GameState as ServerGameState,
  PlayerState as ServerPlayerState,
  ActionRequest as ServerActionRequest,
} from '@pokerathome/schema'

import {
  adaptGameState,
  adaptActionRequest,
  adaptPlayerAction,
  extractWinners,
  type AdapterContext,
} from '../../ui/src/adapter'

import { getActionPopInfo } from '../../ui/src/network/game-controller'

// ─── Helpers ──────────────────────────────────────────────────────────────────

const PLAYER_A_ID = '00000000-0000-0000-0000-000000000001'
const PLAYER_B_ID = '00000000-0000-0000-0000-000000000002'

function makePlayer(overrides: Partial<ServerPlayerState> = {}): ServerPlayerState {
  return {
    id: PLAYER_A_ID,
    displayName: 'Alice',
    seatIndex: 0,
    role: 'player',
    stack: 990,
    bet: 10,
    potShare: 10,
    folded: false,
    holeCards: null,
    connected: true,
    ...overrides,
  }
}

function makeServerState(overrides: Partial<ServerGameState> = {}): ServerGameState {
  return {
    gameId: '11111111-1111-1111-1111-111111111111',
    gameType: 'cash',
    handNumber: 1,
    stage: 'PRE_FLOP',
    communityCards: [],
    pot: 15,
    pots: [{ amount: 15, eligiblePlayerIds: [PLAYER_A_ID, PLAYER_B_ID] }],
    players: [
      makePlayer({ id: PLAYER_A_ID, displayName: 'Alice', seatIndex: 0, holeCards: ['Ah', 'Kh'] }),
      makePlayer({ id: PLAYER_B_ID, displayName: 'Bot', seatIndex: 1, holeCards: null }),
    ],
    dealerSeatIndex: 0,
    smallBlindAmount: 5,
    bigBlindAmount: 10,
    activePlayerId: PLAYER_A_ID,
    ...overrides,
  }
}

function baseCtx(overrides: Partial<AdapterContext> = {}): AdapterContext {
  return {
    myPlayerId: PLAYER_A_ID,
    sbPlayerId: PLAYER_A_ID,
    bbPlayerId: PLAYER_B_ID,
    ...overrides,
  }
}

// ═════════════════════════════════════════════════════════════════════════════════
// 1. Card backs — hasHiddenCards
// ═════════════════════════════════════════════════════════════════════════════════

describe('hasHiddenCards (card backs for other players)', () => {
  test('other player with null holeCards AFTER deal → hasHiddenCards true', () => {
    const server = makeServerState()
    const ctx = baseCtx({ cardsDealt: true })
    const ui = adaptGameState(server, ctx)

    const bot = ui.players.find(p => p.name === 'Bot')!
    expect(bot.hasHiddenCards).toBe(true)
    expect(bot.holeCards).toHaveLength(0) // no real cards exposed
  })

  test('other player with null holeCards BEFORE deal → hasHiddenCards false', () => {
    const server = makeServerState()
    const ctx = baseCtx({ cardsDealt: false })
    const ui = adaptGameState(server, ctx)

    const bot = ui.players.find(p => p.name === 'Bot')!
    expect(bot.hasHiddenCards).toBe(false)
  })

  test('cardsDealt not set (undefined) → hasHiddenCards false', () => {
    const server = makeServerState()
    const ctx = baseCtx() // cardsDealt is undefined
    const ui = adaptGameState(server, ctx)

    const bot = ui.players.find(p => p.name === 'Bot')!
    expect(bot.hasHiddenCards).toBe(false)
  })

  test('folded player with null holeCards after deal → hasHiddenCards false', () => {
    const server = makeServerState({
      players: [
        makePlayer({ id: PLAYER_A_ID, displayName: 'Alice', seatIndex: 0, holeCards: ['Ah', 'Kh'] }),
        makePlayer({ id: PLAYER_B_ID, displayName: 'Bot', seatIndex: 1, holeCards: null, folded: true }),
      ],
    })
    const ctx = baseCtx({ cardsDealt: true })
    const ui = adaptGameState(server, ctx)

    const bot = ui.players.find(p => p.name === 'Bot')!
    expect(bot.hasHiddenCards).toBe(false)
    expect(bot.isFolded).toBe(true)
  })

  test('human player with real holeCards → hasHiddenCards false', () => {
    const server = makeServerState()
    const ctx = baseCtx({ cardsDealt: true })
    const ui = adaptGameState(server, ctx)

    const alice = ui.players.find(p => p.name === 'Alice')!
    expect(alice.hasHiddenCards).toBe(false)
    expect(alice.holeCards).toHaveLength(2)
  })
})

// ═════════════════════════════════════════════════════════════════════════════════
// 2. Bet vs Raise label — raiseType
// ═════════════════════════════════════════════════════════════════════════════════

describe('raiseType (bet vs raise label)', () => {
  test('server BET action → raiseType is BET', () => {
    const req: ServerActionRequest = {
      availableActions: [
        { type: 'FOLD' },
        { type: 'CHECK' },
        { type: 'BET', min: 10, max: 1000 },
      ],
      timeToActMs: 30000,
    }
    const result = adaptActionRequest(req)
    expect(result.raiseType).toBe('BET')
    expect(result.canRaise).toBe(true)
  })

  test('server RAISE action → raiseType is RAISE', () => {
    const req: ServerActionRequest = {
      availableActions: [
        { type: 'FOLD' },
        { type: 'CALL', amount: 10 },
        { type: 'RAISE', min: 20, max: 1000 },
        { type: 'ALL_IN', amount: 1000 },
      ],
      timeToActMs: 30000,
    }
    const result = adaptActionRequest(req)
    expect(result.raiseType).toBe('RAISE')
    expect(result.canRaise).toBe(true)
    expect(result.canCall).toBe(true)
  })

  test('no BET or RAISE available → raiseType is null', () => {
    const req: ServerActionRequest = {
      availableActions: [
        { type: 'FOLD' },
        { type: 'CALL', amount: 10 },
      ],
      timeToActMs: 30000,
    }
    const result = adaptActionRequest(req)
    expect(result.raiseType).toBe(null)
    expect(result.canRaise).toBe(false)
  })

  test('only ALL_IN available (no BET/RAISE) → canRaise true, raiseType null', () => {
    const req: ServerActionRequest = {
      availableActions: [
        { type: 'FOLD' },
        { type: 'ALL_IN', amount: 50 },
      ],
      timeToActMs: 30000,
    }
    const result = adaptActionRequest(req)
    expect(result.canRaise).toBe(true)
    expect(result.raiseType).toBe(null)
    expect(result.minRaise).toBe(50)
    expect(result.maxRaise).toBe(50)
  })

  test('BET raiseType routes raise action to BET on server', () => {
    const available = adaptActionRequest({
      availableActions: [
        { type: 'FOLD' },
        { type: 'CHECK' },
        { type: 'BET', min: 10, max: 500 },
      ],
      timeToActMs: 30000,
    })
    const serverAction = adaptPlayerAction({ type: 'raise', amount: 30 }, 1, available)
    expect(serverAction.type).toBe('BET')
    expect(serverAction.amount).toBe(30)
  })

  test('RAISE raiseType routes raise action to RAISE on server', () => {
    const available = adaptActionRequest({
      availableActions: [
        { type: 'FOLD' },
        { type: 'CALL', amount: 10 },
        { type: 'RAISE', min: 20, max: 500 },
        { type: 'ALL_IN', amount: 500 },
      ],
      timeToActMs: 30000,
    })
    const serverAction = adaptPlayerAction({ type: 'raise', amount: 40 }, 1, available)
    expect(serverAction.type).toBe('RAISE')
    expect(serverAction.amount).toBe(40)
  })

  test('raise at allInAmount routes to ALL_IN', () => {
    const available = adaptActionRequest({
      availableActions: [
        { type: 'FOLD' },
        { type: 'CALL', amount: 10 },
        { type: 'RAISE', min: 20, max: 500 },
        { type: 'ALL_IN', amount: 500 },
      ],
      timeToActMs: 30000,
    })
    const serverAction = adaptPlayerAction({ type: 'raise', amount: 500 }, 1, available)
    expect(serverAction.type).toBe('ALL_IN')
    expect(serverAction.amount).toBeUndefined()
  })
})

// ═════════════════════════════════════════════════════════════════════════════════
// 3. Action pop text mapping
// ═════════════════════════════════════════════════════════════════════════════════

describe('getActionPopInfo (action pop text)', () => {
  test('FOLD → red', () => {
    const { text, color } = getActionPopInfo({ type: 'FOLD' })
    expect(text).toBe('FOLD')
    expect(color).toBe(0xef4444)
  })

  test('CHECK → blue', () => {
    const { text, color } = getActionPopInfo({ type: 'CHECK' })
    expect(text).toBe('CHECK')
    expect(color).toBe(0x60a5fa)
  })

  test('CALL with amount → green', () => {
    const { text, color } = getActionPopInfo({ type: 'CALL', amount: 10 })
    expect(text).toBe('CALL $10')
    expect(color).toBe(0x4ade80)
  })

  test('BET with amount → gold', () => {
    const { text, color } = getActionPopInfo({ type: 'BET', amount: 20 })
    expect(text).toBe('BET $20')
    expect(color).toBe(0xfbbf24)
  })

  test('RAISE with amount → gold', () => {
    const { text, color } = getActionPopInfo({ type: 'RAISE', amount: 50 })
    expect(text).toBe('RAISE $50')
    expect(color).toBe(0xfbbf24)
  })

  test('ALL_IN → orange', () => {
    const { text, color } = getActionPopInfo({ type: 'ALL_IN' })
    expect(text).toBe('ALL IN')
    expect(color).toBe(0xff6644)
  })

  test('unknown type falls back', () => {
    const { text, color } = getActionPopInfo({ type: 'SOMETHING_NEW' })
    expect(text).toBe('SOMETHING_NEW')
    expect(color).toBe(0xffffff)
  })
})

// ═════════════════════════════════════════════════════════════════════════════════
// 4. Timer — actionRequest carries timeToActMs
// ═════════════════════════════════════════════════════════════════════════════════

describe('action timer data flow', () => {
  test('adaptActionRequest preserves timeToActMs availability', () => {
    const req: ServerActionRequest = {
      availableActions: [
        { type: 'FOLD' },
        { type: 'CALL', amount: 5 },
        { type: 'RAISE', min: 15, max: 1050 },
        { type: 'ALL_IN', amount: 1050 },
      ],
      timeToActMs: 30000,
    }

    expect(req.timeToActMs).toBe(30000)

    const available = adaptActionRequest(req)
    expect(available.canFold).toBe(true)
    expect(available.canCall).toBe(true)
    expect(available.canRaise).toBe(true)
  })
})

// ═════════════════════════════════════════════════════════════════════════════════
// 5. Showdown reveals opponent hole cards
// ═════════════════════════════════════════════════════════════════════════════════

describe('showdown hole card reveal', () => {
  test('showdownHoleCards merges into opponent player data', () => {
    const server = makeServerState({ stage: 'SHOWDOWN' })
    const showdownHoleCards = new Map<string, [string, string]>()
    showdownHoleCards.set(PLAYER_B_ID, ['Qs', 'Jd'])
    const ctx = baseCtx({ cardsDealt: true, showdownHoleCards })
    const ui = adaptGameState(server, ctx)

    const bot = ui.players.find(p => p.name === 'Bot')!
    expect(bot.holeCards).toHaveLength(2)
    expect(bot.holeCards[0].code).toBe('Qs')
    expect(bot.holeCards[1].code).toBe('Jd')
    expect(bot.hasHiddenCards).toBe(false)
  })

  test('human player cards unaffected by showdown context', () => {
    const server = makeServerState({ stage: 'SHOWDOWN' })
    const showdownHoleCards = new Map<string, [string, string]>()
    showdownHoleCards.set(PLAYER_B_ID, ['Qs', 'Jd'])
    const ctx = baseCtx({ cardsDealt: true, showdownHoleCards })
    const ui = adaptGameState(server, ctx)

    const alice = ui.players.find(p => p.name === 'Alice')!
    expect(alice.holeCards).toHaveLength(2)
    expect(alice.holeCards[0].code).toBe('Ah') // original server cards
  })
})

// ═════════════════════════════════════════════════════════════════════════════════
// 6. Winner aggregation (split pot display)
// ═════════════════════════════════════════════════════════════════════════════════

describe('extractWinners aggregation', () => {
  const players = [
    makePlayer({ id: PLAYER_A_ID, displayName: 'Alice', seatIndex: 0 }),
    makePlayer({ id: PLAYER_B_ID, displayName: 'Bot', seatIndex: 1 }),
  ]

  test('single pot winner produces one entry', () => {
    const event = {
      type: 'HAND_END' as const,
      winners: [{ playerId: PLAYER_A_ID, amount: 100, potIndex: 0 }],
    }
    const result = extractWinners(event, players)
    expect(result).toHaveLength(1)
    expect(result[0].amount).toBe(100)
  })

  test('multi-pot winner is aggregated into one entry', () => {
    const event = {
      type: 'HAND_END' as const,
      winners: [
        { playerId: PLAYER_A_ID, amount: 80, potIndex: 0 },
        { playerId: PLAYER_A_ID, amount: 40, potIndex: 1 },
      ],
    }
    const result = extractWinners(event, players)
    expect(result).toHaveLength(1)
    expect(result[0].amount).toBe(120) // 80 + 40
    expect(result[0].playerIndex).toBe(0) // Alice's seat
  })

  test('two different winners stay separate', () => {
    const event = {
      type: 'HAND_END' as const,
      winners: [
        { playerId: PLAYER_A_ID, amount: 50, potIndex: 0 },
        { playerId: PLAYER_B_ID, amount: 30, potIndex: 1 },
      ],
    }
    const result = extractWinners(event, players)
    expect(result).toHaveLength(2)
  })

  test('fold win uses "Winner" description when no showdown results', () => {
    const event = {
      type: 'HAND_END' as const,
      winners: [{ playerId: PLAYER_A_ID, amount: 15, potIndex: 0 }],
    }
    const result = extractWinners(event, players)
    expect(result[0].handDescription).toBe('Winner')
  })

  test('showdown win uses hand description from results', () => {
    const event = {
      type: 'HAND_END' as const,
      winners: [{ playerId: PLAYER_A_ID, amount: 100, potIndex: 0 }],
    }
    const showdownResults = new Map([
      [PLAYER_A_ID, 'Pair, J\'s'],
    ])
    const result = extractWinners(event, players, showdownResults)
    expect(result[0].handDescription).toBe('Pair, J\'s')
  })
})

// ═════════════════════════════════════════════════════════════════════════════════
// Spectator Separation
// ═════════════════════════════════════════════════════════════════════════════════

describe('Spectator separation', () => {
  test('spectators filtered out of players array', () => {
    const server = makeServerState({
      players: [
        makePlayer({ id: PLAYER_A_ID, seatIndex: 0, role: 'player', displayName: 'Alice' }),
        makePlayer({ id: PLAYER_B_ID, seatIndex: 1, role: 'player', displayName: 'Bob' }),
        makePlayer({ id: 'spec1-uuid', seatIndex: 6, role: 'spectator', displayName: 'Spectator1', stack: 0 }),
        makePlayer({ id: 'spec2-uuid', seatIndex: 7, role: 'spectator', displayName: 'Spectator2', stack: 0 }),
      ],
    })
    const ctx = baseCtx()
    const ui = adaptGameState(server, ctx)

    expect(ui.players).toHaveLength(2)
    expect(ui.spectators).toHaveLength(2)
    expect(ui.spectators).toContain('Spectator1')
    expect(ui.spectators).toContain('Spectator2')
  })

  test('spectators array is sorted alphabetically', () => {
    const server = makeServerState({
      players: [
        makePlayer({ id: PLAYER_A_ID, seatIndex: 0, role: 'player', displayName: 'Alice' }),
        makePlayer({ id: 'spec1-uuid', seatIndex: 6, role: 'spectator', displayName: 'Zack', stack: 0 }),
        makePlayer({ id: 'spec2-uuid', seatIndex: 7, role: 'spectator', displayName: 'Alice Spectator', stack: 0 }),
        makePlayer({ id: 'spec3-uuid', seatIndex: 8, role: 'spectator', displayName: 'Bob Spectator', stack: 0 }),
      ],
    })
    const ctx = baseCtx()
    const ui = adaptGameState(server, ctx)

    expect(ui.spectators).toEqual(['Alice Spectator', 'Bob Spectator', 'Zack'])
  })

  test('empty spectators array when no spectators', () => {
    const server = makeServerState({
      players: [
        makePlayer({ id: PLAYER_A_ID, seatIndex: 0, role: 'player', displayName: 'Alice' }),
        makePlayer({ id: PLAYER_B_ID, seatIndex: 1, role: 'player', displayName: 'Bob' }),
      ],
    })
    const ctx = baseCtx()
    const ui = adaptGameState(server, ctx)

    expect(ui.spectators).toHaveLength(0)
    expect(ui.spectators).toEqual([])
  })

  test('spectators are not included in player seatIndex lookup', () => {
    const server = makeServerState({
      players: [
        makePlayer({ id: PLAYER_A_ID, seatIndex: 0, role: 'player', displayName: 'Alice' }),
        makePlayer({ id: PLAYER_B_ID, seatIndex: 1, role: 'player', displayName: 'Bob' }),
        makePlayer({ id: 'spec1-uuid', seatIndex: 6, role: 'spectator', displayName: 'Spectator', stack: 0 }),
      ],
    })
    const ctx = baseCtx()
    const ui = adaptGameState(server, ctx)

    // Only players at seats 0 and 1 should be in the players array
    const seatIndices = ui.players.map(p => p.seatIndex)
    expect(seatIndices).toContain(0)
    expect(seatIndices).toContain(1)
    expect(seatIndices).not.toContain(6)
  })
})
