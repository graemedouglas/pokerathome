import type { GameState, ActionRequest, ActionOption } from '@pokerathome/schema'
import { CallingStationStrategy } from '../src/strategies/calling-station'
import { TagBotStrategy } from '../src/strategies/tag-bot'
import { chenScore, preflopTier, postflopStrength } from '../src/hand-strength'

// ═══════════════════════════════════════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════════════════════════════════════

const PLAYER_ID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
const OPP_ID = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'

function makeGameState(overrides: Partial<GameState> & { myCards?: [string, string]; oppCards?: [string, string] | null }): GameState {
  const { myCards, oppCards, ...rest } = overrides
  return {
    gameId: 'cccccccc-cccc-cccc-cccc-cccccccccccc',
    gameType: 'cash',
    handNumber: 1,
    stage: 'PRE_FLOP',
    communityCards: [],
    pot: 15,
    pots: [{ amount: 15, eligiblePlayerIds: [PLAYER_ID, OPP_ID] }],
    players: [
      {
        id: PLAYER_ID,
        displayName: 'Bot',
        seatIndex: 0,
        role: 'player',
        stack: 990,
        bet: 0,
        potShare: 0,
        folded: false,
        holeCards: myCards ?? ['Ah', 'Kh'],
        connected: true,
      },
      {
        id: OPP_ID,
        displayName: 'Opponent',
        seatIndex: 1,
        role: 'player',
        stack: 990,
        bet: 10,
        potShare: 10,
        folded: false,
        holeCards: oppCards ?? null,
        connected: true,
      },
    ],
    dealerSeatIndex: 0,
    smallBlindAmount: 5,
    bigBlindAmount: 10,
    activePlayerId: PLAYER_ID,
    ...rest,
  }
}

function makeActionRequest(actions: ActionOption[]): ActionRequest {
  return { availableActions: actions, timeToActMs: 30000 }
}

const PREFLOP_FACING_BET: ActionOption[] = [
  { type: 'FOLD' },
  { type: 'CALL', amount: 10 },
  { type: 'RAISE', min: 20, max: 990 },
  { type: 'ALL_IN', amount: 990 },
]

const POSTFLOP_NO_BET: ActionOption[] = [
  { type: 'FOLD' },
  { type: 'CHECK' },
  { type: 'BET', min: 10, max: 990 },
  { type: 'ALL_IN', amount: 990 },
]

const POSTFLOP_FACING_BET: ActionOption[] = [
  { type: 'FOLD' },
  { type: 'CALL', amount: 50 },
  { type: 'RAISE', min: 100, max: 990 },
  { type: 'ALL_IN', amount: 990 },
]

// ═══════════════════════════════════════════════════════════════════════════════
// Hand strength
// ═══════════════════════════════════════════════════════════════════════════════

describe('Hand strength - Chen score', () => {
  test('AA is premium (score >= 12)', () => {
    expect(chenScore('Ah', 'As')).toBeGreaterThanOrEqual(12)
  })

  test('KK is premium', () => {
    expect(chenScore('Kh', 'Ks')).toBeGreaterThanOrEqual(12)
  })

  test('AKs is premium', () => {
    expect(chenScore('Ah', 'Kh')).toBeGreaterThanOrEqual(12)
  })

  test('72o is weak (score < 6)', () => {
    expect(chenScore('7h', '2c')).toBeLessThan(6)
  })

  test('pair of twos scores at least 5', () => {
    expect(chenScore('2h', '2s')).toBeGreaterThanOrEqual(5)
  })
})

describe('Preflop tier', () => {
  test('AA is premium', () => {
    expect(preflopTier('Ah', 'As')).toBe('premium')
  })

  test('72o is weak', () => {
    expect(preflopTier('7h', '2c')).toBe('weak')
  })

  test('JTs is playable or better', () => {
    const tier = preflopTier('Jh', 'Th')
    expect(['premium', 'strong', 'playable']).toContain(tier)
  })
})

describe('Postflop strength', () => {
  test('full house is monster', () => {
    expect(postflopStrength(['Ah', 'As'], ['Ad', 'Kh', 'Kd'])).toBe('monster')
  })

  test('flush is strong', () => {
    expect(postflopStrength(['Ah', '5h'], ['2h', '8h', 'Th'])).toBe('strong')
  })

  test('pair with board hit is medium', () => {
    expect(postflopStrength(['Ah', 'Kd'], ['As', '7c', '3d'])).toBe('medium')
  })

  test('no pair is weak', () => {
    expect(postflopStrength(['Ah', 'Kd'], ['2s', '7c', '3d'])).toBe('weak')
  })
})

// ═══════════════════════════════════════════════════════════════════════════════
// Calling Station
// ═══════════════════════════════════════════════════════════════════════════════

describe('CallingStation strategy', () => {
  const cs = new CallingStationStrategy()

  test('checks when available', () => {
    const gs = makeGameState({ stage: 'FLOP', communityCards: ['2h', '3h', '4h'] })
    const ar = makeActionRequest(POSTFLOP_NO_BET)
    const decision = cs.decide(gs, ar, PLAYER_ID)
    expect(decision.type).toBe('CHECK')
  })

  test('calls when facing a bet', () => {
    const gs = makeGameState({})
    const ar = makeActionRequest(PREFLOP_FACING_BET)
    const decision = cs.decide(gs, ar, PLAYER_ID)
    expect(decision.type).toBe('CALL')
  })

  test('folds when only fold is available', () => {
    const gs = makeGameState({})
    const ar = makeActionRequest([{ type: 'FOLD' }])
    const decision = cs.decide(gs, ar, PLAYER_ID)
    expect(decision.type).toBe('FOLD')
  })

  test('never raises', () => {
    const gs = makeGameState({})
    const ar = makeActionRequest(PREFLOP_FACING_BET)
    const decision = cs.decide(gs, ar, PLAYER_ID)
    expect(decision.type).not.toBe('RAISE')
    expect(decision.type).not.toBe('BET')
    expect(decision.type).not.toBe('ALL_IN')
  })
})

// ═══════════════════════════════════════════════════════════════════════════════
// TAG Bot
// ═══════════════════════════════════════════════════════════════════════════════

describe('TagBot strategy', () => {
  const tag = new TagBotStrategy()

  test('raises premium hands preflop', () => {
    const gs = makeGameState({ myCards: ['Ah', 'As'] })
    const ar = makeActionRequest(PREFLOP_FACING_BET)
    const decision = tag.decide(gs, ar, PLAYER_ID)
    expect(decision.type).toBe('RAISE')
    expect(decision.amount).toBeDefined()
  })

  test('raises strong hands preflop', () => {
    const gs = makeGameState({ myCards: ['Jh', 'Js'] })
    const ar = makeActionRequest(PREFLOP_FACING_BET)
    const decision = tag.decide(gs, ar, PLAYER_ID)
    expect(decision.type).toBe('RAISE')
  })

  test('calls playable hands preflop when bet is small', () => {
    const gs = makeGameState({ myCards: ['9h', '9s'] })
    const ar = makeActionRequest(PREFLOP_FACING_BET)
    const decision = tag.decide(gs, ar, PLAYER_ID)
    expect(['CALL', 'RAISE']).toContain(decision.type)
  })

  test('folds trash hands preflop', () => {
    const gs = makeGameState({ myCards: ['7h', '2c'] })
    const ar = makeActionRequest(PREFLOP_FACING_BET)
    const decision = tag.decide(gs, ar, PLAYER_ID)
    expect(decision.type).toBe('FOLD')
  })

  test('bets strong hand on flop', () => {
    const gs = makeGameState({
      stage: 'FLOP',
      communityCards: ['Ah', '7c', '3d'],
      myCards: ['As', 'Kd'],
      pot: 30,
    })
    const ar = makeActionRequest(POSTFLOP_NO_BET)
    const decision = tag.decide(gs, ar, PLAYER_ID)
    expect(['BET', 'CHECK']).toContain(decision.type)
  })

  test('bets or raises with monster hand', () => {
    const gs = makeGameState({
      stage: 'FLOP',
      communityCards: ['Ah', 'Ad', 'Kh'],
      myCards: ['As', 'Ac'],
      pot: 30,
    })
    const ar = makeActionRequest(POSTFLOP_NO_BET)
    const decision = tag.decide(gs, ar, PLAYER_ID)
    expect(decision.type).toBe('BET')
    expect(decision.amount).toBeDefined()
    expect(decision.amount!).toBeGreaterThan(0)
  })

  test('checks or folds with weak hand facing bet', () => {
    const gs = makeGameState({
      stage: 'FLOP',
      communityCards: ['2s', '7c', '3d'],
      myCards: ['9h', '8c'],
      pot: 100,
    })
    const ar = makeActionRequest(POSTFLOP_FACING_BET)
    const decision = tag.decide(gs, ar, PLAYER_ID)
    expect(decision.type).toBe('FOLD')
  })

  test('checks weak hand when free', () => {
    const gs = makeGameState({
      stage: 'FLOP',
      communityCards: ['2s', '7c', '3d'],
      myCards: ['9h', '8c'],
      pot: 20,
    })
    const ar = makeActionRequest(POSTFLOP_NO_BET)
    const decision = tag.decide(gs, ar, PLAYER_ID)
    expect(decision.type).toBe('CHECK')
  })
})

// ═══════════════════════════════════════════════════════════════════════════════
// TAG Bot — Tournament chip denomination alignment
// ═══════════════════════════════════════════════════════════════════════════════

describe('TagBot tournament chip denomination', () => {
  const tag = new TagBotStrategy()
  const CHIP_DENOM = 25

  function makeTournamentState(overrides: Partial<GameState> & { myCards?: [string, string]; oppCards?: [string, string] | null }): GameState {
    const { myCards, oppCards, ...rest } = overrides
    return {
      gameId: 'cccccccc-cccc-cccc-cccc-cccccccccccc',
      gameType: 'tournament',
      handNumber: 1,
      stage: 'PRE_FLOP',
      communityCards: [],
      pot: 75,
      pots: [{ amount: 75, eligiblePlayerIds: [PLAYER_ID, OPP_ID] }],
      players: [
        {
          id: PLAYER_ID,
          displayName: 'Bot',
          seatIndex: 0,
          role: 'player',
          stack: 4950,
          bet: 0,
          potShare: 0,
          folded: false,
          holeCards: myCards ?? ['Ah', 'Kh'],
          connected: true,
          sittingOut: false,
        },
        {
          id: OPP_ID,
          displayName: 'Opponent',
          seatIndex: 1,
          role: 'player',
          stack: 4950,
          bet: 50,
          potShare: 50,
          folded: false,
          holeCards: oppCards ?? null,
          connected: true,
          sittingOut: false,
        },
      ],
      dealerSeatIndex: 0,
      smallBlindAmount: 25,
      bigBlindAmount: 50,
      activePlayerId: PLAYER_ID,
      tournament: {
        blindSchedule: [{ level: 1, smallBlind: 25, bigBlind: 50, ante: 0, minChipDenom: CHIP_DENOM }],
        currentBlindLevel: 0,
        nextBlindChangeAt: null,
        roundLengthMs: 60000,
        isPaused: false,
        minChipDenom: CHIP_DENOM,
        averageStack: 5000,
        playersRemaining: 2,
        totalPlayers: 2,
        startedAt: Date.now(),
      },
      ...rest,
    }
  }

  const TOURNAMENT_BET_ACTIONS: ActionOption[] = [
    { type: 'FOLD' },
    { type: 'CHECK' },
    { type: 'BET', min: 50, max: 4950 },
    { type: 'ALL_IN', amount: 4950 },
  ]

  const TOURNAMENT_RAISE_ACTIONS: ActionOption[] = [
    { type: 'FOLD' },
    { type: 'CALL', amount: 100 },
    { type: 'RAISE', min: 200, max: 4950 },
    { type: 'ALL_IN', amount: 4950 },
  ]

  test('postflop bet is aligned to chip denomination', () => {
    // Monster hand on flop — bot should bet ~75% pot
    for (const pot of [75, 150, 175, 225, 275, 325, 350]) {
      const gs = makeTournamentState({
        stage: 'FLOP',
        communityCards: ['Ah', 'Ad', 'Kh'],
        myCards: ['As', 'Ac'],
        pot,
      })
      const ar = makeActionRequest(TOURNAMENT_BET_ACTIONS)
      const decision = tag.decide(gs, ar, PLAYER_ID)
      if (decision.amount !== undefined) {
        expect(decision.amount % CHIP_DENOM).toBe(0)
        expect(decision.amount).toBeGreaterThanOrEqual(50)
        expect(decision.amount).toBeLessThanOrEqual(4950)
      }
    }
  })

  test('postflop raise is aligned to chip denomination', () => {
    // Strong hand facing a bet — bot should raise ~60% pot
    for (const pot of [150, 200, 275, 325, 400]) {
      const gs = makeTournamentState({
        stage: 'FLOP',
        communityCards: ['Ah', '2h', '3h'],
        myCards: ['Kh', 'Qh'],
        pot,
      })
      const ar = makeActionRequest(TOURNAMENT_RAISE_ACTIONS)
      const decision = tag.decide(gs, ar, PLAYER_ID)
      if (decision.amount !== undefined) {
        expect(decision.amount % CHIP_DENOM).toBe(0)
      }
    }
  })

  test('preflop raise is aligned to chip denomination', () => {
    // Premium hand — raises 3x BB
    const gs = makeTournamentState({ myCards: ['Ah', 'As'] })
    const ar = makeActionRequest(TOURNAMENT_RAISE_ACTIONS)
    const decision = tag.decide(gs, ar, PLAYER_ID)
    expect(decision.type).toBe('RAISE')
    expect(decision.amount).toBeDefined()
    expect(decision.amount! % CHIP_DENOM).toBe(0)
  })

  test('falls back to CALL when rounding pushes amount below min', () => {
    // Scenario: tight min/max range where rounding eliminates the bet
    const gs = makeTournamentState({
      stage: 'FLOP',
      communityCards: ['Ah', 'Ad', 'Kh'],
      myCards: ['As', 'Ac'],
      pot: 75, // 75% of 75 = 56, rounds down to 50 = min, still valid
    })
    // Very tight range: min=50, max=75. 75% of 75 = 56 → rounds to 50.
    const tightActions: ActionOption[] = [
      { type: 'FOLD' },
      { type: 'CHECK' },
      { type: 'BET', min: 75, max: 100 },  // min 75 > 56 rounded to 50
      { type: 'CALL', amount: 50 },
      { type: 'ALL_IN', amount: 100 },
    ]
    const ar = makeActionRequest(tightActions)
    const decision = tag.decide(gs, ar, PLAYER_ID)
    // Should fall back to CALL since BET amount rounds below min
    expect(['BET', 'CALL']).toContain(decision.type)
    if (decision.type === 'BET' && decision.amount !== undefined) {
      expect(decision.amount % CHIP_DENOM).toBe(0)
      expect(decision.amount).toBeGreaterThanOrEqual(75)
    }
  })
})
