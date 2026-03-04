import { Application, Container, Graphics, Text, Ticker } from 'pixi.js';
import { CANVAS_WIDTH, CANVAS_HEIGHT, COLORS } from '../constants';
import { tween, delay, easeOutElastic, easeOutCubic } from '../utils/Animations';
import type { Standing } from '../types';

const CONFETTI_COLORS = [0xffd700, 0xff4444, 0x4488ff, 0x44cc44, 0xffffff, 0xff88ff];
const CONFETTI_COUNT = 80;
const CONFETTI_DURATION = 8000;

interface ConfettiPiece {
  gfx: Graphics;
  vx: number;
  vy: number;
  vr: number;
}

export class VictoryOverlay extends Container {
  private app: Application;
  private overlay!: Graphics;
  private confettiContainer!: Container;
  private textContainer!: Container;
  private confettiPieces: ConfettiPiece[] = [];
  private confettiTickerFn: ((t: Ticker) => void) | null = null;

  constructor(app: Application) {
    super();
    this.app = app;
    this.visible = false;

    // Dark overlay
    this.overlay = new Graphics();
    this.overlay.rect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
    this.overlay.fill({ color: 0x000000, alpha: 0.8 });
    this.addChild(this.overlay);

    // Confetti layer
    this.confettiContainer = new Container();
    this.addChild(this.confettiContainer);

    // Text layer
    this.textContainer = new Container();
    this.addChild(this.textContainer);
  }

  async show(standings: Standing[], reason: string): Promise<void> {
    // Clean any previous state
    this.textContainer.removeChildren();
    this.stopConfetti();
    this.confettiContainer.removeChildren();
    this.confettiPieces = [];

    this.visible = true;
    this.alpha = 0;

    const winner = standings.find((s) => s.rank === 1);
    const centerX = CANVAS_WIDTH / 2;

    // Fade in overlay
    await tween(this.app.ticker, {
      target: this, duration: 400, easing: easeOutCubic,
      props: { alpha: 1 },
    });

    // Start confetti
    this.startConfetti();

    // "WINNER" title
    const titleText = new Text({
      text: reason === 'completed' ? 'WINNER!' : 'GAME OVER',
      style: {
        fontSize: 52,
        fill: COLORS.gold,
        fontFamily: 'Arial',
        fontWeight: 'bold',
        letterSpacing: 8,
        stroke: { color: 0x000000, width: 5 },
        dropShadow: {
          color: 0xffd700,
          blur: 16,
          alpha: 0.4,
          distance: 0,
        },
      },
    });
    titleText.anchor.set(0.5);
    titleText.x = centerX;
    titleText.y = 200;
    titleText.scale.set(2);
    titleText.alpha = 0;
    this.textContainer.addChild(titleText);

    await tween(this.app.ticker, {
      target: titleText, duration: 700, easing: easeOutElastic,
      props: { scaleX: 1, scaleY: 1, alpha: 1 },
    });

    // Winner name
    if (winner) {
      const nameText = new Text({
        text: winner.displayName,
        style: {
          fontSize: 40,
          fill: 0xffffff,
          fontFamily: 'Arial',
          fontWeight: 'bold',
          stroke: { color: 0x000000, width: 4 },
        },
      });
      nameText.anchor.set(0.5);
      nameText.x = centerX;
      nameText.y = 290;
      nameText.alpha = 0;
      this.textContainer.addChild(nameText);

      await tween(this.app.ticker, {
        target: nameText, duration: 300, easing: easeOutCubic,
        props: { alpha: 1 },
      });
    }

    await delay(400);

    // Standings
    const standingsHeader = new Text({
      text: 'FINAL STANDINGS',
      style: {
        fontSize: 16,
        fill: COLORS.textMuted,
        fontFamily: 'Arial',
        fontWeight: 'bold',
        letterSpacing: 4,
      },
    });
    standingsHeader.anchor.set(0.5);
    standingsHeader.x = centerX;
    standingsHeader.y = 380;
    standingsHeader.alpha = 0;
    this.textContainer.addChild(standingsHeader);

    await tween(this.app.ticker, {
      target: standingsHeader, duration: 300, easing: easeOutCubic,
      props: { alpha: 1 },
    });

    // Standings rows
    const sorted = [...standings].sort((a, b) => a.rank - b.rank);
    const rowY = 420;
    const rowSpacing = 36;

    for (let i = 0; i < sorted.length; i++) {
      const s = sorted[i];
      const isFirst = s.rank === 1;
      const y = rowY + i * rowSpacing;

      const rankLabels = ['1st', '2nd', '3rd', '4th', '5th', '6th', '7th', '8th', '9th'];
      const rankLabel = rankLabels[s.rank - 1] ?? `${s.rank}th`;

      const row = new Container();
      row.x = centerX;
      row.y = y;
      row.alpha = 0;

      // Rank
      const rankText = new Text({
        text: rankLabel,
        style: {
          fontSize: isFirst ? 20 : 16,
          fill: isFirst ? COLORS.gold : COLORS.textMuted,
          fontFamily: 'Arial',
          fontWeight: isFirst ? 'bold' : 'normal',
        },
      });
      rankText.anchor.set(1, 0.5);
      rankText.x = -120;
      row.addChild(rankText);

      // Name
      const nameText = new Text({
        text: s.displayName,
        style: {
          fontSize: isFirst ? 20 : 16,
          fill: isFirst ? 0xffffff : COLORS.textLight,
          fontFamily: 'Arial',
          fontWeight: isFirst ? 'bold' : 'normal',
        },
      });
      nameText.anchor.set(0, 0.5);
      nameText.x = -90;
      row.addChild(nameText);

      // Stack
      const stackText = new Text({
        text: `$${s.finalStack.toLocaleString()}`,
        style: {
          fontSize: isFirst ? 20 : 16,
          fill: isFirst ? COLORS.gold : COLORS.textMuted,
          fontFamily: 'Arial',
          fontWeight: isFirst ? 'bold' : 'normal',
        },
      });
      stackText.anchor.set(1, 0.5);
      stackText.x = 180;
      row.addChild(stackText);

      this.textContainer.addChild(row);

      // Staggered fade-in
      await tween(this.app.ticker, {
        target: row, duration: 250, easing: easeOutCubic,
        props: { alpha: 1 },
      });
    }

    // "Game Over" footer
    await delay(300);

    const footerText = new Text({
      text: 'Game Over',
      style: {
        fontSize: 14,
        fill: COLORS.textMuted,
        fontFamily: 'Arial',
        fontStyle: 'italic',
      },
    });
    footerText.anchor.set(0.5);
    footerText.x = centerX;
    footerText.y = rowY + sorted.length * rowSpacing + 30;
    footerText.alpha = 0;
    this.textContainer.addChild(footerText);

    await tween(this.app.ticker, {
      target: footerText, duration: 300, easing: easeOutCubic,
      props: { alpha: 1 },
    });
  }

  private startConfetti(): void {
    let spawned = 0;
    const spawnRate = CONFETTI_COUNT / (CONFETTI_DURATION / 1000 * 60); // pieces per frame at 60fps

    this.confettiTickerFn = (ticker: Ticker) => {
      // Spawn new pieces
      if (spawned < CONFETTI_COUNT) {
        const toSpawn = Math.ceil(spawnRate * ticker.deltaTime);
        for (let i = 0; i < toSpawn && spawned < CONFETTI_COUNT; i++) {
          this.spawnConfettiPiece();
          spawned++;
        }
      }

      // Update existing pieces
      for (let i = this.confettiPieces.length - 1; i >= 0; i--) {
        const p = this.confettiPieces[i];
        p.gfx.x += p.vx * ticker.deltaTime;
        p.gfx.y += p.vy * ticker.deltaTime;
        p.gfx.rotation += p.vr * ticker.deltaTime;

        // Remove if fallen below canvas
        if (p.gfx.y > CANVAS_HEIGHT + 20) {
          this.confettiContainer.removeChild(p.gfx);
          p.gfx.destroy();
          this.confettiPieces.splice(i, 1);
        }
      }
    };

    this.app.ticker.add(this.confettiTickerFn);
  }

  private spawnConfettiPiece(): void {
    const color = CONFETTI_COLORS[Math.floor(Math.random() * CONFETTI_COLORS.length)];
    const gfx = new Graphics();
    const w = 4 + Math.random() * 6;
    const h = 3 + Math.random() * 8;
    gfx.rect(-w / 2, -h / 2, w, h);
    gfx.fill(color);

    gfx.x = Math.random() * CANVAS_WIDTH;
    gfx.y = -10 - Math.random() * 40;
    gfx.rotation = Math.random() * Math.PI * 2;

    const piece: ConfettiPiece = {
      gfx,
      vx: (Math.random() - 0.5) * 2,
      vy: 1.5 + Math.random() * 3,
      vr: (Math.random() - 0.5) * 0.15,
    };

    this.confettiPieces.push(piece);
    this.confettiContainer.addChild(gfx);
  }

  private stopConfetti(): void {
    if (this.confettiTickerFn) {
      this.app.ticker.remove(this.confettiTickerFn);
      this.confettiTickerFn = null;
    }
    for (const p of this.confettiPieces) {
      p.gfx.destroy();
    }
    this.confettiPieces = [];
    this.confettiContainer.removeChildren();
  }
}
