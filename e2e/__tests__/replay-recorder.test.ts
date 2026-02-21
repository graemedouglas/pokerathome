/**
 * Unit tests for ReplayRecorder.
 *
 * Tests recording events, chat messages, player tracking,
 * and serialization to ReplayFile format.
 */
import { ReplayRecorder } from '../../server/src/replay/recorder'
import type { Event, ChatMessagePayload } from '@pokerathome/schema'
import { ReplayFile } from '@pokerathome/schema'
import type { GameConfig, EngineState } from '../../server/src/engine/game'
import { createInitialState, addPlayer, startHand } from '../../server/src/engine/game'

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeConfig(): GameConfig {
  return {
    gameId: 'a1111111-1111-4111-8111-111111111111',
    gameName: 'Test Game',
    gameType: 'cash',
    smallBlindAmount: 5,
    bigBlindAmount: 10,
    maxPlayers: 6,
    startingStack: 1000,
  }
}

const PLAYER_A = 'a0000000-0000-4000-8000-000000000001'
const PLAYER_B = 'a0000000-0000-4000-8000-000000000002'

function setupState(): EngineState {
  const config = makeConfig()
  let state = createInitialState(config)
  state = addPlayer(state, PLAYER_A, 'Alice').state
  state = addPlayer(state, PLAYER_B, 'Bob').state
  return state
}

function makeEvent(type: string, overrides = {}): Event {
  return { type, ...overrides } as unknown as Event
}

function makeChat(): ChatMessagePayload {
  return {
    playerId: PLAYER_A,
    displayName: 'Alice',
    message: 'Hello!',
    timestamp: new Date().toISOString(),
    role: 'player',
  }
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('ReplayRecorder', () => {
  it('starts with zero entries', () => {
    const recorder = new ReplayRecorder(makeConfig())
    expect(recorder.entryCount).toBe(0)
  })

  it('records events with engine state snapshots', () => {
    const recorder = new ReplayRecorder(makeConfig())
    const state = setupState()
    const event = makeEvent('HAND_START', { handNumber: 1 })

    recorder.recordEvent(event, state)

    expect(recorder.entryCount).toBe(1)
    const file = recorder.toReplayFile() as any
    expect(file.entries[0].type).toBe('event')
    expect(file.entries[0].event.type).toBe('HAND_START')
    expect(file.entries[0].engineState).toBeDefined()
    expect(file.entries[0].index).toBe(0)
    expect(file.entries[0].timestamp).toBeGreaterThanOrEqual(0)
  })

  it('records chat messages', () => {
    const recorder = new ReplayRecorder(makeConfig())
    const chat = makeChat()

    recorder.recordChat(chat)

    expect(recorder.entryCount).toBe(1)
    const file = recorder.toReplayFile() as any
    expect(file.entries[0].type).toBe('chat')
    expect(file.entries[0].chat.message).toBe('Hello!')
    expect(file.entries[0].chat.displayName).toBe('Alice')
  })

  it('tracks players', () => {
    const recorder = new ReplayRecorder(makeConfig())
    recorder.recordPlayer(PLAYER_A, 'Alice', 0, 'player')
    recorder.recordPlayer(PLAYER_B, 'Bob', 1, 'player')

    const file = recorder.toReplayFile() as any
    expect(file.players).toHaveLength(2)
    expect(file.players[0]).toEqual({ id: PLAYER_A, displayName: 'Alice', seatIndex: 0, role: 'player' })
    expect(file.players[1]).toEqual({ id: PLAYER_B, displayName: 'Bob', seatIndex: 1, role: 'player' })
  })

  it('deduplicates players by id', () => {
    const recorder = new ReplayRecorder(makeConfig())
    recorder.recordPlayer(PLAYER_A, 'Alice', 0, 'player')
    recorder.recordPlayer(PLAYER_A, 'Alice', 0, 'player')

    const file = recorder.toReplayFile() as any
    expect(file.players).toHaveLength(1)
  })

  it('serializes to valid ReplayFile format', () => {
    const recorder = new ReplayRecorder(makeConfig())
    let state = setupState()

    recorder.recordPlayer(PLAYER_A, 'Alice', 0, 'player')
    recorder.recordPlayer(PLAYER_B, 'Bob', 1, 'player')

    // Use real engine events for valid schema
    const transitions = startHand(state)
    for (const t of transitions) {
      state = t.state
      recorder.recordEvent(t.event, state)
    }
    recorder.recordChat(makeChat())

    const file = recorder.toReplayFile()
    const result = ReplayFile.safeParse(file)
    if (!result.success) {
      // eslint-disable-next-line no-console
      console.error('ReplayFile validation errors:', JSON.stringify(result.error.issues, null, 2))
    }
    expect(result.success).toBe(true)
  })

  it('includes correct game config in ReplayFile', () => {
    const config = makeConfig()
    const recorder = new ReplayRecorder(config)
    const file = recorder.toReplayFile() as any

    expect(file.version).toBe(1)
    expect(file.gameConfig.gameId).toBe(config.gameId)
    expect(file.gameConfig.gameName).toBe(config.gameName)
    expect(file.gameConfig.gameType).toBe(config.gameType)
    expect(file.gameConfig.smallBlindAmount).toBe(config.smallBlindAmount)
    expect(file.gameConfig.bigBlindAmount).toBe(config.bigBlindAmount)
    expect(file.gameConfig.maxPlayers).toBe(config.maxPlayers)
    expect(file.gameConfig.startingStack).toBe(config.startingStack)
  })

  it('assigns sequential indices to entries', () => {
    const recorder = new ReplayRecorder(makeConfig())
    const state = setupState()

    recorder.recordEvent(makeEvent('HAND_START', { handNumber: 1 }), state)
    recorder.recordChat(makeChat())
    recorder.recordEvent(makeEvent('DEAL'), state)

    const file = recorder.toReplayFile() as any
    expect(file.entries.map((e: any) => e.index)).toEqual([0, 1, 2])
  })

  it('assigns non-decreasing timestamps', () => {
    const recorder = new ReplayRecorder(makeConfig())
    const state = setupState()

    recorder.recordEvent(makeEvent('HAND_START', { handNumber: 1 }), state)
    recorder.recordEvent(makeEvent('DEAL'), state)
    recorder.recordChat(makeChat())

    const file = recorder.toReplayFile() as any
    const timestamps = file.entries.map((e: any) => e.timestamp)
    for (let i = 1; i < timestamps.length; i++) {
      expect(timestamps[i]).toBeGreaterThanOrEqual(timestamps[i - 1])
    }
  })

  it('deep-clones engine state to prevent mutation', () => {
    const recorder = new ReplayRecorder(makeConfig())
    const state = setupState()

    recorder.recordEvent(makeEvent('HAND_START', { handNumber: 1 }), state)

    // Mutate the original state
    state.pot = 999
    state.communityCards.push('Ah')
    state.players[0].stack = 0

    const file = recorder.toReplayFile() as any
    const snapshot = file.entries[0].engineState
    expect(snapshot.pot).toBe(0) // original pot, not mutated
    expect(snapshot.communityCards).toEqual([]) // not mutated
    expect(snapshot.players[0].stack).toBe(1000) // not mutated
  })
})
