/**
 * Unit tests for ReplayInstance playback engine.
 *
 * Tests step forward/backward, jump to round, play/pause,
 * speed control, card visibility, and independent spectators.
 */
import { ReplayInstance } from '../../server/src/replay/replay-manager'
import type { ReplayFile, Event, GameState } from '@pokerathome/schema'
import type { EngineState, GameConfig } from '../../server/src/engine/game'
import { createInitialState, addPlayer, startHand, cloneState } from '../../server/src/engine/game'

// ─── Helpers ──────────────────────────────────────────────────────────────────

const PLAYER_A = 'a0000000-0000-4000-8000-000000000001'
const PLAYER_B = 'a0000000-0000-4000-8000-000000000002'
const SPECTATOR = 'a0000000-0000-4000-8000-0000000000a1'

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

function setupState(withCards = false): EngineState {
  let state = createInitialState(makeConfig())
  state = addPlayer(state, PLAYER_A, 'Alice').state
  state = addPlayer(state, PLAYER_B, 'Bob').state
  if (withCards) {
    // Manually give players hole cards for card visibility tests
    state = {
      ...state,
      players: state.players.map(p => {
        if (p.id === PLAYER_A) return { ...p, holeCards: ['Ah', 'Kh'] as [string, string] }
        if (p.id === PLAYER_B) return { ...p, holeCards: ['Qs', 'Jd'] as [string, string] }
        return p
      }),
    }
  }
  return state
}

function makeReplayFile(entries: ReplayFile['entries']): ReplayFile {
  return {
    version: 1,
    gameConfig: {
      gameId: '11111111-1111-1111-1111-111111111111',
      gameName: 'Test Game',
      gameType: 'cash',
      smallBlindAmount: 5,
      bigBlindAmount: 10,
      maxPlayers: 6,
      startingStack: 1000,
    },
    players: [
      { id: PLAYER_A, displayName: 'Alice', seatIndex: 0, role: 'player' },
      { id: PLAYER_B, displayName: 'Bob', seatIndex: 1, role: 'player' },
    ],
    entries,
  }
}

function makeEventEntry(
  index: number,
  eventType: string,
  state: EngineState,
  timestamp = index * 100,
): ReplayFile['entries'][0] {
  return {
    index,
    timestamp,
    type: 'event' as const,
    event: { type: eventType, handNumber: 1 } as unknown as Event,
    engineState: cloneState(state) as unknown as Record<string, unknown>,
  }
}

function makeChatEntry(index: number, timestamp = index * 100): ReplayFile['entries'][0] {
  return {
    index,
    timestamp,
    type: 'chat' as const,
    chat: {
      playerId: PLAYER_A,
      displayName: 'Alice',
      message: `Chat ${index}`,
      timestamp: new Date().toISOString(),
    },
  }
}

// Mock SessionManager and Logger
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

function createInstance(entries: ReplayFile['entries']) {
  const { sessions, logger, sentMessages } = createMocks()
  const replay = makeReplayFile(entries)
  const instance = new ReplayInstance('replay-1', replay, sessions as any, logger as any)
  return { instance, sentMessages }
}

// ─── Standard replay entries for a hand ───────────────────────────────────────

function makeStandardEntries(): ReplayFile['entries'] {
  const state = setupState()
  return [
    makeEventEntry(0, 'HAND_START', state),
    makeEventEntry(1, 'BLINDS_POSTED', state),
    makeEventEntry(2, 'DEAL', state),
    makeEventEntry(3, 'PLAYER_ACTION', state),
    makeEventEntry(4, 'PLAYER_ACTION', state),
    makeEventEntry(5, 'FLOP', state),
    makeEventEntry(6, 'PLAYER_ACTION', state),
    makeEventEntry(7, 'PLAYER_ACTION', state),
    makeEventEntry(8, 'TURN', state),
    makeEventEntry(9, 'PLAYER_ACTION', state),
    makeEventEntry(10, 'RIVER', state),
    makeEventEntry(11, 'PLAYER_ACTION', state),
    makeEventEntry(12, 'SHOWDOWN', state),
    makeEventEntry(13, 'HAND_END', state),
  ]
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('ReplayInstance', () => {
  describe('addSpectator / removeSpectator', () => {
    it('adds a spectator and sends initial state', () => {
      const { instance, sentMessages } = createInstance(makeStandardEntries())
      instance.addSpectator(SPECTATOR)
      expect(sentMessages).toHaveLength(1)
      expect(sentMessages[0].playerId).toBe(SPECTATOR)
      expect(sentMessages[0].msg.action).toBe('replayState')
      expect(sentMessages[0].msg.payload.position).toBe(0)
    })

    it('removes a spectator', () => {
      const { instance, sentMessages } = createInstance(makeStandardEntries())
      instance.addSpectator(SPECTATOR)
      instance.removeSpectator(SPECTATOR)
      expect(instance.spectatorCount).toBe(0)
    })
  })

  describe('step_forward / step_backward', () => {
    it('steps forward by one position', () => {
      const { instance, sentMessages } = createInstance(makeStandardEntries())
      instance.addSpectator(SPECTATOR)
      sentMessages.length = 0

      instance.handleControl(SPECTATOR, 'step_forward')
      expect(sentMessages).toHaveLength(1)
      expect(sentMessages[0].msg.payload.position).toBe(1)
    })

    it('steps backward by one position', () => {
      const { instance, sentMessages } = createInstance(makeStandardEntries())
      instance.addSpectator(SPECTATOR)
      instance.handleControl(SPECTATOR, 'step_forward')
      instance.handleControl(SPECTATOR, 'step_forward')
      sentMessages.length = 0

      instance.handleControl(SPECTATOR, 'step_backward')
      expect(sentMessages).toHaveLength(1)
      expect(sentMessages[0].msg.payload.position).toBe(1)
    })

    it('does not step backward below 0', () => {
      const { instance, sentMessages } = createInstance(makeStandardEntries())
      instance.addSpectator(SPECTATOR)
      sentMessages.length = 0

      instance.handleControl(SPECTATOR, 'step_backward')
      expect(sentMessages[0].msg.payload.position).toBe(0)
    })

    it('does not step forward past end', () => {
      const entries = makeStandardEntries()
      const { instance, sentMessages } = createInstance(entries)
      instance.addSpectator(SPECTATOR)

      // Jump to end
      instance.handleControl(SPECTATOR, 'set_position', undefined, entries.length - 1)
      sentMessages.length = 0

      instance.handleControl(SPECTATOR, 'step_forward')
      expect(sentMessages[0].msg.payload.position).toBe(entries.length - 1)
    })
  })

  describe('jump_round_start', () => {
    it('jumps backward to the most recent round-start event', () => {
      const { instance, sentMessages } = createInstance(makeStandardEntries())
      instance.addSpectator(SPECTATOR)

      // Move to position 7 (PLAYER_ACTION after FLOP)
      instance.handleControl(SPECTATOR, 'set_position', undefined, 7)
      sentMessages.length = 0

      instance.handleControl(SPECTATOR, 'jump_round_start')
      // Should land on position 5 (FLOP)
      expect(sentMessages[0].msg.payload.position).toBe(5)
    })

    it('jumps to 0 if no previous round start', () => {
      const { instance, sentMessages } = createInstance(makeStandardEntries())
      instance.addSpectator(SPECTATOR)

      // Move to position 0 (HAND_START)
      sentMessages.length = 0
      instance.handleControl(SPECTATOR, 'jump_round_start')
      // Already at 0, can't go further back
      expect(sentMessages[0].msg.payload.position).toBe(0)
    })
  })

  describe('jump_next_round', () => {
    it('jumps forward to the next round-start event', () => {
      const { instance, sentMessages } = createInstance(makeStandardEntries())
      instance.addSpectator(SPECTATOR)
      sentMessages.length = 0

      // At position 0 (HAND_START), jump to next round
      instance.handleControl(SPECTATOR, 'jump_next_round')
      // Should land on position 5 (FLOP)
      expect(sentMessages[0].msg.payload.position).toBe(5)
    })

    it('jumps to end if no more round starts', () => {
      const entries = makeStandardEntries()
      const { instance, sentMessages } = createInstance(entries)
      instance.addSpectator(SPECTATOR)

      // Move to position 10 (RIVER), jump to next round
      instance.handleControl(SPECTATOR, 'set_position', undefined, 10)
      sentMessages.length = 0

      instance.handleControl(SPECTATOR, 'jump_next_round')
      // No more round starts after RIVER, should go to end
      expect(sentMessages[0].msg.payload.position).toBe(entries.length - 1)
    })
  })

  describe('set_position', () => {
    it('sets position directly', () => {
      const { instance, sentMessages } = createInstance(makeStandardEntries())
      instance.addSpectator(SPECTATOR)
      sentMessages.length = 0

      instance.handleControl(SPECTATOR, 'set_position', undefined, 5)
      expect(sentMessages[0].msg.payload.position).toBe(5)
    })

    it('clamps position to valid range', () => {
      const entries = makeStandardEntries()
      const { instance, sentMessages } = createInstance(entries)
      instance.addSpectator(SPECTATOR)
      sentMessages.length = 0

      instance.handleControl(SPECTATOR, 'set_position', undefined, 999)
      expect(sentMessages[0].msg.payload.position).toBe(entries.length - 1)
    })

    it('pauses playback when setting position', () => {
      const { instance, sentMessages } = createInstance(makeStandardEntries())
      instance.addSpectator(SPECTATOR)
      instance.handleControl(SPECTATOR, 'play')
      sentMessages.length = 0

      instance.handleControl(SPECTATOR, 'set_position', undefined, 5)
      expect(sentMessages[0].msg.payload.isPlaying).toBe(false)
    })
  })

  describe('set_speed', () => {
    it('sets speed', () => {
      const { instance, sentMessages } = createInstance(makeStandardEntries())
      instance.addSpectator(SPECTATOR)
      sentMessages.length = 0

      instance.handleControl(SPECTATOR, 'set_speed', 4)
      expect(sentMessages[0].msg.payload.speed).toBe(4)
    })

    it('clamps speed to valid range', () => {
      const { instance, sentMessages } = createInstance(makeStandardEntries())
      instance.addSpectator(SPECTATOR)
      sentMessages.length = 0

      instance.handleControl(SPECTATOR, 'set_speed', 0.1)
      expect(sentMessages[0].msg.payload.speed).toBe(0.25)
    })
  })

  describe('play / pause', () => {
    it('play sets isPlaying true', () => {
      const { instance, sentMessages } = createInstance(makeStandardEntries())
      instance.addSpectator(SPECTATOR)
      sentMessages.length = 0

      instance.handleControl(SPECTATOR, 'play')
      expect(sentMessages[0].msg.payload.isPlaying).toBe(true)
    })

    it('pause sets isPlaying false', () => {
      const { instance, sentMessages } = createInstance(makeStandardEntries())
      instance.addSpectator(SPECTATOR)
      instance.handleControl(SPECTATOR, 'play')
      sentMessages.length = 0

      instance.handleControl(SPECTATOR, 'pause')
      expect(sentMessages[0].msg.payload.isPlaying).toBe(false)
    })

    it('play advances position over time', async () => {
      const entries = makeStandardEntries()
      // Use short timestamps for fast test
      for (let i = 0; i < entries.length; i++) {
        entries[i].timestamp = i * 10 // 10ms apart
      }
      const { instance, sentMessages } = createInstance(entries)
      instance.addSpectator(SPECTATOR)
      sentMessages.length = 0

      instance.handleControl(SPECTATOR, 'play')

      // Wait a bit for timers to fire
      await new Promise(r => setTimeout(r, 200))

      // Should have advanced from position 0
      const lastMsg = sentMessages[sentMessages.length - 1]
      expect(lastMsg.msg.payload.position).toBeGreaterThan(0)

      // Cleanup
      instance.destroy()
    })
  })

  describe('card visibility', () => {
    /** Entries using a state with hole cards dealt to players */
    function makeEntriesWithCards(): ReplayFile['entries'] {
      const state = setupState(true) // withCards=true
      return [
        makeEventEntry(0, 'HAND_START', state),
        makeEventEntry(1, 'DEAL', state),
        makeEventEntry(2, 'PLAYER_ACTION', state),
      ]
    }

    it('default shows all cards', () => {
      const { instance, sentMessages } = createInstance(makeEntriesWithCards())
      instance.addSpectator(SPECTATOR)

      // Move to after DEAL
      instance.handleControl(SPECTATOR, 'step_forward')

      const payload = sentMessages[sentMessages.length - 1].msg.payload
      const players = payload.gameState.players.filter((p: any) => p.role !== 'spectator')
      const withCards = players.filter((p: any) => p.holeCards !== null)
      expect(withCards.length).toBeGreaterThan(0)
    })

    it('showAllCards=false hides cards', () => {
      const { instance, sentMessages } = createInstance(makeEntriesWithCards())
      instance.addSpectator(SPECTATOR)
      instance.handleControl(SPECTATOR, 'step_forward') // move to DEAL
      sentMessages.length = 0

      instance.handleCardVisibility(SPECTATOR, false)

      const payload = sentMessages[0].msg.payload
      const players = payload.gameState.players.filter((p: any) => p.role !== 'spectator')
      for (const p of players) {
        expect(p.holeCards).toBeNull()
      }
    })

    it('per-player visibility overrides showAllCards', () => {
      const { instance, sentMessages } = createInstance(makeEntriesWithCards())
      instance.addSpectator(SPECTATOR)
      instance.handleControl(SPECTATOR, 'step_forward') // move to DEAL
      sentMessages.length = 0

      // Hide all cards, but show Player A's
      instance.handleCardVisibility(SPECTATOR, false, { [PLAYER_A]: true })

      const payload = sentMessages[0].msg.payload
      const playerA = payload.gameState.players.find((p: any) => p.id === PLAYER_A)
      const playerB = payload.gameState.players.find((p: any) => p.id === PLAYER_B)
      expect(playerA?.holeCards).not.toBeNull() // explicitly shown
      expect(playerB?.holeCards).toBeNull() // hidden by showAllCards=false
    })
  })

  describe('independent spectators', () => {
    const SPECTATOR_2 = 'a0000000-0000-4000-8000-0000000000a2'

    it('spectators have independent positions', () => {
      const { instance, sentMessages } = createInstance(makeStandardEntries())
      instance.addSpectator(SPECTATOR)
      instance.addSpectator(SPECTATOR_2)
      sentMessages.length = 0

      // Move spectator 1 forward
      instance.handleControl(SPECTATOR, 'step_forward')
      instance.handleControl(SPECTATOR, 'step_forward')

      // Check spectator 2 is still at 0
      // Get last message for SPECTATOR_2 (initial state)
      const spec2Initial = sentMessages.filter(m => m.playerId === SPECTATOR_2)
      // Spectator 2 should still be at position 0 (their initial position was sent in addSpectator)
      // Actually spec2Initial is empty because we cleared sentMessages after both were added
      // Let's resend state for spec2
      instance.handleControl(SPECTATOR_2, 'step_forward')
      const spec2Msg = sentMessages.filter(m => m.playerId === SPECTATOR_2).pop()
      expect(spec2Msg?.msg.payload.position).toBe(1) // moved from 0 to 1

      // Spectator 1 should be at position 2
      const spec1Msg = sentMessages.filter(m => m.playerId === SPECTATOR).pop()
      expect(spec1Msg?.msg.payload.position).toBe(2)
    })

    it('spectators have independent speeds', () => {
      const { instance, sentMessages } = createInstance(makeStandardEntries())
      instance.addSpectator(SPECTATOR)
      instance.addSpectator(SPECTATOR_2)
      sentMessages.length = 0

      instance.handleControl(SPECTATOR, 'set_speed', 4)

      const spec1Msg = sentMessages.filter(m => m.playerId === SPECTATOR).pop()
      expect(spec1Msg?.msg.payload.speed).toBe(4)

      // Spectator 2's speed should still be 1 (default)
      instance.handleControl(SPECTATOR_2, 'step_forward') // trigger a message
      const spec2Msg = sentMessages.filter(m => m.playerId === SPECTATOR_2).pop()
      expect(spec2Msg?.msg.payload.speed).toBe(1)
    })
  })

  describe('chat entries', () => {
    it('sends chat data for chat entries', () => {
      const state = setupState()
      const entries: ReplayFile['entries'] = [
        makeEventEntry(0, 'HAND_START', state),
        makeChatEntry(1),
        makeEventEntry(2, 'DEAL', state),
      ]
      const { instance, sentMessages } = createInstance(entries)
      instance.addSpectator(SPECTATOR)
      sentMessages.length = 0

      instance.handleControl(SPECTATOR, 'step_forward') // move to chat entry
      const payload = sentMessages[0].msg.payload
      expect(payload.chat).toBeDefined()
      expect(payload.chat.message).toBe('Chat 1')
      // Should still have gameState (from previous event entry)
      expect(payload.gameState).toBeDefined()
    })
  })

  describe('destroy', () => {
    it('cleans up all timers and spectators', async () => {
      const entries = makeStandardEntries()
      for (let i = 0; i < entries.length; i++) {
        entries[i].timestamp = i * 10
      }
      const { instance } = createInstance(entries)
      instance.addSpectator(SPECTATOR)
      instance.handleControl(SPECTATOR, 'play')

      instance.destroy()
      expect(instance.spectatorCount).toBe(0)

      // Verify no errors from dangling timers
      await new Promise(r => setTimeout(r, 100))
    })
  })
})
