import type { ServerMessage, Event as ServerEvent } from '@pokerathome/schema'
import type { GameListItem, GameStateUpdatePayload } from '@pokerathome/schema'
import { WsClient } from '../network/ws-client'

export interface LobbyResult {
  playerId: string
  reconnectToken: string
  gameId: string
  isSpectator: boolean
  isReplay?: boolean
  initialGameState?: GameStateUpdatePayload
  handHistory?: ServerEvent[]
}

type LobbyScreen = 'connect' | 'games' | 'waiting'

export class Lobby {
  private overlay: HTMLDivElement
  private ws: WsClient
  private resolve: ((result: LobbyResult) => void) | null = null
  private playerId = ''
  private reconnectToken = ''
  private currentGameId = ''
  private isSpectator = false
  private isReplay = false
  private handHistory?: ServerEvent[]
  private currentScreen: LobbyScreen = 'connect'
  private removeMessageHandler?: () => void

  constructor(ws: WsClient) {
    this.ws = ws
    this.overlay = document.createElement('div')
    this.overlay.id = 'lobby-overlay'
    this.overlay.innerHTML = LOBBY_STYLES
    document.body.appendChild(this.overlay)
  }

  show(): Promise<LobbyResult> {
    return new Promise((resolve) => {
      this.resolve = resolve
      this.overlay.style.display = 'flex'

      this.removeMessageHandler = this.ws.onMessage((msg) => this.handleMessage(msg))

      // Check for stored reconnect token
      const stored = WsClient.getStoredReconnectToken()
      this.showConnectScreen(stored)
    })
  }

  hide(): void {
    this.overlay.style.display = 'none'
    this.removeMessageHandler?.()
  }

  private showConnectScreen(storedToken?: string | null): void {
    this.currentScreen = 'connect'

    const container = el('div', 'lobby-card')

    const title = el('h1', 'lobby-title')
    title.textContent = 'POKER AT HOME'

    const subtitle = el('p', 'lobby-subtitle')
    subtitle.textContent = 'Enter your display name to join'

    const input = document.createElement('input') as HTMLInputElement
    input.type = 'text'
    input.placeholder = 'Display name'
    input.maxLength = 32
    input.className = 'lobby-input'
    input.value = localStorage.getItem('pokerathome_displayName') ?? ''

    const btn = el('button', 'lobby-btn lobby-btn-primary')
    btn.textContent = 'Connect'

    const error = el('p', 'lobby-error')
    error.style.display = 'none'

    btn.addEventListener('click', () => {
      const name = input.value.trim()
      if (!name) {
        error.textContent = 'Please enter a name'
        error.style.display = 'block'
        return
      }
      localStorage.setItem('pokerathome_displayName', name)
      btn.textContent = 'Connecting...'
      btn.setAttribute('disabled', 'true')

      const payload: Record<string, unknown> = { displayName: name }
      if (storedToken) payload.reconnectToken = storedToken
      this.ws.send('identify', payload)
    })

    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') btn.click()
    })

    container.append(title, subtitle, input, btn, error)
    this.setContent(container)

    setTimeout(() => input.focus(), 100)
  }

  private showGameList(games: GameListItem[]): void {
    this.currentScreen = 'games'
    const container = el('div', 'lobby-card lobby-card-wide')

    const header = el('div', 'lobby-header')
    const title = el('h2', 'lobby-title-sm')
    title.textContent = 'Available Games'
    const refreshBtn = el('button', 'lobby-btn lobby-btn-small')
    refreshBtn.textContent = 'Refresh'
    refreshBtn.addEventListener('click', () => {
      this.ws.send('listGames', {})
    })
    header.append(title, refreshBtn)
    container.appendChild(header)

    if (games.length === 0) {
      const empty = el('p', 'lobby-subtitle')
      empty.textContent = 'No games available. Ask the admin to create one.'
      container.appendChild(empty)
    } else {
      const list = el('div', 'lobby-game-list')
      for (const game of games) {
        const card = el('div', 'lobby-game-card')

        const name = el('div', 'lobby-game-name')
        name.textContent = game.name

        const info = el('div', 'lobby-game-info')
        info.textContent = `${game.playerCount}/${game.maxPlayers} players \u2022 ${game.gameType} \u2022 $${game.smallBlindAmount}/$${game.bigBlindAmount}`

        const status = el('span', `lobby-game-status lobby-status-${game.isReplay ? 'replay' : game.status}`)
        status.textContent = game.isReplay ? 'Replay' : (game.status === 'waiting' ? 'Waiting' : 'In Progress')

        const enterBtn = el('button', `lobby-btn ${game.isReplay ? 'lobby-btn-spectate' : 'lobby-btn-primary'} lobby-btn-small`)
        enterBtn.textContent = game.isReplay ? 'Watch' : 'Enter'
        enterBtn.addEventListener('click', () => {
          this.showJoinChoiceScreen(game)
        })

        const row = el('div', 'lobby-game-row')
        row.append(el('div', '', name, info), el('div', 'lobby-game-actions', status, enterBtn))
        card.appendChild(row)
        list.appendChild(card)
      }
      container.appendChild(list)
    }

    this.setContent(container)
  }

  private showJoinChoiceScreen(game: GameListItem): void {
    this.currentScreen = 'games'

    // Replay games auto-join as spectator
    if (game.isReplay) {
      this.currentGameId = game.gameId
      this.isSpectator = true
      this.isReplay = true
      this.ws.send('joinGame', { gameId: game.gameId, role: 'spectator' })
      return
    }

    const container = el('div', 'lobby-card')

    const title = el('h2', 'lobby-title-sm')
    title.textContent = game.name

    const info = el('p', 'lobby-subtitle')
    info.textContent = `${game.playerCount}/${game.maxPlayers} players \u2022 $${game.smallBlindAmount}/$${game.bigBlindAmount}`

    const prompt = el('p', 'lobby-join-prompt')
    prompt.textContent = 'How would you like to join?'

    const playBtn = el('button', 'lobby-btn lobby-btn-primary lobby-join-choice-btn')
    playBtn.textContent = 'Play'
    const playHint = el('p', 'lobby-join-hint')
    playHint.textContent = 'Sit at the table and play hands'

    const spectateBtn = el('button', 'lobby-btn lobby-btn-spectate lobby-join-choice-btn')
    spectateBtn.textContent = 'Spectate'
    const spectateHint = el('p', 'lobby-join-hint')
    spectateHint.textContent = 'Watch the game and chat'

    const backBtn = el('button', 'lobby-btn lobby-btn-secondary')
    backBtn.textContent = 'Back'
    backBtn.addEventListener('click', () => {
      this.ws.send('listGames', {})
    })

    playBtn.addEventListener('click', () => {
      this.currentGameId = game.gameId
      this.isSpectator = false
      playBtn.textContent = 'Joining...'
      playBtn.setAttribute('disabled', 'true')
      spectateBtn.setAttribute('disabled', 'true')
      this.ws.send('joinGame', { gameId: game.gameId })
    })

    spectateBtn.addEventListener('click', () => {
      this.currentGameId = game.gameId
      this.isSpectator = true
      spectateBtn.textContent = 'Joining...'
      playBtn.setAttribute('disabled', 'true')
      spectateBtn.setAttribute('disabled', 'true')
      this.ws.send('joinGame', { gameId: game.gameId, role: 'spectator' })
    })

    const choices = el('div', 'lobby-join-choices')
    const playGroup = el('div', 'lobby-join-group')
    playGroup.append(playBtn, playHint)
    const spectateGroup = el('div', 'lobby-join-group')
    spectateGroup.append(spectateBtn, spectateHint)
    choices.append(playGroup, spectateGroup)

    container.append(title, info, prompt, choices, backBtn)
    this.setContent(container)
  }

  private showWaitingScreen(gameName?: string): void {
    this.currentScreen = 'waiting'
    const container = el('div', 'lobby-card')

    const title = el('h2', 'lobby-title-sm')
    title.textContent = gameName ? `Joined: ${gameName}` : 'Game Joined'

    const subtitle = el('p', 'lobby-subtitle')
    subtitle.textContent = 'Waiting for the game to start...'

    const readyBtn = el('button', 'lobby-btn lobby-btn-primary')
    readyBtn.textContent = 'Ready!'
    readyBtn.addEventListener('click', () => {
      readyBtn.textContent = 'Waiting for others...'
      readyBtn.setAttribute('disabled', 'true')
      this.ws.send('ready', {})
    })

    const leaveBtn = el('button', 'lobby-btn lobby-btn-secondary')
    leaveBtn.textContent = 'Leave Game'
    leaveBtn.addEventListener('click', () => {
      this.ws.send('leaveGame', {})
      this.ws.send('listGames', {})
    })

    container.append(title, subtitle, readyBtn, leaveBtn)
    this.setContent(container)
  }

  private handleMessage(msg: ServerMessage): void {
    switch (msg.action) {
      case 'identified': {
        const payload = msg.payload as { playerId: string; reconnectToken: string; currentGame?: GameStateUpdatePayload }
        this.playerId = payload.playerId
        this.reconnectToken = payload.reconnectToken
        WsClient.storeReconnectToken(payload.reconnectToken)

        if (payload.currentGame) {
          // Reconnect scenario — detect spectator role from game state so the
          // controller and renderer are initialised correctly (Bug 4 fix).
          const myPlayer = payload.currentGame.gameState.players.find(p => p.id === this.playerId)
          this.isSpectator = myPlayer?.role === 'spectator'
          this.finish(payload.currentGame)
          return
        }

        this.ws.send('listGames', {})
        break
      }

      case 'gameList': {
        const payload = msg.payload as { games: GameListItem[] }
        this.showGameList(payload.games)
        break
      }

      case 'gameJoined': {
        if (this.isSpectator) {
          const gsPayload = (msg.payload as { gameState: GameStateUpdatePayload['gameState']; handEvents?: ServerEvent[] })
          this.handHistory = gsPayload.handEvents
          this.finish({ gameState: gsPayload.gameState, event: { type: 'PLAYER_JOINED', playerId: this.playerId, displayName: '', seatIndex: 0 } } as GameStateUpdatePayload)
        } else {
          this.showWaitingScreen()
        }
        break
      }

      case 'gameState': {
        const gsPayload = msg.payload as GameStateUpdatePayload
        const eventType = gsPayload.event?.type
        // Only transition to game view on actual gameplay events, not lobby-phase events
        if (eventType && eventType !== 'PLAYER_JOINED' && eventType !== 'PLAYER_LEFT') {
          this.finish(gsPayload)
        }
        break
      }

      case 'replayState': {
        // Replay games send replayState instead of gameJoined — transition immediately
        this.isReplay = true
        this.isSpectator = true
        this.finish()
        break
      }

      case 'error': {
        const payload = msg.payload as { code?: string; message: string }

        // Stale reconnect token (e.g. after a DB reset) — clear it and retry as new player
        if (this.currentScreen === 'connect' && payload.message?.includes('reconnect token')) {
          WsClient.clearReconnectToken()
          const name = localStorage.getItem('pokerathome_displayName') ?? ''
          if (name) {
            this.ws.send('identify', { displayName: name })
            return
          }
          // Fall through to show connect screen without the token
          this.showConnectScreen()
          return
        }

        const errorEl = this.overlay.querySelector('.lobby-error') as HTMLElement | null
        if (errorEl) {
          errorEl.textContent = payload.message
          errorEl.style.display = 'block'
        } else {
          alert(payload.message)
        }
        break
      }
    }
  }

  private finish(initialGameState?: GameStateUpdatePayload): void {
    if (!this.resolve) return
    this.resolve({
      playerId: this.playerId,
      reconnectToken: this.reconnectToken,
      gameId: this.currentGameId,
      isSpectator: this.isSpectator,
      isReplay: this.isReplay,
      initialGameState,
      handHistory: this.handHistory,
    })
    this.resolve = null
  }

  private setContent(element: HTMLElement): void {
    let content = this.overlay.querySelector('.lobby-content') as HTMLElement | null
    if (!content) {
      content = el('div', 'lobby-content')
      this.overlay.appendChild(content)
    }
    content.innerHTML = ''
    content.appendChild(element)
  }
}

function el(tag: string, className?: string, ...children: HTMLElement[]): HTMLElement {
  const element = document.createElement(tag)
  if (className) element.className = className
  for (const child of children) element.appendChild(child)
  return element
}

const LOBBY_STYLES = `<style>
  #lobby-overlay {
    position: fixed;
    inset: 0;
    z-index: 1000;
    display: flex;
    align-items: center;
    justify-content: center;
    background: #0f0f23;
    font-family: Arial, sans-serif;
    color: #e0e0e0;
  }
  .lobby-content {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 100%;
    height: 100%;
  }
  .lobby-card {
    background: #181830;
    border: 1px solid #2a2a50;
    border-radius: 12px;
    padding: 32px;
    max-width: 400px;
    width: 100%;
    display: flex;
    flex-direction: column;
    gap: 16px;
    align-items: stretch;
  }
  .lobby-card-wide {
    max-width: 520px;
  }
  .lobby-title {
    font-size: 24px;
    font-weight: bold;
    letter-spacing: 4px;
    color: #ccc;
    text-align: center;
    margin: 0;
  }
  .lobby-title-sm {
    font-size: 18px;
    font-weight: bold;
    color: #ccc;
    margin: 0;
  }
  .lobby-subtitle {
    font-size: 14px;
    color: #777799;
    text-align: center;
    margin: 0;
  }
  .lobby-input {
    background: #0a0a1a;
    border: 1px solid #2a2a50;
    border-radius: 8px;
    padding: 12px 16px;
    color: #e0e0e0;
    font-size: 16px;
    outline: none;
    transition: border-color 0.2s;
  }
  .lobby-input:focus {
    border-color: #4455aa;
  }
  .lobby-btn {
    border: none;
    border-radius: 8px;
    padding: 12px 20px;
    font-size: 15px;
    font-weight: bold;
    cursor: pointer;
    transition: background 0.2s, opacity 0.2s;
  }
  .lobby-btn:disabled {
    opacity: 0.5;
    cursor: default;
  }
  .lobby-btn-primary {
    background: #2563eb;
    color: #fff;
  }
  .lobby-btn-primary:hover:not(:disabled) {
    background: #3b82f6;
  }
  .lobby-btn-secondary {
    background: #333355;
    color: #aaa;
  }
  .lobby-btn-secondary:hover:not(:disabled) {
    background: #444466;
  }
  .lobby-btn-small {
    padding: 8px 14px;
    font-size: 13px;
  }
  .lobby-error {
    color: #ef4444;
    font-size: 13px;
    text-align: center;
    margin: 0;
  }
  .lobby-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
  }
  .lobby-game-list {
    display: flex;
    flex-direction: column;
    gap: 8px;
    max-height: 400px;
    overflow-y: auto;
  }
  .lobby-game-card {
    background: #1a1a3a;
    border: 1px solid #2a2a50;
    border-radius: 8px;
    padding: 12px 16px;
  }
  .lobby-game-row {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 12px;
  }
  .lobby-game-name {
    font-weight: bold;
    font-size: 14px;
    color: #e0e0e0;
  }
  .lobby-game-info {
    font-size: 12px;
    color: #777799;
    margin-top: 4px;
  }
  .lobby-game-actions {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-shrink: 0;
  }
  .lobby-game-status {
    font-size: 11px;
    padding: 3px 8px;
    border-radius: 4px;
    font-weight: bold;
  }
  .lobby-status-waiting {
    background: #1a3d1a;
    color: #4ade80;
  }
  .lobby-status-in_progress {
    background: #3d3a1a;
    color: #fbbf24;
  }
  .lobby-status-replay {
    background: #1a2a4d;
    color: #60a5fa;
  }
  .lobby-join-prompt {
    font-size: 15px;
    color: #999;
    text-align: center;
    margin: 4px 0 0;
  }
  .lobby-join-choices {
    display: flex;
    gap: 12px;
  }
  .lobby-join-group {
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .lobby-join-choice-btn {
    width: 100%;
    padding: 14px 20px;
    font-size: 16px;
  }
  .lobby-join-hint {
    font-size: 11px;
    color: #666688;
    text-align: center;
    margin: 0;
  }
  .lobby-btn-spectate {
    background: #4a3d6b;
    color: #d4c0f0;
  }
  .lobby-btn-spectate:hover:not(:disabled) {
    background: #5d4d80;
  }
</style>`
