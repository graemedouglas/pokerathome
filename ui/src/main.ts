import { GameRenderer } from './renderer/GameRenderer'
import { WsClient } from './network/ws-client'
import { GameController } from './network/game-controller'
import { ReplayController } from './network/replay-controller'
import { Lobby } from './lobby/lobby'

async function main() {
  // Determine WebSocket URL (proxied in dev via Vite)
  const wsProtocol = location.protocol === 'https:' ? 'wss:' : 'ws:'
  const wsUrl = `${wsProtocol}//${location.host}/ws`

  // Connect WebSocket
  const ws = new WsClient()
  try {
    await ws.connect(wsUrl)
  } catch {
    document.body.innerHTML = `<div style="
      display: flex; align-items: center; justify-content: center;
      height: 100vh; background: #0f0f23; color: #ef4444;
      font-family: Arial; font-size: 18px;
    ">Failed to connect to server. Is the server running?</div>`
    return
  }

  // Show lobby overlay for identification and game selection
  const lobby = new Lobby(ws)
  const result = await lobby.show()

  if (result.isReplay) {
    // ─── Replay mode ──────────────────────────────────────────────────────────
    const controller = new ReplayController(ws)
    controller.setPlayerId(result.playerId)
    controller.start()

    lobby.hide()

    // Fetch replay players from admin API for the card visibility panel
    try {
      const res = await fetch(`/api/replay-games/${result.gameId}/players`)
      if (res.ok) {
        const players = await res.json()
        controller.setReplayPlayers(players)
      }
    } catch {
      // Non-critical — card visibility panel will show "No player data"
    }

    const renderer = new GameRenderer()
    await renderer.init(true, ws, controller)

    controller.attachRenderer(renderer)
  } else {
    // ─── Normal game mode ─────────────────────────────────────────────────────
    const controller = new GameController(ws, result.isSpectator)
    controller.setPlayerId(result.playerId)
    controller.start()

    controller.onEvent((event) => {
      if (event.type === 'error') {
        console.warn('[Game] error:', event.message)
      }
      if (event.type === 'gameOver') {
        console.info('[Game] game over:', event.reason)
      }
    })

    lobby.hide()

    const renderer = new GameRenderer()
    await renderer.init(result.isSpectator, ws)

    controller.attachRenderer(renderer, result.initialGameState ?? undefined, result.handHistory)

    controller.onEvent((event) => {
      if (event.type === 'error') {
        renderer.addLog(`Error: ${event.message}`)
      }
      if (event.type === 'gameOver') {
        renderer.addLog(`Game over: ${event.reason}`)
      }
    })
  }
}

main().catch(console.error)
