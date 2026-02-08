import { GameRenderer } from './renderer/GameRenderer'
import { WsClient } from './network/ws-client'
import { GameController } from './network/game-controller'
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
  lobby.hide()

  // Initialize PixiJS renderer
  const renderer = new GameRenderer()
  await renderer.init(result.isSpectator, ws)

  // Wire up game controller
  const controller = new GameController(renderer, ws, result.isSpectator)
  controller.setPlayerId(result.playerId)
  controller.start()

  controller.onEvent((event) => {
    if (event.type === 'error') {
      renderer.addLog(`Error: ${event.message}`)
    }
    if (event.type === 'gameOver') {
      renderer.addLog(`Game over: ${event.reason}`)
    }
  })

  // If we got an initial game state (from gameJoined or reconnect), process it
  if (result.initialGameState) {
    controller.handleInitialGameState(result.initialGameState)
  }
}

main().catch(console.error)
