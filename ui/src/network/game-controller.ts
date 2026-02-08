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
import { NUM_SEATS } from '../constants'

export type GameControllerEvent =
  | { type: 'gameStarted' }
  | { type: 'gameOver'; reason: string }
  | { type: 'error'; message: string }

export type GameControllerEventHandler = (event: GameControllerEvent) => void

export class GameController {
  private renderer: GameRenderer | null = null
  private ws: WsClient
  private isSpectator: boolean
  private myPlayerId = ''
  private currentHandNumber = 0
  private sbPlayerId?: string
  private bbPlayerId?: string
  private showdownResults = new Map<string, string>()
  private lastServerState: ServerGameState | null = null
  private lastUiState: GameState | null = null
  private eventHandlers: GameControllerEventHandler[] = []
  private started = false
  private pendingActionRequest = false

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
      if (!this.renderer) {
        this.buffered.push(msg)
        return
      }
      this.chain = this.chain
        .then(() => this.handleMessage(msg))
        .catch(err => console.error('[GameController] message error:', err))
    })
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

    // Track blind positions from events
    const blindInfo = extractBlindPlayers(event)
    if (blindInfo.sbPlayerId) this.sbPlayerId = blindInfo.sbPlayerId
    if (blindInfo.bbPlayerId) this.bbPlayerId = blindInfo.bbPlayerId

    // Track showdown results for hand descriptions
    if (event.type === 'SHOWDOWN') {
      this.showdownResults.clear()
      for (const r of event.results) {
        this.showdownResults.set(r.playerId, r.handDescription)
      }
    }

    // Build winner info from HAND_END
    let winners: WinnerInfo[] | undefined
    if (event.type === 'HAND_END') {
      winners = extractWinners(event, serverState.players, this.showdownResults)
    }

    const ctx: AdapterContext = {
      myPlayerId: this.myPlayerId,
      sbPlayerId: this.sbPlayerId,
      bbPlayerId: this.bbPlayerId,
      winners,
    }

    const uiState = adaptGameState(serverState, ctx)
    this.lastUiState = uiState

    // Handle event-driven animations
    await this.processEvent(event, serverState, uiState)

    // Handle action request (it's our turn) -- spectators never act
    if (actionRequest && !this.pendingActionRequest && !this.isSpectator) {
      this.pendingActionRequest = true
      const available = adaptActionRequest(actionRequest)

      try {
        const uiAction = await this.renderer!.waitForHumanAction(available, serverState.pot)
        const serverAction = adaptPlayerAction(uiAction, this.currentHandNumber, available)
        this.ws.send('playerAction', serverAction as Record<string, unknown>)
      } finally {
        this.pendingActionRequest = false
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
        this.showdownResults.clear()
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
