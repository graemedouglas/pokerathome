import { Container, Graphics, Text } from 'pixi.js'
import { CANVAS_WIDTH, CANVAS_HEIGHT, COLORS } from '../constants'
import type { ReplayController } from '../network/replay-controller'
import type { ReplayStatePayload } from '@pokerathome/schema'

const PANEL_WIDTH = 620
const PANEL_HEIGHT = 70
const BTN_SIZE = 32
const BTN_GAP = 8
const BTN_RADIUS = 6

const STAGE_LABELS: Record<string, string> = {
  PRE_FLOP: 'Pre-Flop',
  FLOP: 'Flop',
  TURN: 'Turn',
  RIVER: 'River',
  SHOWDOWN: 'Showdown',
}

const SPEEDS = [0.5, 1, 2, 4]

export class ReplayControls extends Container {
  private controller: ReplayController
  private playPauseIcon!: Text
  private positionText!: Text
  private handStageText!: Text
  private speedButtons: { btn: Container; bg: Graphics; text: Text; speed: number }[] = []
  private scrubberFill!: Graphics
  private scrubberTrack!: Graphics
  private isPlaying = false
  private currentPosition = 0
  private totalEntries = 0

  constructor(controller: ReplayController) {
    super()
    this.controller = controller
    this.x = CANVAS_WIDTH / 2
    this.y = CANVAS_HEIGHT - 50
    this.eventMode = 'static'

    this.buildPanel()

    // Listen for state updates
    controller.onReplayState((payload) => this.onStateUpdate(payload))
  }

  private buildPanel(): void {
    // Background panel
    const bg = new Graphics()
    bg.roundRect(-PANEL_WIDTH / 2, -PANEL_HEIGHT / 2, PANEL_WIDTH, PANEL_HEIGHT, 14)
    bg.fill({ color: 0x0f172a, alpha: 0.95 })
    bg.stroke({ color: 0x334155, width: 1 })
    this.addChild(bg)

    // ─── Transport buttons ────────────────────────────────────────────────────

    const transportX = -PANEL_WIDTH / 2 + 24
    const transportY = -6

    const buttons = [
      { label: '\u23EE', tooltip: 'Round Start', action: () => this.controller.jumpRoundStart() },
      { label: '\u23EA', tooltip: 'Step Back', action: () => this.controller.stepBackward() },
      { label: '\u25B6', tooltip: 'Play', action: () => this.togglePlayPause() },
      { label: '\u23E9', tooltip: 'Step Forward', action: () => this.controller.stepForward() },
      { label: '\u23ED', tooltip: 'Next Round', action: () => this.controller.jumpNextRound() },
    ]

    for (let i = 0; i < buttons.length; i++) {
      const def = buttons[i]
      const btn = this.makeTransportBtn(
        def.label,
        transportX + i * (BTN_SIZE + BTN_GAP) + BTN_SIZE / 2,
        transportY,
        def.action,
      )
      this.addChild(btn)

      // Store play/pause button reference
      if (i === 2) {
        this.playPauseIcon = btn.children.find(c => c instanceof Text) as Text
      }
    }

    // ─── Speed buttons ────────────────────────────────────────────────────────

    const speedStartX = transportX + 5 * (BTN_SIZE + BTN_GAP) + 20
    const speedLabel = new Text({
      text: 'Speed:',
      style: { fontSize: 11, fill: COLORS.textMuted, fontFamily: 'Arial' },
    })
    speedLabel.x = speedStartX
    speedLabel.y = transportY - 6
    this.addChild(speedLabel)

    const speedBtnX = speedStartX + 50
    for (let i = 0; i < SPEEDS.length; i++) {
      const speed = SPEEDS[i]
      const { btn, bg, text } = this.makeSpeedBtn(
        `${speed}x`,
        speedBtnX + i * 44,
        transportY,
        speed,
      )
      this.addChild(btn)
      this.speedButtons.push({ btn, bg, text, speed })
    }
    // Highlight 1x by default
    this.updateSpeedHighlight(1)

    // ─── Position text ────────────────────────────────────────────────────────

    this.positionText = new Text({
      text: '0 / 0',
      style: { fontSize: 11, fill: COLORS.textLight, fontFamily: 'Arial' },
    })
    this.positionText.anchor.set(1, 0.5)
    this.positionText.x = PANEL_WIDTH / 2 - 16
    this.positionText.y = transportY
    this.addChild(this.positionText)

    // ─── Scrubber bar ─────────────────────────────────────────────────────────

    const scrubberY = PANEL_HEIGHT / 2 - 14
    const scrubberW = PANEL_WIDTH - 32

    this.scrubberTrack = new Graphics()
    this.scrubberTrack.roundRect(-scrubberW / 2, -3, scrubberW, 6, 3)
    this.scrubberTrack.fill(0x334155)
    this.scrubberTrack.y = scrubberY
    this.scrubberTrack.eventMode = 'static'
    this.scrubberTrack.cursor = 'pointer'
    this.scrubberTrack.hitArea = {
      contains: (x: number, y: number) =>
        Math.abs(x) <= scrubberW / 2 && Math.abs(y) <= 8,
    }
    this.addChild(this.scrubberTrack)

    this.scrubberFill = new Graphics()
    this.scrubberFill.y = scrubberY
    this.addChild(this.scrubberFill)

    // Click on scrubber to seek
    this.scrubberTrack.on('pointerdown', (e) => {
      const local = this.toLocal(e.global)
      const ratio = (local.x + scrubberW / 2) / scrubberW
      const clamped = Math.max(0, Math.min(1, ratio))
      const pos = Math.round(clamped * Math.max(0, this.totalEntries - 1))
      this.controller.setPosition(pos)
    })

    // ─── Hand/stage label ─────────────────────────────────────────────────────

    this.handStageText = new Text({
      text: '',
      style: { fontSize: 10, fill: COLORS.textMuted, fontFamily: 'Arial', fontStyle: 'italic' },
    })
    this.handStageText.anchor.set(0.5)
    this.handStageText.x = 0
    this.handStageText.y = scrubberY - 12
    this.addChild(this.handStageText)
  }

  private makeTransportBtn(label: string, x: number, y: number, onClick: () => void): Container {
    const btn = new Container()
    btn.x = x
    btn.y = y
    btn.eventMode = 'static'
    btn.cursor = 'pointer'
    btn.hitArea = {
      contains: (px: number, py: number) =>
        Math.abs(px) <= BTN_SIZE / 2 && Math.abs(py) <= BTN_SIZE / 2,
    }

    const bg = new Graphics()
    bg.roundRect(-BTN_SIZE / 2, -BTN_SIZE / 2, BTN_SIZE, BTN_SIZE, BTN_RADIUS)
    bg.fill(0x1e293b)
    bg.stroke({ color: 0x475569, width: 0.5 })
    btn.addChild(bg)

    const text = new Text({
      text: label,
      style: { fontSize: 16, fill: 0xd4d4d8, fontFamily: 'Arial' },
    })
    text.anchor.set(0.5)
    btn.addChild(text)

    btn.on('pointerdown', onClick)
    btn.on('pointerover', () => {
      bg.clear()
      bg.roundRect(-BTN_SIZE / 2, -BTN_SIZE / 2, BTN_SIZE, BTN_SIZE, BTN_RADIUS)
      bg.fill(0x334155)
      text.style.fill = 0xffffff
    })
    btn.on('pointerout', () => {
      bg.clear()
      bg.roundRect(-BTN_SIZE / 2, -BTN_SIZE / 2, BTN_SIZE, BTN_SIZE, BTN_RADIUS)
      bg.fill(0x1e293b)
      bg.stroke({ color: 0x475569, width: 0.5 })
      text.style.fill = 0xd4d4d8
    })

    return btn
  }

  private makeSpeedBtn(
    label: string,
    x: number,
    y: number,
    speed: number,
  ): { btn: Container; bg: Graphics; text: Text } {
    const w = 38
    const h = 24
    const btn = new Container()
    btn.x = x
    btn.y = y
    btn.eventMode = 'static'
    btn.cursor = 'pointer'
    btn.hitArea = {
      contains: (px: number, py: number) =>
        Math.abs(px) <= w / 2 && Math.abs(py) <= h / 2,
    }

    const bg = new Graphics()
    bg.roundRect(-w / 2, -h / 2, w, h, 4)
    bg.fill(0x1e293b)
    bg.stroke({ color: 0x475569, width: 0.5 })
    btn.addChild(bg)

    const text = new Text({
      text: label,
      style: { fontSize: 11, fill: 0x94a3b8, fontFamily: 'Arial', fontWeight: 'bold' },
    })
    text.anchor.set(0.5)
    btn.addChild(text)

    btn.on('pointerdown', () => {
      this.controller.setSpeed(speed)
      this.updateSpeedHighlight(speed)
    })

    return { btn, bg, text }
  }

  private updateSpeedHighlight(activeSpeed: number): void {
    for (const { bg, text, speed } of this.speedButtons) {
      const w = 38
      const h = 24
      bg.clear()
      bg.roundRect(-w / 2, -h / 2, w, h, 4)
      if (speed === activeSpeed) {
        bg.fill(0x2563eb)
        text.style.fill = 0xffffff
      } else {
        bg.fill(0x1e293b)
        bg.stroke({ color: 0x475569, width: 0.5 })
        text.style.fill = 0x94a3b8
      }
    }
  }

  private togglePlayPause(): void {
    if (this.isPlaying) {
      this.controller.pause()
    } else {
      this.controller.play()
    }
  }

  private updateScrubber(): void {
    const scrubberW = PANEL_WIDTH - 32
    const ratio = this.totalEntries > 1
      ? this.currentPosition / (this.totalEntries - 1)
      : 0
    const fillW = Math.max(0, scrubberW * ratio)

    this.scrubberFill.clear()
    if (fillW > 0) {
      this.scrubberFill.roundRect(-scrubberW / 2, -3, fillW, 6, 3)
      this.scrubberFill.fill(0x2563eb)
    }
  }

  private onStateUpdate(payload: ReplayStatePayload): void {
    this.currentPosition = payload.position
    this.totalEntries = payload.totalEntries
    this.isPlaying = payload.isPlaying

    // Update play/pause icon
    if (this.playPauseIcon) {
      this.playPauseIcon.text = this.isPlaying ? '\u23F8' : '\u25B6'
    }

    // Update position text
    this.positionText.text = `${payload.position + 1} / ${payload.totalEntries}`

    // Update speed highlight
    this.updateSpeedHighlight(payload.speed)

    // Update scrubber
    this.updateScrubber()

    // Update hand/stage label
    const stageLabel = STAGE_LABELS[payload.stage] ?? payload.stage
    this.handStageText.text = payload.handNumber > 0
      ? `Hand #${payload.handNumber} \u2022 ${stageLabel}`
      : stageLabel
  }
}
