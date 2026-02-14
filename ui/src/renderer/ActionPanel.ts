import { Container, Graphics, Text, FederatedPointerEvent } from 'pixi.js';
import { AvailableActions, PlayerAction } from '../types';
import { CANVAS_WIDTH, CANVAS_HEIGHT, BIG_BLIND } from '../constants';

type ActionCallback = (action: PlayerAction) => void;

interface DebugButton {
  label: string;
  globalX: number;
  globalY: number;
}

interface PokerDebug {
  visible: boolean;
  buttons: DebugButton[];
}

declare global {
  interface Window {
    __pokerDebug?: PokerDebug;
  }
}

const BTN_FOLD = 0xb91c1c;
const BTN_FOLD_HOVER = 0xdc2626;
const BTN_CHECK = 0x2563eb;
const BTN_CHECK_HOVER = 0x3b82f6;
const BTN_CALL = 0x16a34a;
const BTN_CALL_HOVER = 0x22c55e;
const BTN_RAISE = 0xd97706;
const BTN_RAISE_HOVER = 0xf59e0b;
const BTN_PRESET_BG = 0x1e293b;
const BTN_PRESET_HOVER = 0x334155;

const PANEL_WIDTH = 560;
const PANEL_HEIGHT_FULL = 140;   // with raise controls
const PANEL_HEIGHT_SHORT = 70;   // without raise controls
const BTN_HEIGHT = 42;
const BTN_RADIUS = 8;
const TRACK_WIDTH = 220;
const SLIDER_ROW_Y = -38;
const PRESET_ROW_Y = -10;
const ACTION_ROW_Y_FULL = 32;
const ACTION_ROW_Y_SHORT = 0;

export class ActionPanel extends Container {
  private buttons: Container[] = [];
  private raiseSection!: Container;
  private sliderTrack!: Graphics;
  private sliderFill!: Graphics;
  private sliderKnob!: Graphics;
  private betAmountText!: Text;
  private betAmountBg!: Graphics;
  private amountGroup!: Container;
  private raiseAmount = 0;
  private minRaise = 0;
  private maxRaise = 0;
  private currentPot = 0;
  private callback: ActionCallback | null = null;
  private bgPanel!: Graphics;
  private raiseButtonText: Text | null = null;
  private raiseType: 'BET' | 'RAISE' | null = null;
  private timerBar!: Graphics;
  private timerRafId: number | null = null;
  private timerEndTime = 0;
  private timerTotalMs = 0;
  private currentPanelH = PANEL_HEIGHT_FULL;

  constructor() {
    super();
    this.x = CANVAS_WIDTH / 2;
    this.y = CANVAS_HEIGHT - 80;
    this.visible = false;
    this.eventMode = 'static';

    // Background panel
    this.bgPanel = new Graphics();
    this.drawBgPanel(PANEL_HEIGHT_FULL);
    this.addChild(this.bgPanel);

    // Timer bar (shown during action countdown)
    this.timerBar = new Graphics();
    this.timerBar.visible = false;
    this.addChild(this.timerBar);

    // Raise section (slider row + presets row) - hidden when raise not available
    this.raiseSection = new Container();
    this.addChild(this.raiseSection);

    this.buildSliderRow();
    this.buildPresetRow();
    this.setupDragHandling();
  }

  private drawBgPanel(h: number): void {
    this.bgPanel.clear();
    this.bgPanel.roundRect(-PANEL_WIDTH / 2, -h / 2, PANEL_WIDTH, h, 14);
    this.bgPanel.fill({ color: 0x0f172a, alpha: 0.95 });
    this.bgPanel.stroke({ color: 0x334155, width: 1 });
  }

  private buildSliderRow(): void {
    const row = new Container();
    row.y = SLIDER_ROW_Y;
    this.raiseSection.addChild(row);

    const trackX = -PANEL_WIDTH / 2 + 24;

    // Slider track
    this.sliderTrack = new Graphics();
    this.sliderTrack.roundRect(trackX, -4, TRACK_WIDTH, 8, 4);
    this.sliderTrack.fill(0x334155);
    this.sliderTrack.eventMode = 'static';
    this.sliderTrack.cursor = 'pointer';
    row.addChild(this.sliderTrack);

    // Slider fill
    this.sliderFill = new Graphics();
    row.addChild(this.sliderFill);

    // Slider knob
    this.sliderKnob = new Graphics();
    this.sliderKnob.circle(0, 0, 10);
    this.sliderKnob.fill(0xfbbf24);
    this.sliderKnob.stroke({ color: 0xffffff, width: 2 });
    this.sliderKnob.x = trackX;
    this.sliderKnob.eventMode = 'static';
    this.sliderKnob.cursor = 'grab';
    row.addChild(this.sliderKnob);

    // Controls: [-] [$amount] [+]
    const controlsX = trackX + TRACK_WIDTH + 30;

    const minusBtn = this.makeSmallBtn('-', controlsX - 55, () => {
      this.setRaiseAmount(this.raiseAmount - BIG_BLIND);
    });
    row.addChild(minusBtn);

    // Bet amount display (clickable to type)
    this.amountGroup = new Container();
    this.amountGroup.x = controlsX;
    this.amountGroup.eventMode = 'static';
    this.amountGroup.cursor = 'text';
    this.amountGroup.hitArea = { contains: (x: number, y: number) => Math.abs(x) <= 42 && Math.abs(y) <= 16 };
    this.amountGroup.on('pointerdown', () => this.showBetInput());

    this.betAmountBg = new Graphics();
    this.betAmountBg.roundRect(-42, -16, 84, 32, 6);
    this.betAmountBg.fill(0x0a0f1e);
    this.betAmountBg.stroke({ color: 0x475569, width: 1 });
    this.amountGroup.addChild(this.betAmountBg);

    this.betAmountText = new Text({
      text: '$0',
      style: { fontSize: 14, fill: 0xfbbf24, fontFamily: 'Arial', fontWeight: 'bold' },
    });
    this.betAmountText.anchor.set(0.5);
    this.amountGroup.addChild(this.betAmountText);
    row.addChild(this.amountGroup);

    const plusBtn = this.makeSmallBtn('+', controlsX + 55, () => {
      this.setRaiseAmount(this.raiseAmount + BIG_BLIND);
    });
    row.addChild(plusBtn);
  }

  private makeSmallBtn(label: string, x: number, onClick: () => void): Container {
    const btn = new Container();
    btn.x = x;
    btn.eventMode = 'static';
    btn.cursor = 'pointer';
    btn.hitArea = { contains: (px: number, py: number) => Math.abs(px) <= 15 && Math.abs(py) <= 15 };

    const bg = new Graphics();
    bg.roundRect(-14, -14, 28, 28, 5);
    bg.fill(0x1e293b);
    bg.stroke({ color: 0x475569, width: 0.5 });
    btn.addChild(bg);

    const text = new Text({
      text: label,
      style: { fontSize: 16, fill: 0x94a3b8, fontFamily: 'Arial', fontWeight: 'bold' },
    });
    text.anchor.set(0.5);
    btn.addChild(text);

    btn.on('pointerdown', onClick);
    btn.on('pointerover', () => {
      bg.clear(); bg.roundRect(-14, -14, 28, 28, 5); bg.fill(0x334155);
      text.style.fill = 0xe2e8f0;
    });
    btn.on('pointerout', () => {
      bg.clear(); bg.roundRect(-14, -14, 28, 28, 5); bg.fill(0x1e293b);
      bg.stroke({ color: 0x475569, width: 0.5 });
      text.style.fill = 0x94a3b8;
    });

    return btn;
  }

  private buildPresetRow(): void {
    const row = new Container();
    row.y = PRESET_ROW_Y;
    this.raiseSection.addChild(row);

    const presets = [
      { label: 'Min', fn: () => this.setRaiseAmount(this.minRaise) },
      { label: '┬╜ Pot', fn: () => this.setRaiseAmount(Math.floor(this.currentPot / 2)) },
      { label: '┬╛ Pot', fn: () => this.setRaiseAmount(Math.floor(this.currentPot * 0.75)) },
      { label: 'Pot', fn: () => this.setRaiseAmount(this.currentPot) },
      { label: 'All In', fn: () => this.setRaiseAmount(this.maxRaise) },
    ];

    // Align presets to span the same width as the slider track
    const trackX = -PANEL_WIDTH / 2 + 24;
    const gap = 4;
    const btnW = (TRACK_WIDTH - (presets.length - 1) * gap) / presets.length;

    for (let i = 0; i < presets.length; i++) {
      const preset = presets[i];
      const px = trackX + i * (btnW + gap) + btnW / 2;

      const btn = new Container();
      btn.x = px;
      btn.eventMode = 'static';
      btn.cursor = 'pointer';
      btn.hitArea = { contains: (bx: number, by: number) => Math.abs(bx) <= btnW / 2 + 1 && Math.abs(by) <= 12 };

      const bg = new Graphics();
      bg.roundRect(-btnW / 2, -11, btnW, 22, 4);
      bg.fill(BTN_PRESET_BG);
      bg.stroke({ color: 0x475569, width: 0.5 });
      btn.addChild(bg);

      const text = new Text({
        text: preset.label,
        style: { fontSize: 10, fill: 0x94a3b8, fontFamily: 'Arial', fontWeight: 'bold' },
      });
      text.anchor.set(0.5);
      btn.addChild(text);

      btn.on('pointerdown', preset.fn);
      btn.on('pointerover', () => {
        bg.clear(); bg.roundRect(-btnW / 2, -11, btnW, 22, 4); bg.fill(BTN_PRESET_HOVER);
        text.style.fill = 0xe2e8f0;
      });
      btn.on('pointerout', () => {
        bg.clear(); bg.roundRect(-btnW / 2, -11, btnW, 22, 4); bg.fill(BTN_PRESET_BG);
        bg.stroke({ color: 0x475569, width: 0.5 });
        text.style.fill = 0x94a3b8;
      });

      row.addChild(btn);
    }
  }

  private setupDragHandling(): void {
    let dragging = false;
    const trackX = -PANEL_WIDTH / 2 + 24;

    this.sliderKnob.on('pointerdown', () => { dragging = true; });

    this.sliderTrack.on('pointerdown', (e: FederatedPointerEvent) => {
      const local = this.raiseSection.toLocal(e.global);
      this.setSliderFromX(local.x - trackX);
    });

    const onMove = (e: FederatedPointerEvent) => {
      if (!dragging) return;
      const local = this.raiseSection.toLocal(e.global);
      this.setSliderFromX(local.x - trackX);
    };
    const onUp = () => { dragging = false; };
    this.on('globalpointermove', onMove);
    this.on('pointerup', onUp);
    this.on('pointerupoutside', onUp);
  }

  private setSliderFromX(x: number): void {
    const trackX = -PANEL_WIDTH / 2 + 24;
    const clamped = Math.max(0, Math.min(TRACK_WIDTH, x));
    this.sliderKnob.x = trackX + clamped;
    const ratio = clamped / TRACK_WIDTH;
    let amount = Math.round(this.minRaise + ratio * (this.maxRaise - this.minRaise));
    amount = Math.round(amount / BIG_BLIND) * BIG_BLIND;
    amount = Math.max(this.minRaise, Math.min(amount, this.maxRaise));
    this.raiseAmount = amount;
    this.updateDisplays();

    this.sliderFill.clear();
    if (clamped > 0) {
      this.sliderFill.roundRect(trackX, -4, clamped, 8, 4);
      this.sliderFill.fill(0xfbbf24);
    }
  }

  private setRaiseAmount(amount: number): void {
    const trackX = -PANEL_WIDTH / 2 + 24;
    amount = Math.round(amount / BIG_BLIND) * BIG_BLIND;
    this.raiseAmount = Math.max(this.minRaise, Math.min(amount, this.maxRaise));
    const ratio = (this.raiseAmount - this.minRaise) / (this.maxRaise - this.minRaise || 1);
    const knobX = ratio * TRACK_WIDTH;
    this.sliderKnob.x = trackX + knobX;
    this.updateDisplays();

    this.sliderFill.clear();
    if (knobX > 0) {
      this.sliderFill.roundRect(trackX, -4, knobX, 8, 4);
      this.sliderFill.fill(0xfbbf24);
    }
  }

  private updateDisplays(): void {
    this.betAmountText.text = `$${this.raiseAmount}`;
    if (this.raiseButtonText) {
      const label = this.raiseAmount === this.maxRaise ? 'All In' :
        (this.raiseType === 'BET' ? 'Bet' : 'Raise');
      this.raiseButtonText.text = `${label}\n$${this.raiseAmount}`;
    }
  }

  private showBetInput(): void {
    const canvas = document.querySelector('canvas');
    if (!canvas) return;

    const rect = canvas.getBoundingClientRect();

    // Get the amount display's position in stage coordinates via toGlobal
    const global = this.amountGroup.toGlobal({ x: 0, y: 0 });

    // Convert stage coords to screen coords
    const screenX = rect.left + (global.x / CANVAS_WIDTH) * rect.width;
    const screenY = rect.top + (global.y / CANVAS_HEIGHT) * rect.height;

    // Scale the input size to match the canvas scale
    const scale = rect.width / CANVAS_WIDTH;
    const inputW = Math.round(90 * scale);
    const inputH = Math.round(32 * scale);
    const fontSize = Math.round(14 * scale);

    const input = document.createElement('input');
    input.type = 'text';
    input.inputMode = 'numeric';
    input.value = String(this.raiseAmount);
    input.style.cssText = `
      position: fixed;
      left: ${screenX - inputW / 2}px;
      top: ${screenY - inputH / 2}px;
      width: ${inputW}px;
      height: ${inputH}px;
      background: #0a0f1e;
      color: #fbbf24;
      border: 2px solid #fbbf24;
      border-radius: 6px;
      text-align: center;
      font-size: ${fontSize}px;
      font-weight: bold;
      font-family: Arial, sans-serif;
      outline: none;
      z-index: 10000;
      padding: 0;
    `;

    document.body.appendChild(input);
    input.focus();
    input.select();

    let applied = false;
    const applyAndCleanup = () => {
      if (applied) return;
      applied = true;
      const val = parseInt(input.value.replace(/[^0-9]/g, ''));
      if (!isNaN(val) && val > 0) {
        this.setRaiseAmount(val);
      }
      if (input.parentNode) input.parentNode.removeChild(input);
    };

    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') applyAndCleanup();
      else if (e.key === 'Escape') {
        applied = true;
        if (input.parentNode) input.parentNode.removeChild(input);
      }
    });
    input.addEventListener('blur', applyAndCleanup);
  }

  show(available: AvailableActions, pot: number, callback: ActionCallback, timeToActMs?: number): void {
    this.callback = callback;
    this.currentPot = pot;
    this.raiseType = available.raiseType;
    this.visible = true;
    this.raiseButtonText = null;

    // Clear old buttons
    for (const btn of this.buttons) this.removeChild(btn);
    this.buttons = [];

    const hasRaise = available.canRaise;
    const panelH = hasRaise ? PANEL_HEIGHT_FULL : PANEL_HEIGHT_SHORT;
    this.currentPanelH = panelH;
    const btnY = hasRaise ? ACTION_ROW_Y_FULL : ACTION_ROW_Y_SHORT;

    this.drawBgPanel(panelH);

    // Build button definitions
    const btnDefs: { label: string; color: number; hover: number; w: number; action: () => void }[] = [];

    if (available.canFold) {
      btnDefs.push({ label: 'Fold', color: BTN_FOLD, hover: BTN_FOLD_HOVER, w: 100,
        action: () => callback({ type: 'fold' }) });
    }

    if (available.canCheck) {
      btnDefs.push({ label: 'Check', color: BTN_CHECK, hover: BTN_CHECK_HOVER, w: 100,
        action: () => callback({ type: 'check' }) });
    }

    if (available.canCall) {
      btnDefs.push({ label: `Call $${available.callAmount}`, color: BTN_CALL, hover: BTN_CALL_HOVER, w: 120,
        action: () => callback({ type: 'call', amount: available.callAmount }) });
    }

    const gap = 16;

    if (hasRaise) {
      // Non-raise buttons on the left side, raise button on right
      let x = -PANEL_WIDTH / 2 + 24;
      for (const def of btnDefs) {
        this.addActionBtn(def.label, def.color, def.hover, x, btnY, def.w, def.action);
        x += def.w + gap;
      }

      this.minRaise = available.minRaise;
      this.maxRaise = available.maxRaise;
      const raiseLabel = available.raiseType === 'BET' ? 'Bet' : 'Raise';
      this.addRaiseBtn(raiseLabel, available.minRaise, btnY,
        () => callback({ type: 'raise', amount: this.raiseAmount }));

      this.raiseSection.visible = true;
      this.setRaiseAmount(available.minRaise);
    } else {
      // Center buttons when no raise
      const totalW = btnDefs.reduce((s, d) => s + d.w, 0) + Math.max(0, btnDefs.length - 1) * gap;
      let x = -totalW / 2;
      for (const def of btnDefs) {
        this.addActionBtn(def.label, def.color, def.hover, x, btnY, def.w, def.action);
        x += def.w + gap;
      }
      this.raiseSection.visible = false;
    }

    // Start action timer
    if (timeToActMs && timeToActMs > 0) {
      this.startTimer(timeToActMs);
    }

    this.updateDebugInfo();
  }

  private addActionBtn(label: string, color: number, hoverColor: number,
    x: number, y: number, w: number, onClick: () => void): void {
    const btn = new Container();
    btn.x = x + w / 2;
    btn.y = y;
    btn.eventMode = 'static';
    btn.cursor = 'pointer';
    btn.hitArea = { contains: (px: number, py: number) =>
      Math.abs(px) <= w / 2 && Math.abs(py) <= BTN_HEIGHT / 2 };

    const bg = new Graphics();
    bg.roundRect(-w / 2, -BTN_HEIGHT / 2, w, BTN_HEIGHT, BTN_RADIUS);
    bg.fill(color);
    btn.addChild(bg);

    const text = new Text({
      text: label,
      style: { fontSize: 15, fill: 0xffffff, fontFamily: 'Arial', fontWeight: 'bold' },
    });
    text.anchor.set(0.5);
    btn.addChild(text);

    btn.on('pointerdown', () => { this.hide(); onClick(); });
    btn.on('pointerover', () => {
      bg.clear(); bg.roundRect(-w / 2, -BTN_HEIGHT / 2, w, BTN_HEIGHT, BTN_RADIUS); bg.fill(hoverColor);
      btn.scale.set(1.05);
    });
    btn.on('pointerout', () => {
      bg.clear(); bg.roundRect(-w / 2, -BTN_HEIGHT / 2, w, BTN_HEIGHT, BTN_RADIUS); bg.fill(color);
      btn.scale.set(1);
    });

    this.addChild(btn);
    this.buttons.push(btn);
  }

  private addRaiseBtn(label: string, amount: number, y: number, onClick: () => void): void {
    const w = 110;
    const btn = new Container();
    btn.x = PANEL_WIDTH / 2 - w / 2 - 20;
    btn.y = y;
    btn.eventMode = 'static';
    btn.cursor = 'pointer';
    btn.hitArea = { contains: (px: number, py: number) =>
      Math.abs(px) <= w / 2 && Math.abs(py) <= BTN_HEIGHT / 2 };

    const bg = new Graphics();
    bg.roundRect(-w / 2, -BTN_HEIGHT / 2, w, BTN_HEIGHT, BTN_RADIUS);
    bg.fill(BTN_RAISE);
    btn.addChild(bg);

    const text = new Text({
      text: `${label}\n$${amount}`,
      style: { fontSize: 13, fill: 0xffffff, fontFamily: 'Arial', fontWeight: 'bold', align: 'center', lineHeight: 16 },
    });
    text.anchor.set(0.5);
    btn.addChild(text);
    this.raiseButtonText = text;

    btn.on('pointerdown', () => { this.hide(); onClick(); });
    btn.on('pointerover', () => {
      bg.clear(); bg.roundRect(-w / 2, -BTN_HEIGHT / 2, w, BTN_HEIGHT, BTN_RADIUS); bg.fill(BTN_RAISE_HOVER);
      btn.scale.set(1.05);
    });
    btn.on('pointerout', () => {
      bg.clear(); bg.roundRect(-w / 2, -BTN_HEIGHT / 2, w, BTN_HEIGHT, BTN_RADIUS); bg.fill(BTN_RAISE);
      btn.scale.set(1);
    });

    this.addChild(btn);
    this.buttons.push(btn);
  }

  hide(): void {
    this.visible = false;
    this.callback = null;
    this.raiseButtonText = null;
    this.stopTimer();
    window.__pokerDebug = { visible: false, buttons: [] };
  }

  // -- Timer --

  private startTimer(totalMs: number): void {
    this.stopTimer();
    this.timerTotalMs = totalMs;
    this.timerEndTime = performance.now() + totalMs;
    this.timerBar.visible = true;
    this.tickTimer();
  }

  updateTimer(remainingMs: number): void {
    this.timerEndTime = performance.now() + remainingMs;
    // If ticker not running but panel is visible, restart animation loop
    if (this.timerRafId === null && this.visible) {
      this.timerBar.visible = true;
      this.tickTimer();
    }
  }

  private tickTimer(): void {
    const now = performance.now();
    const remaining = Math.max(0, this.timerEndTime - now);
    const ratio = this.timerTotalMs > 0 ? remaining / this.timerTotalMs : 0;
    this.drawTimerBar(ratio);

    if (remaining > 0 && this.visible) {
      this.timerRafId = requestAnimationFrame(() => this.tickTimer());
    } else {
      this.timerRafId = null;
    }
  }

  private drawTimerBar(ratio: number): void {
    const barW = PANEL_WIDTH - 28;
    const barH = 4;
    const y = -this.currentPanelH / 2 + 8;

    this.timerBar.clear();

    // Track background
    this.timerBar.roundRect(-barW / 2, y, barW, barH, 2);
    this.timerBar.fill({ color: 0x1e293b });

    // Fill — green → yellow → red
    if (ratio > 0) {
      const color = ratio > 0.5 ? 0x22c55e : ratio > 0.2 ? 0xfbbf24 : 0xef4444;
      this.timerBar.roundRect(-barW / 2, y, barW * ratio, barH, 2);
      this.timerBar.fill({ color });
    }

    // Urgent pulse when low
    this.timerBar.alpha = ratio < 0.2 && ratio > 0
      ? 0.5 + 0.5 * Math.abs(Math.sin(performance.now() / 200))
      : 1;
  }

  private stopTimer(): void {
    if (this.timerRafId !== null) {
      cancelAnimationFrame(this.timerRafId);
      this.timerRafId = null;
    }
    this.timerBar.visible = false;
  }

  private updateDebugInfo(): void {
    const debugButtons: DebugButton[] = [];
    for (const btn of this.buttons) {
      let label = '';
      for (const child of btn.children) {
        if (child instanceof Text) {
          label = child.text.replace('\n', ' ');
          break;
        }
      }
      const global = btn.toGlobal({ x: 0, y: 0 });
      debugButtons.push({ label, globalX: global.x, globalY: global.y });
    }
    window.__pokerDebug = { visible: true, buttons: debugButtons };
  }
}