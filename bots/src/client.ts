import WebSocket from 'ws'
import type { GameState, ActionRequest } from '@pokerathome/schema'
import type { BotStrategy } from './strategies/index.js'

export interface BotClientOptions {
  serverUrl: string
  gameId: string
  strategy: BotStrategy
  displayName: string
  logger?: Pick<Console, 'info' | 'warn' | 'error'>
}

export class BotClient {
  private ws: WebSocket | null = null
  private playerId: string | null = null
  private reconnectToken: string | null = null
  private gameJoined = false
  private stopped = false
  private options: BotClientOptions
  private log: Pick<Console, 'info' | 'warn' | 'error'>

  constructor(options: BotClientOptions) {
    this.options = options
    this.log = options.logger ?? {
      info: (...args: unknown[]) => console.log(`[${options.displayName}]`, ...args),
      warn: (...args: unknown[]) => console.warn(`[${options.displayName}]`, ...args),
      error: (...args: unknown[]) => console.error(`[${options.displayName}]`, ...args),
    }
  }

  start(): Promise<void> {
    return new Promise((resolve, reject) => {
      if (this.stopped) return reject(new Error('Bot has been stopped'))

      this.ws = new WebSocket(this.options.serverUrl)

      this.ws.on('open', () => {
        this.log.info('Connected, identifying...')
        this.send({
          action: 'identify',
          payload: { displayName: this.options.displayName },
        })
      })

      this.ws.on('message', (data) => {
        try {
          const msg = JSON.parse(data.toString())
          this.handleMessage(msg)
        } catch (err) {
          this.log.error('Failed to parse message:', err)
        }
      })

      this.ws.on('close', () => {
        this.log.info('Disconnected')
      })

      this.ws.on('error', (err) => {
        this.log.error('WebSocket error:', err)
        if (!this.playerId) reject(err)
      })

      // Resolve once identified
      const checkIdentified = setInterval(() => {
        if (this.playerId) {
          clearInterval(checkIdentified)
          resolve()
        }
        if (this.stopped) {
          clearInterval(checkIdentified)
          resolve()
        }
      }, 50)
    })
  }

  stop(): void {
    this.stopped = true
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      if (this.gameJoined) {
        this.send({ action: 'leaveGame', payload: {} })
      }
      this.ws.close()
    }
    this.ws = null
  }

  getPlayerId(): string | null {
    return this.playerId
  }

  isConnected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN
  }

  private handleMessage(msg: { action: string; payload: unknown }): void {
    switch (msg.action) {
      case 'identified':
        this.handleIdentified(msg.payload as { playerId: string; reconnectToken: string })
        break
      case 'gameJoined':
        this.handleGameJoined()
        break
      case 'gameState':
        this.handleGameState(msg.payload as {
          gameState: GameState
          event: { type: string }
          actionRequest?: ActionRequest
        })
        break
      case 'gameOver':
        this.handleGameOver()
        break
      case 'error':
        this.log.warn('Server error:', msg.payload)
        break
      case 'timeWarning':
        break
      default:
        break
    }
  }

  private handleIdentified(payload: { playerId: string; reconnectToken: string }): void {
    this.playerId = payload.playerId
    this.reconnectToken = payload.reconnectToken
    this.log.info(`Identified as ${this.playerId}`)

    this.send({
      action: 'joinGame',
      payload: { gameId: this.options.gameId },
    })
  }

  private handleGameJoined(): void {
    this.gameJoined = true
    this.log.info('Joined game, readying up...')
    this.send({ action: 'ready', payload: {} })
  }

  private handleGameState(payload: {
    gameState: GameState
    event: { type: string }
    actionRequest?: ActionRequest
  }): void {
    if (!payload.actionRequest || !this.playerId) return

    const decision = this.options.strategy.decide(
      payload.gameState,
      payload.actionRequest,
      this.playerId
    )

    this.log.info(
      `Hand #${payload.gameState.handNumber} | ${payload.event.type} | Action: ${decision.type}${decision.amount !== undefined ? ` ${decision.amount}` : ''}`
    )

    this.send({
      action: 'playerAction',
      payload: {
        handNumber: payload.gameState.handNumber,
        type: decision.type,
        ...(decision.amount !== undefined ? { amount: decision.amount } : {}),
      },
    })
  }

  private handleGameOver(): void {
    this.log.info('Game over')
    this.gameJoined = false
    if (!this.stopped) {
      this.stop()
    }
  }

  private send(msg: object): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg))
    }
  }
}
