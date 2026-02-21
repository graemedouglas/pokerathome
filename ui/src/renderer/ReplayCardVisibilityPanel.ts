/**
 * HTML-based card visibility panel for replay mode.
 * Uses DOM elements (like ChatPanel) since PixiJS checkboxes are cumbersome.
 */
import type { ReplayController } from '../network/replay-controller'

export class ReplayCardVisibilityPanel {
  private container: HTMLDivElement
  private controller: ReplayController
  private isOpen = false
  private toggleBtn: HTMLButtonElement
  private panelDiv: HTMLDivElement
  private showAllCheckbox!: HTMLInputElement
  private playerCheckboxes = new Map<string, HTMLInputElement>()

  constructor(controller: ReplayController) {
    this.controller = controller

    // Outer wrapper
    this.container = document.createElement('div')
    this.container.style.cssText = `
      position: fixed;
      top: 12px;
      left: 12px;
      z-index: 100;
      font-family: Arial, sans-serif;
    `

    // Toggle button
    this.toggleBtn = document.createElement('button')
    this.toggleBtn.textContent = '\uD83C\uDCA0 Cards'
    this.toggleBtn.style.cssText = `
      background: #181830;
      border: 1px solid #2a2a50;
      color: #d4d4d8;
      padding: 6px 12px;
      border-radius: 6px;
      cursor: pointer;
      font-size: 13px;
      font-weight: bold;
    `
    this.toggleBtn.addEventListener('click', () => this.toggle())
    this.container.appendChild(this.toggleBtn)

    // Panel
    this.panelDiv = document.createElement('div')
    this.panelDiv.style.cssText = `
      display: none;
      background: #181830;
      border: 1px solid #2a2a50;
      border-radius: 8px;
      padding: 12px;
      margin-top: 6px;
      min-width: 180px;
    `
    this.container.appendChild(this.panelDiv)
  }

  mount(): void {
    document.body.appendChild(this.container)
    this.buildPanel()
  }

  unmount(): void {
    this.container.remove()
  }

  private buildPanel(): void {
    this.panelDiv.innerHTML = ''

    const title = document.createElement('div')
    title.textContent = 'Card Visibility'
    title.style.cssText = `
      font-size: 13px;
      font-weight: bold;
      color: #ccc;
      margin-bottom: 10px;
    `
    this.panelDiv.appendChild(title)

    // Show All Cards toggle
    const allRow = this.createCheckboxRow('Show All Cards', true, (checked) => {
      this.controller.setShowAllCards(checked)
    })
    this.showAllCheckbox = allRow.checkbox
    this.panelDiv.appendChild(allRow.row)

    // Separator
    const sep = document.createElement('hr')
    sep.style.cssText = 'border: none; border-top: 1px solid #2a2a50; margin: 8px 0;'
    this.panelDiv.appendChild(sep)

    // Per-player checkboxes
    const players = this.controller.getReplayPlayers()
    if (players.length === 0) {
      const note = document.createElement('div')
      note.textContent = 'No player data available'
      note.style.cssText = 'font-size: 11px; color: #666;'
      this.panelDiv.appendChild(note)
    } else {
      for (const player of players) {
        const { row, checkbox } = this.createCheckboxRow(
          player.displayName,
          true,
          (checked) => {
            this.controller.setPlayerCardVisibility(player.id, checked)
          },
        )
        this.playerCheckboxes.set(player.id, checkbox)
        this.panelDiv.appendChild(row)
      }
    }
  }

  private createCheckboxRow(
    label: string,
    defaultChecked: boolean,
    onChange: (checked: boolean) => void,
  ): { row: HTMLDivElement; checkbox: HTMLInputElement } {
    const row = document.createElement('div')
    row.style.cssText = `
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 3px 0;
      cursor: pointer;
    `

    const checkbox = document.createElement('input')
    checkbox.type = 'checkbox'
    checkbox.checked = defaultChecked
    checkbox.style.cssText = `
      cursor: pointer;
      accent-color: #2563eb;
      width: 16px;
      height: 16px;
    `

    const labelEl = document.createElement('span')
    labelEl.textContent = label
    labelEl.style.cssText = `
      font-size: 12px;
      color: #d4d4d8;
      cursor: pointer;
    `

    checkbox.addEventListener('change', () => onChange(checkbox.checked))
    labelEl.addEventListener('click', () => {
      checkbox.checked = !checkbox.checked
      onChange(checkbox.checked)
    })

    row.append(checkbox, labelEl)
    return { row, checkbox }
  }

  private toggle(): void {
    this.isOpen = !this.isOpen
    this.panelDiv.style.display = this.isOpen ? 'block' : 'none'
    this.toggleBtn.style.borderColor = this.isOpen ? '#2563eb' : '#2a2a50'
  }

  /** Rebuild player list (call after replay players are loaded) */
  refresh(): void {
    this.buildPanel()
  }
}
