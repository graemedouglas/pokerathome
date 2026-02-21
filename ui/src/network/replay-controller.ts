import type { ServerMessage, ReplayStatePayload, Event as ServerEvent, GameState as ServerGameState } from '@pokerathome/schema'
import type { GameRenderer } from '../renderer/GameRenderer'
import type { WsClient } from './ws-client'
import type { GameState, WinnerInfo } from '../types'
import {
  adaptGameState, adaptCard, extractBlindPlayers, extractWinners,
  type AdapterContext,
} from '../adapter'
import { delay } from '../utils/Animations'
import { SHOWDOWN_DELAY } from '../constants'
import { getActionPopInfo } from './game-controller'

export type ReplayStateHandler = (payload: ReplayStatePayload) => void

interface HandContext {
  cardsDealt: boolean
  sbPlayerId?: string
  bbPlayerId?: string
  showdownResults: Map<string, string>
  showdownHoleCards: Map<string, [string, string]>
}

function freshHandContext(): HandContext {
  return {
    cardsDealt: false,
    showdownResults: new Map(),
    showdownHoleCards: new Map(),
  }
}

/**
 * Client-side controller for replay games.
 * Handles `replayState` messages from the server and drives the renderer.
 */
export class ReplayController {
  private renderer: GameRenderer | null = null
  private ws: WsClient
  private myPlayerId = ''
  private hand: HandContext = freshHandContext()
  private lastHandNumber = 0
  private lastPosition = -1
  private chain: Promise<void> = Promise.resolve()
  private buffered: ServerMessage[] = []
  private stateHandlers: ReplayStateHandler[] = []
  private replayPlayers: Array<{ id: string; displayName: string }> = []

  constructor(ws: WsClient) {
    this.ws = ws
  }

  setPlayerId(playerId: string): void {
    this.myPlayerId = playerId
  }

  setReplayPlayers(players: Array<{ id: string; displayName: string }>): void {
    this.replayPlayers = players
  }

  getReplayPlayers(): Array<{ id: string; displayName: string }> {
    return this.replayPlayers
  }

  onReplayState(handler: ReplayStateHandler): () => void {
    this.stateHandlers.push(handler)
    return () => {
      this.stateHandlers = this.stateHandlers.filter(h => h !== handler)
    }
  }

  start(): void {
    this.ws.onMessage((msg) => {
      if (msg.action === 'chatMessage') {
        const chat = msg.payload as { displayName: string; message: string; timestamp: string; role?: string }
        if (this.renderer) {
          this.renderer.addChatMessage({
            displayName: chat.displayName,
            message: chat.message,
            timestamp: chat.timestamp,
            role: chat.role as 'player' | 'spectator' | undefined,
          })
        } else {
          this.buffered.push(msg)
        }
        return
      }

      if (msg.action !== 'replayState') return

      if (!this.renderer) {
        this.buffered.push(msg)
        return
      }

      this.chain = this.chain
        .then(() => this.handleReplayState(msg.payload as ReplayStatePayload))
        .catch(err => console.error('[ReplayController] error:', err))
    })
  }

  attachRenderer(renderer: GameRenderer): void {
    this.renderer = renderer

    for (const msg of this.buffered) {
      if (msg.action === 'chatMessage') {
        const chat = msg.payload as { displayName: string; message: string; timestamp: string; role?: string }
        renderer.addChatMessage({
          displayName: chat.displayName,
          message: chat.message,
          timestamp: chat.timestamp,
          role: chat.role as 'player' | 'spectator' | undefined,
        })
        continue
      }
      if (msg.action === 'replayState') {
        this.chain = this.chain
          .then(() => this.handleReplayState(msg.payload as ReplayStatePayload))
          .catch(err => console.error('[ReplayController] buffered error:', err))
      }
    }
    this.buffered = []
  }

  private async handleReplayState(payload: ReplayStatePayload): Promise<void> {
    const { gameState: serverState, event, chat, position, isPlaying, speed } = payload

    // Notify UI controls
    for (const handler of this.stateHandlers) handler(payload)

    // Handle chat entries
    if (chat && this.renderer) {
      this.renderer.addChatMessage({
        displayName: chat.displayName,
        message: chat.message,
        timestamp: chat.timestamp,
        role: chat.role as 'player' | 'spectator' | undefined,
      })
    }

    if (!event) return

    const jumped = position !== this.lastPosition + 1
    const handChanged = serverState.handNumber !== this.lastHandNumber
    this.lastPosition = position
    this.lastHandNumber = serverState.handNumber

    // Reset hand context on new hand or backward jump
    if (handChanged || jumped) {
      this.hand = freshHandContext()
      // When jumping, rebuild context from the event at this position
    }

    // Accumulate hand context
    this.accumulateHandContext(event, serverState)

    const ctx: AdapterContext = {
      myPlayerId: this.myPlayerId,
      sbPlayerId: this.hand.sbPlayerId,
      bbPlayerId: this.hand.bbPlayerId,
      winners: event.type === 'HAND_END'
        ? extractWinners(event, serverState.players, this.hand.showdownResults)
        : undefined,
      cardsDealt: this.hand.cardsDealt,
      showdownHoleCards: this.hand.showdownHoleCards.size > 0
        ? this.hand.showdownHoleCards
        : undefined,
    }

    const uiState = adaptGameState(serverState, ctx)

    // Decide whether to animate or snap
    const shouldAnimate = isPlaying && speed <= 2 && !jumped
    if (shouldAnimate) {
      await this.processEventAnimated(event, serverState, uiState)
    } else {
      this.renderer!.update(uiState)
    }
  }

  private accumulateHandContext(event: ServerEvent, serverState: ServerGameState): void {
    if (event.type === 'HAND_START') {
      this.hand = freshHandContext()
    }

    const blindInfo = extractBlindPlayers(event)
    if (blindInfo.sbPlayerId) this.hand.sbPlayerId = blindInfo.sbPlayerId
    if (blindInfo.bbPlayerId) this.hand.bbPlayerId = blindInfo.bbPlayerId

    if (event.type === 'DEAL') {
      this.hand.cardsDealt = true
    }

    if (!this.hand.cardsDealt && serverState.handNumber > 0 &&
        event.type !== 'HAND_START' && event.type !== 'BLINDS_POSTED') {
      this.hand.cardsDealt = true
    }

    if (event.type === 'SHOWDOWN') {
      for (const r of event.results) {
        this.hand.showdownResults.set(r.playerId, r.handDescription)
        if (r.holeCards) {
          this.hand.showdownHoleCards.set(r.playerId, r.holeCards as [string, string])
        }
      }
    }
  }

  private async processEventAnimated(
    event: ServerEvent,
    serverState: ServerGameState,
    uiState: GameState,
  ): Promise<void> {
    const r = this.renderer!

    switch (event.type) {
      case 'HAND_START':
        r.resetForNewHand()
        r.addLog(`--- Hand #${event.handNumber} ---`)
        r.update(uiState)
        break

      case 'BLINDS_POSTED': {
        const sbName = serverState.players.find(p => p.id === event.smallBlind.playerId)?.displayName ?? '?'
        const bbName = serverState.players.find(p => p.id === event.bigBlind.playerId)?.displayName ?? '?'
        r.addLog(`${sbName} posts SB $${event.smallBlind.amount}`)
        r.addLog(`${bbName} posts BB $${event.bigBlind.amount}`)
        r.update(uiState)
        break
      }

      case 'DEAL':
        await r.animatePhaseChange('preflop')
        r.update(uiState)
        break

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
          const { text: popText, color: popColor } = getActionPopInfo(event.action)
          r.showPlayerActionPop(player.seatIndex, popText, popColor)
        }
        r.update(uiState)
        break
      }

      case 'PLAYER_TIMEOUT': {
        const player = serverState.players.find(p => p.id === event.playerId)
        if (player) r.addLog(`${player.displayName} timed out`)
        r.update(uiState)
        break
      }

      case 'SHOWDOWN':
        await r.animatePhaseChange('showdown')
        r.update(uiState)
        break

      case 'HAND_END': {
        r.update(uiState)
        const winnerIndices = uiState.winners.map(w => w.playerIndex)
        if (winnerIndices.length > 0) {
          for (const w of uiState.winners) {
            const player = uiState.players.find(p => p.seatIndex === w.playerIndex)
            if (player) r.addLog(`${player.name} wins $${w.amount} - ${w.handDescription}`)
          }
          if (this.hand.showdownResults.size > 0) {
            await delay(SHOWDOWN_DELAY)
          }
          await r.animateWinners(winnerIndices)
        }
        break
      }

      case 'PLAYER_JOINED':
        r.addLog(`${event.displayName} joined`)
        r.update(uiState)
        break

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

  // ─── Playback commands ──────────────────────────────────────────────────────

  play(): void {
    this.ws.send('replayControl', { command: 'play' })
  }

  pause(): void {
    this.ws.send('replayControl', { command: 'pause' })
  }

  stepForward(): void {
    this.ws.send('replayControl', { command: 'step_forward' })
  }

  stepBackward(): void {
    this.ws.send('replayControl', { command: 'step_backward' })
  }

  jumpRoundStart(): void {
    this.ws.send('replayControl', { command: 'jump_round_start' })
  }

  jumpNextRound(): void {
    this.ws.send('replayControl', { command: 'jump_next_round' })
  }

  setSpeed(speed: number): void {
    this.ws.send('replayControl', { command: 'set_speed', speed })
  }

  setPosition(position: number): void {
    this.ws.send('replayControl', { command: 'set_position', position })
  }

  // ─── Card visibility commands ───────────────────────────────────────────────

  setShowAllCards(show: boolean): void {
    this.ws.send('replayCardVisibility', { showAllCards: show })
  }

  setPlayerCardVisibility(playerId: string, visible: boolean): void {
    this.ws.send('replayCardVisibility', { playerVisibility: { [playerId]: visible } })
  }
}
