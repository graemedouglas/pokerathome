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

  // Start the game controller BEFORE hiding lobby / init'ing renderer.
  // This ensures WS messages are buffered and none are lost in the gap.
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

  // Now safe to remove the lobby handler — controller is already capturing
  lobby.hide()

  // Initialize PixiJS renderer
  const renderer = new GameRenderer()
  await renderer.init(result.isSpectator, ws)

  // Attach renderer — this flushes the initial state + any buffered messages
  controller.attachRenderer(renderer, result.initialGameState ?? undefined)

  // Re-register event handler now that renderer is available for logging
  controller.onEvent((event) => {
    if (event.type === 'error') {
      renderer.addLog(`Error: ${event.message}`)
    }
    if (event.type === 'gameOver') {
      renderer.addLog(`Game over: ${event.reason}`)
    }
  })
}

main().catch(console.error)
