import type { ServerMessage } from '@pokerathome/schema'

export type ServerMessageHandler = (msg: ServerMessage) => void
export type DisconnectHandler = (reason: string) => void

const RECONNECT_TOKEN_KEY = 'pokerathome_reconnectToken'
const MAX_RECONNECT_ATTEMPTS = 5
const BASE_RECONNECT_DELAY = 1000

export class WsClient {
  private ws: WebSocket | null = null
  private messageHandlers: ServerMessageHandler[] = []
  private disconnectHandlers: DisconnectHandler[] = []
  private url = ''
  private reconnectAttempts = 0
  private shouldReconnect = false

  get connected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN
  }

  connect(url: string): Promise<void> {
    this.url = url
    this.shouldReconnect = true
    this.reconnectAttempts = 0
    return this.doConnect()
  }

  private doConnect(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(this.url)

      this.ws.onopen = () => {
        this.reconnectAttempts = 0
        resolve()
      }

      this.ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data as string) as ServerMessage
          for (const handler of this.messageHandlers) {
            handler(data)
          }
        } catch {
          console.warn('Failed to parse server message:', event.data)
        }
      }

      this.ws.onclose = (event) => {
        const reason = event.reason || 'Connection closed'
        for (const handler of this.disconnectHandlers) {
          handler(reason)
        }
        this.attemptReconnect()
      }

      this.ws.onerror = () => {
        if (this.ws?.readyState !== WebSocket.OPEN) {
          reject(new Error('WebSocket connection failed'))
        }
      }
    })
  }

  private attemptReconnect(): void {
    if (!this.shouldReconnect) return
    if (this.reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
      console.warn('Max reconnect attempts reached')
      return
    }

    this.reconnectAttempts++
    const delay = BASE_RECONNECT_DELAY * Math.pow(2, this.reconnectAttempts - 1)
    console.log(`Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts})...`)

    setTimeout(() => {
      this.doConnect().catch(() => {
        // Will trigger onclose -> attemptReconnect again
      })
    }, delay)
  }

  send(action: string, payload: Record<string, unknown>): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      console.warn('Cannot send: WebSocket not connected')
      return
    }
    this.ws.send(JSON.stringify({ action, payload }))
  }

  onMessage(handler: ServerMessageHandler): () => void {
    this.messageHandlers.push(handler)
    return () => {
      this.messageHandlers = this.messageHandlers.filter(h => h !== handler)
    }
  }

  onDisconnect(handler: DisconnectHandler): () => void {
    this.disconnectHandlers.push(handler)
    return () => {
      this.disconnectHandlers = this.disconnectHandlers.filter(h => h !== handler)
    }
  }

  disconnect(): void {
    this.shouldReconnect = false
    this.ws?.close()
    this.ws = null
  }

  static getStoredReconnectToken(): string | null {
    return localStorage.getItem(RECONNECT_TOKEN_KEY)
  }

  static storeReconnectToken(token: string): void {
    localStorage.setItem(RECONNECT_TOKEN_KEY, token)
  }

  static clearReconnectToken(): void {
    localStorage.removeItem(RECONNECT_TOKEN_KEY)
  }
}
