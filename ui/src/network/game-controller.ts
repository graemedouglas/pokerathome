import type { ServerMessage } from '@pokerathome/schema'
import type {
  GameState as ServerGameState,
  GameStateUpdatePayload,
  Event as ServerEvent,
} from '@pokerathome/schema'
import type { GameRenderer } from '../renderer/GameRenderer'
import type { WsClient } from './ws-client'
import type { GameState, WinnerInfo } from '../types'
import {
  adaptGameState, adaptActionRequest, adaptPlayerAction,
  extractBlindPlayers, extractWinners, adaptCard,
  type AdapterContext,
} from '../adapter'
import { NUM_SEATS, SHOWDOWN_DELAY } from '../constants'
import { delay } from '../utils/Animations'

export type GameControllerEvent =
  | { type: 'gameStarted' }
  | { type: 'gameOver'; reason: string }
  | { type: 'error'; message: string }

export type GameControllerEventHandler = (event: GameControllerEvent) => void

/**
 * Per-hand accumulated state. Reset atomically on HAND_START so nothing
 * from a previous hand can leak into the next one.
 */
interface HandContext {
  cardsDealt: boolean
  sbPlayerId?: string
  bbPlayerId?: string
  /** Hand descriptions from SHOWDOWN results, keyed by server playerId */
  showdownResults: Map<string, string>
  /** Opponent hole cards revealed at SHOWDOWN, keyed by server playerId */
  showdownHoleCards: Map<string, [string, string]>
}

function freshHandContext(): HandContext {
  return {
    cardsDealt: false,
    showdownResults: new Map(),
    showdownHoleCards: new Map(),
  }
}

export class GameController {
  private renderer: GameRenderer | null = null
  private ws: WsClient
  private isSpectator: boolean
  private myPlayerId = ''
  private currentHandNumber = 0
  private lastServerState: ServerGameState | null = null
  private lastUiState: GameState | null = null
  private eventHandlers: GameControllerEventHandler[] = []
  private started = false
  private pendingActionRequest = false
  private actionCancelled = false

  /** All per-hand state lives here — nuked on HAND_START */
  private hand: HandContext = freshHandContext()

  // Message processing chain — ensures sequential handling
  private chain: Promise<void> = Promise.resolve()
  private buffered: ServerMessage[] = []

  constructor(ws: WsClient, isSpectator = false) {
    this.ws = ws
    this.isSpectator = isSpectator
  }

  setPlayerId(playerId: string): void {
    this.myPlayerId = playerId
  }

  onEvent(handler: GameControllerEventHandler): () => void {
    this.eventHandlers.push(handler)
    return () => {
      this.eventHandlers = this.eventHandlers.filter(h => h !== handler)
    }
  }

  private emit(event: GameControllerEvent): void {
    for (const handler of this.eventHandlers) handler(event)
  }

  /** Start listening for WS messages. Buffers them until a renderer is attached. */
  start(): void {
    this.ws.onMessage((msg) => {
      // Handle timeWarning synchronously — it's just a display update, not state
      if (msg.action === 'timeWarning') {
        const payload = msg.payload as { remainingMs: number }
        this.renderer?.updateTimer(payload.remainingMs)
        return
      }

      // If we have a pending action and the server says our player timed out,
      // cancel the action immediately (before queuing) to prevent chain deadlock
      if (msg.action === 'gameState' && this.pendingActionRequest) {
        const payload = msg.payload as GameStateUpdatePayload
        if (payload.event.type === 'PLAYER_TIMEOUT') {
          const evt = payload.event as { type: string; playerId: string }
          if (evt.playerId === this.myPlayerId) {
            this.cancelPendingAction()
          }
        }
      }

      if (!this.renderer) {
        this.buffered.push(msg)
        return
      }
      this.chain = this.chain
        .then(() => this.handleMessage(msg))
        .catch(err => console.error('[GameController] message error:', err))
    })
  }

  private cancelPendingAction(): void {
    this.actionCancelled = true
    this.renderer?.cancelHumanAction()
  }

  /** Attach the renderer and flush any buffered messages. */
  attachRenderer(renderer: GameRenderer, initialState?: GameStateUpdatePayload): void {
    this.renderer = renderer

    // Process initial state first (if any)
    if (initialState) {
      this.chain = this.chain
        .then(() => this.handleGameState(initialState))
        .catch(err => console.error('[GameController] initial state error:', err))
    }

    // Then drain buffered messages in order
    for (const msg of this.buffered) {
      this.chain = this.chain
        .then(() => this.handleMessage(msg))
        .catch(err => console.error('[GameController] buffered message error:', err))
    }
    this.buffered = []
  }

  private async handleMessage(msg: ServerMessage): Promise<void> {
    switch (msg.action) {
      case 'gameState':
        await this.handleGameState(msg.payload as GameStateUpdatePayload)
        break
      case 'gameOver':
        this.emit({ type: 'gameOver', reason: (msg.payload as { reason: string }).reason })
        break
      case 'error':
        this.emit({ type: 'error', message: (msg.payload as { message: string }).message })
        break
      case 'chatMessage': {
        const chat = msg.payload as { playerId: string; displayName: string; message: string; timestamp: string }
        this.renderer!.addChatMessage({
          displayName: chat.displayName,
          message: chat.message,
          timestamp: chat.timestamp,
        })
        break
      }
    }
  }

  private async handleGameState(payload: GameStateUpdatePayload): Promise<void> {
    const { gameState: serverState, event, actionRequest } = payload

    this.lastServerState = serverState
    this.currentHandNumber = serverState.handNumber

    // --- Accumulate per-hand state BEFORE adaptGameState ---

    // HAND_START: nuke everything from the previous hand
    if (event.type === 'HAND_START') {
      this.hand = freshHandContext()
    }

    // Blinds
    const blindInfo = extractBlindPlayers(event)
    if (blindInfo.sbPlayerId) this.hand.sbPlayerId = blindInfo.sbPlayerId
    if (blindInfo.bbPlayerId) this.hand.bbPlayerId = blindInfo.bbPlayerId

    // Deal
    if (event.type === 'DEAL') {
      this.hand.cardsDealt = true
    }

    // Showdown — reveal opponent cards + hand descriptions
    if (event.type === 'SHOWDOWN') {
      for (const r of event.results) {
        this.hand.showdownResults.set(r.playerId, r.handDescription)
        if (r.holeCards) {
          this.hand.showdownHoleCards.set(r.playerId, r.holeCards as [string, string])
        }
      }
    }

    // Build winner info from HAND_END
    let winners: WinnerInfo[] | undefined
    if (event.type === 'HAND_END') {
      winners = extractWinners(event, serverState.players, this.hand.showdownResults)
    }

    const ctx: AdapterContext = {
      myPlayerId: this.myPlayerId,
      sbPlayerId: this.hand.sbPlayerId,
      bbPlayerId: this.hand.bbPlayerId,
      winners,
      cardsDealt: this.hand.cardsDealt,
      showdownHoleCards: this.hand.showdownHoleCards.size > 0
        ? this.hand.showdownHoleCards
        : undefined,
    }

    const uiState = adaptGameState(serverState, ctx)
    this.lastUiState = uiState

    // Handle event-driven animations
    await this.processEvent(event, serverState, uiState)

    // Handle action request (it's our turn) -- spectators never act
    if (actionRequest && !this.pendingActionRequest && !this.isSpectator) {
      this.pendingActionRequest = true
      this.actionCancelled = false
      const available = adaptActionRequest(actionRequest)

      try {
        const uiAction = await this.renderer!.waitForHumanAction(
          available, serverState.pot, actionRequest.timeToActMs,
        )
        if (!this.actionCancelled) {
          const serverAction = adaptPlayerAction(uiAction, this.currentHandNumber, available)
          this.ws.send('playerAction', serverAction as Record<string, unknown>)
        }
      } finally {
        this.pendingActionRequest = false
        this.actionCancelled = false
      }
    }
  }

  private async processEvent(
    event: ServerEvent,
    serverState: ServerGameState,
    uiState: GameState,
  ): Promise<void> {
    const r = this.renderer!
    switch (event.type) {
      case 'HAND_START': {
        if (!this.started) {
          this.started = true
          this.emit({ type: 'gameStarted' })
        }
        r.resetForNewHand()
        r.addLog(`--- Hand #${event.handNumber} ---`)
        r.update(uiState)
        break
      }

      case 'BLINDS_POSTED': {
        const sbName = serverState.players.find(p => p.id === event.smallBlind.playerId)?.displayName ?? '?'
        const bbName = serverState.players.find(p => p.id === event.bigBlind.playerId)?.displayName ?? '?'
        r.addLog(`${sbName} posts SB $${event.smallBlind.amount}`)
        r.addLog(`${bbName} posts BB $${event.bigBlind.amount}`)
        r.update(uiState)
        break
      }

      case 'DEAL': {
        await r.animatePhaseChange('preflop')
        r.update(uiState)
        break
      }

      case 'FLOP': {
        await r.animatePhaseChange('flop')
        const flopCards = event.cards.map(adaptCard)
        await r.animateCommunityReveal(flopCards, 0)
        r.update(uiState)
        break
      }

      case 'TURN': {
        await r.animatePhaseChange('turn')
        const turnCard = adaptCard(event.card)
        await r.animateCommunityReveal([turnCard], 3)
        r.update(uiState)
        break
      }

      case 'RIVER': {
        await r.animatePhaseChange('river')
        const riverCard = adaptCard(event.card)
        await r.animateCommunityReveal([riverCard], 4)
        r.update(uiState)
        break
      }

      case 'PLAYER_ACTION': {
        const player = serverState.players.find(p => p.id === event.playerId)
        if (player) {
          const actionStr = event.action.type.toLowerCase()
          const amountStr = event.action.amount ? ` $${event.action.amount}` : ''
          r.addLog(`${player.displayName} ${actionStr}s${amountStr}`)

          // Juicy action pop text
          const { text: popText, color: popColor } = getActionPopInfo(event.action)
          r.showPlayerActionPop(player.seatIndex, popText, popColor)
        }
        r.update(uiState)
        break
      }

      case 'PLAYER_TIMEOUT': {
        const player = serverState.players.find(p => p.id === event.playerId)
        if (player) {
          r.addLog(`${player.displayName} timed out`)
        }
        r.update(uiState)
        break
      }

      case 'SHOWDOWN': {
        await r.animatePhaseChange('showdown')
        r.update(uiState)
        break
      }

      case 'HAND_END': {
        r.update(uiState)
        const winnerIndices = uiState.winners.map(w => w.playerIndex)
        if (winnerIndices.length > 0) {
          for (const w of uiState.winners) {
            const player = uiState.players.find(p => p.seatIndex === w.playerIndex)
            if (player) {
              r.addLog(`${player.name} wins $${w.amount} - ${w.handDescription}`)
            }
          }
          // Hold on showdown cards before showing winner banner
          if (this.hand.showdownResults.size > 0) {
            await delay(SHOWDOWN_DELAY)
          }
          await r.animateWinners(winnerIndices)
        }
        break
      }

      case 'PLAYER_JOINED': {
        r.addLog(`${event.displayName} joined`)
        r.update(uiState)
        break
      }

      case 'PLAYER_LEFT': {
        const player = serverState.players.find(p => p.id === event.playerId)
        r.addLog(`${player?.displayName ?? 'Player'} left`)
        r.update(uiState)
        break
      }

      default:
        r.update(uiState)
        break
    }
  }

}

/** Map server action to pop-text label and color */
export function getActionPopInfo(action: { type: string; amount?: number }): { text: string; color: number } {
  switch (action.type) {
    case 'FOLD':    return { text: 'FOLD',                          color: 0xef4444 }
    case 'CHECK':   return { text: 'CHECK',                         color: 0x60a5fa }
    case 'CALL':    return { text: `CALL $${action.amount ?? 0}`,   color: 0x4ade80 }
    case 'BET':     return { text: `BET $${action.amount ?? 0}`,    color: 0xfbbf24 }
    case 'RAISE':   return { text: `RAISE $${action.amount ?? 0}`,  color: 0xfbbf24 }
    case 'ALL_IN':  return { text: 'ALL IN',                        color: 0xff6644 }
    default:        return { text: action.type,                     color: 0xffffff }
  }
}
