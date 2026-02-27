import { Container, Graphics, Text } from 'pixi.js';
import { CANVAS_WIDTH, COLORS } from '../constants';
import type { TournamentInfo } from '../types';

const BAR_HEIGHT = 32;
const BAR_Y = 0;

export class TournamentInfoBar extends Container {
  private bg: Graphics;
  private blindText: Text;
  private timerText: Text;
  private playersText: Text;
  private avgStackText: Text;
  private timerInterval: ReturnType<typeof setInterval> | null = null;
  private nextBlindChangeAt: number | null = null;
  private isPaused = false;

  constructor() {
    super();
    this.y = BAR_Y;

    // Background bar
    this.bg = new Graphics();
    this.bg.rect(0, 0, CANVAS_WIDTH, BAR_HEIGHT);
    this.bg.fill({ color: 0x0a0a1a, alpha: 0.85 });
    this.addChild(this.bg);

    // Blind level text (left)
    this.blindText = new Text({
      text: '',
      style: { fontSize: 12, fill: 0xfbbf24, fontFamily: 'Arial', fontWeight: 'bold' },
    });
    this.blindText.x = 15;
    this.blindText.y = 8;
    this.addChild(this.blindText);

    // Timer text (center-left)
    this.timerText = new Text({
      text: '',
      style: { fontSize: 12, fill: COLORS.textWhite, fontFamily: 'Arial', fontWeight: 'bold' },
    });
    this.timerText.x = 380;
    this.timerText.y = 8;
    this.addChild(this.timerText);

    // Players remaining (center-right)
    this.playersText = new Text({
      text: '',
      style: { fontSize: 12, fill: COLORS.textLight, fontFamily: 'Arial' },
    });
    this.playersText.x = 580;
    this.playersText.y = 8;
    this.addChild(this.playersText);

    // Average stack (right)
    this.avgStackText = new Text({
      text: '',
      style: { fontSize: 12, fill: COLORS.textMuted, fontFamily: 'Arial' },
    });
    this.avgStackText.x = 740;
    this.avgStackText.y = 8;
    this.addChild(this.avgStackText);

    // Start countdown timer
    this.timerInterval = setInterval(() => this.updateCountdown(), 1000);
  }

  update(tournament: TournamentInfo): void {
    const level = tournament.blindSchedule[tournament.currentBlindLevel];
    if (!level) return;

    const anteStr = level.ante > 0 ? ` (ante ${level.ante})` : '';
    this.blindText.text = `Level ${level.level} — ${level.smallBlind}/${level.bigBlind}${anteStr}`;

    this.nextBlindChangeAt = tournament.nextBlindChangeAt;
    this.isPaused = tournament.isPaused;
    this.updateCountdown();

    this.playersText.text = `Players: ${tournament.playersRemaining}/${tournament.totalPlayers}`;
    this.avgStackText.text = `Avg: ${tournament.averageStack.toLocaleString()}`;
  }

  private updateCountdown(): void {
    if (this.isPaused) {
      this.timerText.text = 'PAUSED';
      this.timerText.style.fill = 0xef4444;
      return;
    }

    if (this.nextBlindChangeAt == null) {
      this.timerText.text = '';
      return;
    }

    const remainingMs = Math.max(0, this.nextBlindChangeAt - Date.now());
    const totalSec = Math.ceil(remainingMs / 1000);
    const min = Math.floor(totalSec / 60);
    const sec = totalSec % 60;
    this.timerText.text = `Next level: ${min}:${sec.toString().padStart(2, '0')}`;

    // Color coding: green > 60s, yellow > 30s, red <= 30s
    if (totalSec <= 30) {
      this.timerText.style.fill = 0xef4444;
    } else if (totalSec <= 60) {
      this.timerText.style.fill = 0xfbbf24;
    } else {
      this.timerText.style.fill = COLORS.textWhite;
    }
  }

  destroy(): void {
    if (this.timerInterval) {
      clearInterval(this.timerInterval);
      this.timerInterval = null;
    }
    super.destroy();
  }
}
