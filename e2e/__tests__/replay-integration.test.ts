/**
 * Integration tests: record a game through the engine, produce a replay file,
 * load it into a ReplayInstance, and verify states match.
 */
import { ReplayRecorder } from '../../server/src/replay/recorder'
import { ReplayInstance } from '../../server/src/replay/replay-manager'
import { ReplayFile } from '@pokerathome/schema'
import type { GameConfig } from '../../server/src/engine/game'
import {
  createInitialState,
  addPlayer,
  startHand,
  processAction,
} from '../../server/src/engine/game'
import { getAvailableActions } from '../../server/src/engine/action-validator'

// ─── Helpers ──────────────────────────────────────────────────────────────────

const PLAYER_A = 'a0000000-0000-4000-8000-000000000001'
const PLAYER_B = 'a0000000-0000-4000-8000-000000000002'
const SPECTATOR = 'a0000000-0000-4000-8000-0000000000a1'

function makeConfig(): GameConfig {
  return {
    gameId: 'a1111111-1111-4111-8111-111111111111',
    gameName: 'Integration Test',
    gameType: 'cash',
    smallBlindAmount: 5,
    bigBlindAmount: 10,
    maxPlayers: 6,
    startingStack: 1000,
  }
}

function createMocks() {
  const sentMessages: Array<{ playerId: string; msg: any }> = []
  const sessions = {
    send: (playerId: string, msg: any) => sentMessages.push({ playerId, msg }),
    getSession: () => null,
    registerSession: () => {},
    removeSession: () => {},
  }
  const logger = {
    info: () => {},
    warn: () => {},
    error: () => {},
    debug: () => {},
    fatal: () => {},
    trace: () => {},
    child: () => logger,
    level: 'info',
    silent: () => {},
  }
  return { sessions, logger, sentMessages }
}

/**
 * Pick a passive action using the engine's available actions.
 * Prefers CHECK > CALL > FOLD.
 */
function pickPassiveAction(state: any, playerId: string): string {
  const available = getAvailableActions(state, playerId)
  const types = available.map(a => a.type)
  if (types.includes('CHECK')) return 'CHECK'
  if (types.includes('CALL')) return 'CALL'
  return 'FOLD'
}

/**
 * Run a simple game through the engine, recording events.
 * Returns the replay file and the count of recorded transitions.
 */
function playAndRecord(): {
  replayFile: object
  transitionCount: number
} {
  const config = makeConfig()
  const recorder = new ReplayRecorder(config)
  let state = createInitialState(config)

  // Add players
  const addA = addPlayer(state, PLAYER_A, 'Alice')
  state = addA.state
  recorder.recordPlayer(PLAYER_A, 'Alice', addA.seatIndex, 'player')
  recorder.recordEvent(addA.event, state)

  const addB = addPlayer(state, PLAYER_B, 'Bob')
  state = addB.state
  recorder.recordPlayer(PLAYER_B, 'Bob', addB.seatIndex, 'player')
  recorder.recordEvent(addB.event, state)

  // Start a hand — use a fixed deck for determinism
  const fixedDeck = [
    'Ah', 'Kh', 'Qs', 'Jd', // hole cards: Alice(Ah, Qs), Bob(Kh, Jd)
    '2c', '3c', '4c',       // flop
    '5c',                     // turn
    '6c',                     // river
  ]
  let transitionCount = 0
  const handTransitions = startHand(state, fixedDeck)

  for (const t of handTransitions) {
    state = t.state
    recorder.recordEvent(t.event, state)
    transitionCount++
  }

  // Add a chat during the hand
  recorder.recordChat({
    playerId: PLAYER_A,
    displayName: 'Alice',
    message: 'Nice cards!',
    timestamp: new Date().toISOString(),
    role: 'player',
  })

  // Play actions using engine's available action logic
  let iterations = 0
  while (state.handInProgress && state.activePlayerId) {
    const action = pickPassiveAction(state, state.activePlayerId)
    const actionTransitions = processAction(state, state.activePlayerId, action)
    for (const t of actionTransitions) {
      state = t.state
      recorder.recordEvent(t.event, state)
      transitionCount++
    }

    iterations++
    if (iterations > 50) break // safety
    if (!state.handInProgress) break
  }

  return { replayFile: recorder.toReplayFile(), transitionCount }
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('Replay Integration', () => {
  // Run the game once and share across all tests to avoid OOM
  let replayFile: object
  let transitionCount: number

  beforeAll(() => {
    const result = playAndRecord()
    replayFile = result.replayFile
    transitionCount = result.transitionCount
  })

  it('records and produces a valid ReplayFile', () => {
    const result = ReplayFile.safeParse(replayFile)
    if (!result.success) {
      // eslint-disable-next-line no-console
      console.error('ReplayFile validation errors:', JSON.stringify(result.error.issues, null, 2))
    }
    expect(result.success).toBe(true)
  })

  it('replay file contains all transitions', () => {
    const file = replayFile as any
    const eventEntries = file.entries.filter((e: any) => e.type === 'event')
    // Event entries include player joins (2) + hand transitions + action transitions
    expect(eventEntries.length).toBeGreaterThanOrEqual(transitionCount)
  })

  it('replay file contains chat entries', () => {
    const file = replayFile as any
    const chatEntries = file.entries.filter((e: any) => e.type === 'chat')
    expect(chatEntries.length).toBe(1)
    expect(chatEntries[0].chat.message).toBe('Nice cards!')
  })

  it('can load replay into ReplayInstance and step through all events', () => {
    const file = replayFile as ReplayFile
    const { sessions, logger, sentMessages } = createMocks()

    const instance = new ReplayInstance('replay-1', file, sessions as any, logger as any)
    instance.addSpectator(SPECTATOR)

    // Step through all entries
    for (let i = 1; i < file.entries.length; i++) {
      sentMessages.length = 0
      instance.handleControl(SPECTATOR, 'step_forward')

      expect(sentMessages).toHaveLength(1)
      expect(sentMessages[0].msg.payload.position).toBe(i)
      expect(sentMessages[0].msg.payload.gameState).toBeDefined()
    }

    instance.destroy()
  })

  it('replay states have correct hand numbers', () => {
    const file = replayFile as ReplayFile
    const { sessions, logger, sentMessages } = createMocks()

    const instance = new ReplayInstance('replay-1', file, sessions as any, logger as any)
    instance.addSpectator(SPECTATOR)

    // The initial state should have handNumber 0 (before any hand starts)
    const initialPayload = sentMessages[0].msg.payload
    expect(initialPayload.gameState).toBeDefined()

    // Step to find HAND_START event
    let handStartFound = false
    for (let i = 1; i < file.entries.length; i++) {
      instance.handleControl(SPECTATOR, 'step_forward')
      const msg = sentMessages[sentMessages.length - 1].msg.payload
      if (msg.event?.type === 'HAND_START') {
        handStartFound = true
        expect(msg.handNumber).toBe(1)
        break
      }
    }
    expect(handStartFound).toBe(true)

    instance.destroy()
  })

  it('card visibility changes work on replay states', () => {
    const file = replayFile as ReplayFile
    const { sessions, logger, sentMessages } = createMocks()

    const instance = new ReplayInstance('replay-1', file, sessions as any, logger as any)
    instance.addSpectator(SPECTATOR)

    // Find a position after DEAL where players have cards
    for (let i = 1; i < file.entries.length; i++) {
      instance.handleControl(SPECTATOR, 'step_forward')
      const entry = file.entries[i]
      if (entry.type === 'event' && entry.event?.type === 'DEAL') break
    }

    // Default: all cards shown
    sentMessages.length = 0
    instance.sendStateToSpectator(SPECTATOR)
    let payload = sentMessages[sentMessages.length - 1].msg.payload
    const activePlayers = payload.gameState.players.filter((p: any) => p.role !== 'spectator')
    const cardsShown = activePlayers.filter((p: any) => p.holeCards !== null)
    expect(cardsShown.length).toBeGreaterThan(0)

    // Hide all cards
    sentMessages.length = 0
    instance.handleCardVisibility(SPECTATOR, false)
    payload = sentMessages[sentMessages.length - 1].msg.payload
    const allHidden = payload.gameState.players
      .filter((p: any) => p.role !== 'spectator')
      .every((p: any) => p.holeCards === null)
    expect(allHidden).toBe(true)

    // Show just Player A's cards
    sentMessages.length = 0
    instance.handleCardVisibility(SPECTATOR, false, { [PLAYER_A]: true })
    payload = sentMessages[sentMessages.length - 1].msg.payload
    const playerA = payload.gameState.players.find((p: any) => p.id === PLAYER_A)
    const playerB = payload.gameState.players.find((p: any) => p.id === PLAYER_B)
    expect(playerA?.holeCards).not.toBeNull()
    expect(playerB?.holeCards).toBeNull()

    instance.destroy()
  })
})
