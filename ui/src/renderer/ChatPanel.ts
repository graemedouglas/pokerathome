import type { WsClient } from '../network/ws-client'

export interface ChatMessage {
  displayName: string
  message: string
  timestamp: string
  isSystem?: boolean
  role?: 'player' | 'spectator'
}

const NAME_COLORS = [
  '#e6794a', '#c45dbd', '#5db8c4', '#8bc45d',
  '#c4a35d', '#5d7ec4', '#c45d6e', '#5dc49e',
]

function nameColor(name: string): string {
  let hash = 0
  for (let i = 0; i < name.length; i++) {
    hash = (hash * 31 + name.charCodeAt(i)) | 0
  }
  return NAME_COLORS[Math.abs(hash) % NAME_COLORS.length]
}

export class ChatPanel {
  private container: HTMLDivElement
  private messagesEl: HTMLDivElement
  private inputEl: HTMLInputElement
  private ws: WsClient
  private collapsed = false
  private toggleBtn: HTMLDivElement

  constructor(ws: WsClient) {
    this.ws = ws

    this.container = document.createElement('div')
    this.container.className = 'chat-panel'

    // Header
    const header = document.createElement('div')
    header.className = 'chat-header'
    const title = document.createElement('span')
    title.textContent = 'Chat'
    title.className = 'chat-header-title'
    const collapseBtn = document.createElement('button')
    collapseBtn.className = 'chat-collapse-btn'
    collapseBtn.textContent = '\u2715'
    collapseBtn.addEventListener('click', () => this.toggle())
    header.append(title, collapseBtn)
    this.container.appendChild(header)

    // Messages area
    this.messagesEl = document.createElement('div')
    this.messagesEl.className = 'chat-messages'
    this.container.appendChild(this.messagesEl)

    // Input row
    const inputRow = document.createElement('div')
    inputRow.className = 'chat-input-row'
    this.inputEl = document.createElement('input')
    this.inputEl.type = 'text'
    this.inputEl.placeholder = 'Send a message...'
    this.inputEl.className = 'chat-input'
    this.inputEl.maxLength = 500
    this.inputEl.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') this.sendMessage()
      e.stopPropagation()
    })
    const sendBtn = document.createElement('button')
    sendBtn.className = 'chat-send-btn'
    sendBtn.textContent = '\u279C'
    sendBtn.addEventListener('click', () => this.sendMessage())
    inputRow.append(this.inputEl, sendBtn)
    this.container.appendChild(inputRow)

    // Toggle button (shown when collapsed)
    this.toggleBtn = document.createElement('div')
    this.toggleBtn.className = 'chat-toggle-btn'
    this.toggleBtn.innerHTML = '<span class="chat-toggle-icon">\uD83D\uDCAC</span>'
    this.toggleBtn.addEventListener('click', () => this.toggle())
    this.toggleBtn.style.display = 'none'

    // Inject styles
    this.injectStyles()
  }

  mount(): void {
    document.body.appendChild(this.container)
    document.body.appendChild(this.toggleBtn)
  }

  destroy(): void {
    this.container.remove()
    this.toggleBtn.remove()
  }

  addMessage(msg: ChatMessage): void {
    const line = document.createElement('div')
    line.className = 'chat-line'

    if (msg.isSystem) {
      line.classList.add('chat-line-system')
      line.textContent = msg.message
    } else {
      // Role tag: [Player] or [Spectator]
      if (msg.role) {
        const roleSpan = document.createElement('span')
        roleSpan.className = 'chat-role'
        roleSpan.classList.add(msg.role === 'spectator' ? 'chat-role-spectator' : 'chat-role-player')
        roleSpan.textContent = msg.role === 'spectator' ? '[Spectator] ' : '[Player] '
        line.appendChild(roleSpan)
      }

      const nameSpan = document.createElement('span')
      nameSpan.className = 'chat-name'
      nameSpan.style.color = nameColor(msg.displayName)
      nameSpan.textContent = msg.displayName
      const textNode = document.createTextNode(`: ${msg.message}`)
      line.append(nameSpan, textNode)
    }

    this.messagesEl.appendChild(line)

    // Keep max ~200 messages
    while (this.messagesEl.children.length > 200) {
      this.messagesEl.removeChild(this.messagesEl.firstChild!)
    }

    // Auto-scroll to bottom
    this.messagesEl.scrollTop = this.messagesEl.scrollHeight
  }

  private sendMessage(): void {
    const text = this.inputEl.value.trim()
    if (!text) return
    this.ws.send('chat', { message: text })
    this.inputEl.value = ''
  }

  private toggle(): void {
    this.collapsed = !this.collapsed
    this.container.style.display = this.collapsed ? 'none' : 'flex'
    this.toggleBtn.style.display = this.collapsed ? 'flex' : 'none'
  }

  private injectStyles(): void {
    if (document.getElementById('chat-panel-styles')) return
    const style = document.createElement('style')
    style.id = 'chat-panel-styles'
    style.textContent = `
      .chat-panel {
        position: fixed;
        right: 12px;
        top: 12px;
        bottom: 12px;
        width: 260px;
        background: rgba(15, 15, 35, 0.92);
        border: 1px solid #2a2a50;
        border-radius: 10px;
        display: flex;
        flex-direction: column;
        z-index: 900;
        font-family: Arial, sans-serif;
        color: #e0e0e0;
        overflow: hidden;
      }
      .chat-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: 8px 12px;
        background: #181830;
        border-bottom: 1px solid #2a2a50;
        flex-shrink: 0;
      }
      .chat-header-title {
        font-size: 13px;
        font-weight: bold;
        letter-spacing: 1px;
        color: #aaa;
      }
      .chat-collapse-btn {
        background: none;
        border: none;
        color: #666;
        font-size: 14px;
        cursor: pointer;
        padding: 2px 6px;
        border-radius: 4px;
        transition: color 0.15s, background 0.15s;
      }
      .chat-collapse-btn:hover {
        color: #ff6666;
        background: rgba(255,100,100,0.1);
      }
      .chat-messages {
        flex: 1;
        overflow-y: auto;
        padding: 8px 10px;
        display: flex;
        flex-direction: column;
        gap: 3px;
        scrollbar-width: thin;
        scrollbar-color: #2a2a50 transparent;
      }
      .chat-messages::-webkit-scrollbar { width: 5px; }
      .chat-messages::-webkit-scrollbar-track { background: transparent; }
      .chat-messages::-webkit-scrollbar-thumb { background: #2a2a50; border-radius: 3px; }
      .chat-line {
        font-size: 12px;
        line-height: 1.4;
        word-break: break-word;
      }
      .chat-line-system {
        color: #777799;
        font-style: italic;
      }
      .chat-name {
        font-weight: bold;
      }
      .chat-role {
        font-size: 10px;
        font-weight: bold;
        margin-right: 2px;
      }
      .chat-role-player {
        color: #4ade80;
      }
      .chat-role-spectator {
        color: #fbbf24;
      }
      .chat-input-row {
        display: flex;
        padding: 8px;
        gap: 6px;
        border-top: 1px solid #2a2a50;
        background: #141428;
        flex-shrink: 0;
      }
      .chat-input {
        flex: 1;
        background: #0a0a1a;
        border: 1px solid #2a2a50;
        border-radius: 6px;
        padding: 6px 10px;
        color: #e0e0e0;
        font-size: 12px;
        outline: none;
        transition: border-color 0.2s;
      }
      .chat-input:focus {
        border-color: #4455aa;
      }
      .chat-input::placeholder {
        color: #555;
      }
      .chat-send-btn {
        background: #2563eb;
        border: none;
        border-radius: 6px;
        color: #fff;
        padding: 6px 10px;
        font-size: 13px;
        cursor: pointer;
        transition: background 0.15s;
        flex-shrink: 0;
      }
      .chat-send-btn:hover {
        background: #3b82f6;
      }
      .chat-toggle-btn {
        position: fixed;
        right: 12px;
        bottom: 12px;
        width: 42px;
        height: 42px;
        background: rgba(24, 24, 48, 0.92);
        border: 1px solid #2a2a50;
        border-radius: 50%;
        display: flex;
        align-items: center;
        justify-content: center;
        cursor: pointer;
        z-index: 900;
        transition: background 0.15s;
      }
      .chat-toggle-btn:hover {
        background: rgba(34, 34, 80, 0.95);
      }
      .chat-toggle-icon {
        font-size: 18px;
      }
    `
    document.head.appendChild(style)
  }
}
