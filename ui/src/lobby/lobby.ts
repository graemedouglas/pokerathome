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
  private lobbyPlayerList: HTMLElement | null = null
  private lobbyStartBtn: HTMLElement | null = null
  private lobbyReadyBtn: HTMLElement | null = null
  private isPlayerReady = false

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
      const authToken = WsClient.getStoredAuthToken()
      if (authToken) payload.authToken = authToken
      this.ws.send('identify', payload)
    })

    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') btn.click()
    })

    container.append(title, subtitle, input, btn, error)
    this.setContent(container)

    setTimeout(() => input.focus(), 100)
  }

  private showAuthScreen(methods: string[], message: string): void {
    this.currentScreen = 'connect'
    const container = el('div', 'lobby-card')

    const title = el('h1', 'lobby-title')
    title.textContent = 'POKER AT HOME'

    const subtitle = el('p', 'lobby-subtitle')
    subtitle.textContent = message

    const input = document.createElement('input') as HTMLInputElement
    input.type = 'text'
    input.placeholder = methods.includes('invite_code') ? 'Passphrase or invite code' : 'Passphrase'
    input.maxLength = 32
    input.className = 'lobby-input'

    const btn = el('button', 'lobby-btn lobby-btn-primary')
    btn.textContent = 'Submit'

    const error = el('p', 'lobby-error')
    error.style.display = 'none'

    btn.addEventListener('click', () => {
      const value = input.value.trim()
      if (!value) {
        error.textContent = 'Please enter a passphrase or invite code'
        error.style.display = 'block'
        return
      }
      btn.textContent = 'Authenticating...'
      btn.setAttribute('disabled', 'true')

      const name = localStorage.getItem('pokerathome_displayName') ?? ''
      const storedToken = WsClient.getStoredReconnectToken()
      const payload: Record<string, unknown> = { displayName: name }
      if (storedToken) payload.reconnectToken = storedToken

      // Send the value as all credential types — server figures out which one matches
      payload.serverPassphrase = value
      payload.playerPassphrase = value
      payload.inviteCode = value

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
        const typeLabel = game.gameType === 'tournament' ? 'Sit & Go' : 'Cash'
        const tourneyExtra = game.gameType === 'tournament' && game.tournamentLengthHours
          ? ` \u2022 ${game.tournamentLengthHours}h / ${game.roundLengthMinutes}m levels`
          : ''
        info.textContent = `${game.playerCount}/${game.maxPlayers} players \u2022 ${typeLabel} \u2022 $${game.smallBlindAmount}/$${game.bigBlindAmount}${tourneyExtra}`

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
    const typeLabel2 = game.gameType === 'tournament' ? 'Sit & Go' : 'Cash'
    info.textContent = `${game.playerCount}/${game.maxPlayers} players \u2022 ${typeLabel2} \u2022 $${game.smallBlindAmount}/$${game.bigBlindAmount}`

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

    this.isPlayerReady = false
    this.lobbyReadyBtn = el('button', 'lobby-btn lobby-btn-primary')
    this.lobbyReadyBtn.textContent = 'Ready!'
    this.lobbyReadyBtn.addEventListener('click', () => {
      this.lobbyReadyBtn!.setAttribute('disabled', 'true')
      if (this.isPlayerReady) {
        this.ws.send('unready', {})
      } else {
        this.ws.send('ready', {})
      }
    })

    // Player list (updated by lobbyUpdate messages)
    this.lobbyPlayerList = el('div', 'lobby-player-list')

    // Start Game button (shown when canStart is true)
    this.lobbyStartBtn = el('button', 'lobby-btn lobby-btn-start')
    this.lobbyStartBtn.textContent = 'Start Game'
    this.lobbyStartBtn.style.display = 'none'
    this.lobbyStartBtn.addEventListener('click', () => {
      this.lobbyStartBtn!.textContent = 'Starting...'
      this.lobbyStartBtn!.setAttribute('disabled', 'true')
      this.ws.send('startGame', {})
    })

    const leaveBtn = el('button', 'lobby-btn lobby-btn-secondary')
    leaveBtn.textContent = 'Leave Game'
    leaveBtn.addEventListener('click', () => {
      this.ws.send('leaveGame', {})
      this.ws.send('listGames', {})
    })

    container.append(title, subtitle, this.lobbyReadyBtn, this.lobbyPlayerList, this.lobbyStartBtn, leaveBtn)
    this.setContent(container)
  }

  private updateLobbyPlayers(
    players: Array<{ id: string; displayName: string; isReady: boolean }>,
    canStart: boolean
  ): void {
    if (!this.lobbyPlayerList) return

    this.lobbyPlayerList.innerHTML = ''
    for (const p of players) {
      const row = el('div', 'lobby-player-row')
      const name = el('span', 'lobby-player-name')
      name.textContent = p.displayName
      const status = el('span', p.isReady ? 'lobby-player-ready' : 'lobby-player-waiting')
      status.textContent = p.isReady ? 'Ready' : 'Waiting'
      row.append(name, status)
      this.lobbyPlayerList.appendChild(row)
    }

    if (this.lobbyStartBtn) {
      this.lobbyStartBtn.style.display = canStart ? '' : 'none'
      this.lobbyStartBtn.textContent = 'Start Game'
      this.lobbyStartBtn.removeAttribute('disabled')
    }

    // Update ready button to reflect current player's ready state from server
    const me = players.find((p) => p.id === this.playerId)
    if (me && this.lobbyReadyBtn) {
      this.isPlayerReady = me.isReady
      this.lobbyReadyBtn.removeAttribute('disabled')
      if (me.isReady) {
        this.lobbyReadyBtn.textContent = 'Unready'
        this.lobbyReadyBtn.className = 'lobby-btn lobby-btn-secondary'
      } else {
        this.lobbyReadyBtn.textContent = 'Ready!'
        this.lobbyReadyBtn.className = 'lobby-btn lobby-btn-primary'
      }
    }
  }

  private handleMessage(msg: ServerMessage): void {
    switch (msg.action) {
      case 'identified': {
        const payload = msg.payload as {
          playerId: string
          reconnectToken: string
          authToken?: string
          autoJoinGameId?: string
          currentGame?: GameStateUpdatePayload
          pendingGame?: { gameId: string; gameName: string }
        }
        this.playerId = payload.playerId
        this.reconnectToken = payload.reconnectToken
        WsClient.storeReconnectToken(payload.reconnectToken)

        // Store auth token for future sessions
        if (payload.authToken) {
          WsClient.storeAuthToken(payload.authToken)
        }

        if (payload.pendingGame) {
          // Player was in an active game — show choice to rejoin or leave
          this.showAlreadyInGameScreen(payload.pendingGame.gameId, payload.pendingGame.gameName)
          return
        }

        if (payload.currentGame) {
          // Direct reconnect fallback
          const myPlayer = payload.currentGame.gameState.players.find(p => p.id === this.playerId)
          this.isSpectator = myPlayer?.role === 'spectator'
          this.finish(payload.currentGame)
          return
        }

        // Auto-join from invite code
        if (payload.autoJoinGameId) {
          this.currentGameId = payload.autoJoinGameId
          this.ws.send('joinGame', { gameId: payload.autoJoinGameId })
          return
        }

        this.ws.send('listGames', {})
        break
      }

      case 'authRequired': {
        const payload = msg.payload as { methods: string[]; message: string }
        this.showAuthScreen(payload.methods, payload.message)
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

      case 'lobbyUpdate': {
        const payload = msg.payload as {
          players: Array<{ id: string; displayName: string; isReady: boolean }>
          canStart: boolean
        }
        this.updateLobbyPlayers(payload.players, payload.canStart)
        break
      }

      case 'replayState': {
        // Replay games send replayState instead of gameJoined — transition immediately
        this.isReplay = true
        this.isSpectator = true
        this.finish()
        break
      }

      case 'alreadyInGame': {
        const payload = msg.payload as { existingGameId: string; existingGameName: string }
        this.showAlreadyInGameScreen(payload.existingGameId, payload.existingGameName)
        break
      }

      case 'rejoinedGame': {
        const payload = msg.payload as { currentGame: GameStateUpdatePayload }
        const myPlayer = payload.currentGame.gameState.players.find(p => p.id === this.playerId)
        this.isSpectator = myPlayer?.role === 'spectator'
        this.finish(payload.currentGame)
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

  private showAlreadyInGameScreen(gameId: string, gameName: string): void {
    this.currentScreen = 'games'
    const container = el('div', 'lobby-card')

    const title = el('h2', 'lobby-title-sm')
    title.textContent = 'Already In Game'

    const subtitle = el('p', 'lobby-subtitle')
    subtitle.textContent = `You're still in: ${gameName}`

    const prompt = el('p', 'lobby-join-prompt')
    prompt.textContent = 'Would you like to rejoin or leave?'

    const rejoinBtn = el('button', 'lobby-btn lobby-btn-primary lobby-join-choice-btn')
    rejoinBtn.textContent = 'Rejoin Game'
    const rejoinHint = el('p', 'lobby-join-hint')
    rejoinHint.textContent = 'Return to the game in progress'

    const leaveBtn = el('button', 'lobby-btn lobby-btn-secondary lobby-join-choice-btn')
    leaveBtn.textContent = 'Leave Game'
    const leaveHint = el('p', 'lobby-join-hint')
    leaveHint.textContent = 'Leave and browse available games'

    rejoinBtn.addEventListener('click', () => {
      rejoinBtn.textContent = 'Rejoining...'
      rejoinBtn.setAttribute('disabled', 'true')
      leaveBtn.setAttribute('disabled', 'true')
      this.currentGameId = gameId
      this.ws.send('rejoinGame', {})
    })

    leaveBtn.addEventListener('click', () => {
      leaveBtn.textContent = 'Leaving...'
      rejoinBtn.setAttribute('disabled', 'true')
      leaveBtn.setAttribute('disabled', 'true')
      this.ws.send('leaveGame', {})
      this.ws.send('listGames', {})
    })

    const choices = el('div', 'lobby-join-choices')
    const rejoinGroup = el('div', 'lobby-join-group')
    rejoinGroup.append(rejoinBtn, rejoinHint)
    const leaveGroup = el('div', 'lobby-join-group')
    leaveGroup.append(leaveBtn, leaveHint)
    choices.append(rejoinGroup, leaveGroup)

    container.append(title, subtitle, prompt, choices)
    this.setContent(container)
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
  .lobby-btn-start {
    background: #16a34a;
    color: #fff;
  }
  .lobby-btn-start:hover:not(:disabled) {
    background: #22c55e;
  }
  .lobby-player-list {
    display: flex;
    flex-direction: column;
    gap: 4px;
    margin: 4px 0;
  }
  .lobby-player-row {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 6px 12px;
    background: #1a1a3a;
    border-radius: 6px;
    font-size: 13px;
  }
  .lobby-player-name {
    color: #e0e0e0;
  }
  .lobby-player-ready {
    color: #4ade80;
    font-weight: bold;
    font-size: 12px;
  }
  .lobby-player-waiting {
    color: #777799;
    font-size: 12px;
  }
</style>`
