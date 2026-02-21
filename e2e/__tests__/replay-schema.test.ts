/**
 * Schema validation tests for replay-related Zod schemas.
 */
import {
  ReplayFile,
  ReplayEntry,
  ReplayGameConfig,
  ReplayPlayer,
  ReplayControlPayload,
  ReplayCardVisibilityPayload,
} from '@pokerathome/schema'

// Valid UUIDs (version 4 format)
const GAME_ID = 'a1111111-1111-4111-8111-111111111111'
const PLAYER_A_ID = 'a0000000-0000-4000-8000-000000000001'
const PLAYER_B_ID = 'a0000000-0000-4000-8000-000000000002'

// ─── ReplayGameConfig ─────────────────────────────────────────────────────────

describe('ReplayGameConfig', () => {
  it('accepts valid config', () => {
    const result = ReplayGameConfig.safeParse({
      gameId: GAME_ID,
      gameName: 'Test',
      gameType: 'cash',
      smallBlindAmount: 5,
      bigBlindAmount: 10,
      maxPlayers: 6,
      startingStack: 1000,
    })
    expect(result.success).toBe(true)
  })

  it('rejects missing gameId', () => {
    const result = ReplayGameConfig.safeParse({
      gameName: 'Test',
      gameType: 'cash',
      smallBlindAmount: 5,
      bigBlindAmount: 10,
      maxPlayers: 6,
      startingStack: 1000,
    })
    expect(result.success).toBe(false)
  })

  it('accepts tournament gameType', () => {
    const result = ReplayGameConfig.safeParse({
      gameId: GAME_ID,
      gameName: 'Tourney',
      gameType: 'tournament',
      smallBlindAmount: 25,
      bigBlindAmount: 50,
      maxPlayers: 9,
      startingStack: 5000,
    })
    expect(result.success).toBe(true)
  })

  it('rejects invalid gameType', () => {
    const result = ReplayGameConfig.safeParse({
      gameId: GAME_ID,
      gameName: 'Test',
      gameType: 'sit-n-go',
      smallBlindAmount: 5,
      bigBlindAmount: 10,
      maxPlayers: 6,
      startingStack: 1000,
    })
    expect(result.success).toBe(false)
  })
})

// ─── ReplayPlayer ─────────────────────────────────────────────────────────────

describe('ReplayPlayer', () => {
  it('accepts valid player', () => {
    const result = ReplayPlayer.safeParse({
      id: PLAYER_A_ID,
      displayName: 'Alice',
      seatIndex: 0,
      role: 'player',
    })
    expect(result.success).toBe(true)
  })

  it('accepts spectator role', () => {
    const result = ReplayPlayer.safeParse({
      id: PLAYER_B_ID,
      displayName: 'Watcher',
      seatIndex: 6,
      role: 'spectator',
    })
    expect(result.success).toBe(true)
  })
})

// ─── ReplayEntry ──────────────────────────────────────────────────────────────

describe('ReplayEntry', () => {
  it('accepts event entry', () => {
    const result = ReplayEntry.safeParse({
      index: 0,
      timestamp: 100,
      type: 'event',
      event: { type: 'HAND_START', handNumber: 1, dealerSeatIndex: 0 },
      engineState: { pot: 0, players: [] },
    })
    expect(result.success).toBe(true)
  })

  it('accepts chat entry', () => {
    const result = ReplayEntry.safeParse({
      index: 1,
      timestamp: 200,
      type: 'chat',
      chat: {
        playerId: PLAYER_A_ID,
        displayName: 'Alice',
        message: 'Hello!',
        timestamp: new Date().toISOString(),
        role: 'player',
      },
    })
    expect(result.success).toBe(true)
  })

  it('rejects negative index', () => {
    const result = ReplayEntry.safeParse({
      index: -1,
      timestamp: 0,
      type: 'event',
    })
    expect(result.success).toBe(false)
  })

  it('rejects invalid type', () => {
    const result = ReplayEntry.safeParse({
      index: 0,
      timestamp: 0,
      type: 'action',
    })
    expect(result.success).toBe(false)
  })
})

// ─── ReplayControlPayload ─────────────────────────────────────────────────────

describe('ReplayControlPayload', () => {
  const validCommands = [
    'play', 'pause', 'step_forward', 'step_backward',
    'jump_round_start', 'jump_next_round', 'set_speed', 'set_position',
  ]

  for (const command of validCommands) {
    it(`accepts '${command}' command`, () => {
      const result = ReplayControlPayload.safeParse({ command })
      expect(result.success).toBe(true)
    })
  }

  it('rejects invalid command', () => {
    const result = ReplayControlPayload.safeParse({ command: 'rewind' })
    expect(result.success).toBe(false)
  })

  it('accepts set_speed with speed parameter', () => {
    const result = ReplayControlPayload.safeParse({ command: 'set_speed', speed: 2 })
    expect(result.success).toBe(true)
  })

  it('accepts set_position with position parameter', () => {
    const result = ReplayControlPayload.safeParse({ command: 'set_position', position: 42 })
    expect(result.success).toBe(true)
  })

  it('rejects speed below minimum', () => {
    const result = ReplayControlPayload.safeParse({ command: 'set_speed', speed: 0.1 })
    expect(result.success).toBe(false)
  })

  it('rejects speed above maximum', () => {
    const result = ReplayControlPayload.safeParse({ command: 'set_speed', speed: 100 })
    expect(result.success).toBe(false)
  })
})

// ─── ReplayCardVisibilityPayload ──────────────────────────────────────────────

describe('ReplayCardVisibilityPayload', () => {
  it('accepts showAllCards toggle', () => {
    const result = ReplayCardVisibilityPayload.safeParse({ showAllCards: false })
    expect(result.success).toBe(true)
  })

  it('accepts per-player visibility', () => {
    const result = ReplayCardVisibilityPayload.safeParse({
      playerVisibility: {
        [PLAYER_A_ID]: true,
        [PLAYER_B_ID]: false,
      },
    })
    expect(result.success).toBe(true)
  })

  it('accepts empty object', () => {
    const result = ReplayCardVisibilityPayload.safeParse({})
    expect(result.success).toBe(true)
  })
})

// ─── ReplayFile ───────────────────────────────────────────────────────────────

describe('ReplayFile', () => {
  const validFile = {
    version: 1,
    gameConfig: {
      gameId: GAME_ID,
      gameName: 'Test Game',
      gameType: 'cash',
      smallBlindAmount: 5,
      bigBlindAmount: 10,
      maxPlayers: 6,
      startingStack: 1000,
    },
    players: [
      { id: PLAYER_A_ID, displayName: 'Alice', seatIndex: 0, role: 'player' },
      { id: PLAYER_B_ID, displayName: 'Bob', seatIndex: 1, role: 'player' },
    ],
    entries: [
      {
        index: 0,
        timestamp: 0,
        type: 'event' as const,
        event: { type: 'HAND_START', handNumber: 1, dealerSeatIndex: 0 },
        engineState: { pot: 0 },
      },
    ],
  }

  it('accepts valid replay file', () => {
    const result = ReplayFile.safeParse(validFile)
    expect(result.success).toBe(true)
  })

  it('rejects wrong version', () => {
    const result = ReplayFile.safeParse({ ...validFile, version: 2 })
    expect(result.success).toBe(false)
  })

  it('rejects missing entries', () => {
    const { entries, ...rest } = validFile
    const result = ReplayFile.safeParse(rest)
    expect(result.success).toBe(false)
  })

  it('accepts empty entries array', () => {
    const result = ReplayFile.safeParse({ ...validFile, entries: [] })
    expect(result.success).toBe(true)
  })
})
