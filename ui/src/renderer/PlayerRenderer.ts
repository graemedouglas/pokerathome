import { Container, Graphics, Text, Sprite, Ticker, Texture } from 'pixi.js';
import { Player, GamePhase, Card } from '../types';
import { COLORS, CARD_WIDTH, CARD_HEIGHT, TABLE_CENTER_X, TABLE_CENTER_Y } from '../constants';
import { CardSprite } from './CardSprite';
import { generateAvatarTexture } from './AvatarRenderer';
import { ChipStack } from './ChipStack';
import { tween, easeOutBack, easeOutCubic, pulseAlpha } from '../utils/Animations';

/** Dummy card used when rendering face-down backs for other players */
const HIDDEN_CARD: Card = { suit: 'spades', rank: 'A', code: '_hidden' };

const PANEL_W = 150;
const PANEL_H = 50;
const AVATAR_SIZE = 44;

// Bet chip offsets per seat (toward table center)
const BET_OFFSETS: { x: number; y: number }[] = [
  { x: 70, y: -35 },     // seat 0 (bottom) ΓåÆ upper-right
  { x: 50, y: -30 },     // seat 1 (lower-left) ΓåÆ upper-right
  { x: 50, y: 30 },      // seat 2 (upper-left) ΓåÆ lower-right
  { x: -70, y: 35 },     // seat 3 (top) ΓåÆ lower-left
  { x: -50, y: 30 },     // seat 4 (upper-right) ΓåÆ lower-left
  { x: -50, y: -30 },    // seat 5 (lower-right) ΓåÆ upper-left
];

type AppLike = { renderer: { generateTexture: (g: Container) => Texture }; ticker: Ticker };

export class PlayerRenderer extends Container {
  private nameText: Text;
  private chipsText: Text;
  private dealerChip: Container;
  private blindLabel: Container;
  private blindText: Text;
  private cardContainer: Container;
  private highlightGlow: Graphics;
  private bgPanel: Graphics;
  private statusText: Text;
  private avatarSprite: Sprite | null = null;
  private avatarMask: Graphics | null = null;
  private avatarRing: Graphics | null = null;
  private currentAvatarId = -1;
  private betChips: ChipStack;
  private cards: CardSprite[] = [];
  private app: AppLike;
  private seatIndex: number;
  private stopPulse: (() => void) | null = null;
  /** Tracks card identity so we recreate sprites when cards change (not just count) */
  private prevCardKey = '';
  private actionPopText: Text | null = null;
  private actionPopTimeout: ReturnType<typeof setTimeout> | null = null;
  private handDescText: Text;
  private isReplayMode = false;

  constructor(seatIndex: number, app: AppLike) {
    super();
    this.app = app;
    this.seatIndex = seatIndex;

    // Highlight glow (shown when current player)
    this.highlightGlow = new Graphics();
    this.highlightGlow.roundRect(-PANEL_W / 2 - 4, -PANEL_H / 2 - 4, PANEL_W + 8, PANEL_H + 8, 12);
    this.highlightGlow.fill({ color: COLORS.highlight, alpha: 0.25 });
    this.highlightGlow.roundRect(-PANEL_W / 2 - 2, -PANEL_H / 2 - 2, PANEL_W + 4, PANEL_H + 4, 11);
    this.highlightGlow.fill({ color: COLORS.highlight, alpha: 0.12 });
    this.highlightGlow.visible = false;
    this.addChild(this.highlightGlow);

    // Background panel
    this.bgPanel = new Graphics();
    this.drawPanel(false);
    this.addChild(this.bgPanel);

    // Card container (positioned above panel)
    this.cardContainer = new Container();
    this.cardContainer.y = -PANEL_H / 2 - CARD_HEIGHT / 2 - 6;
    this.addChild(this.cardContainer);

    // Name (centered in panel)
    this.nameText = new Text({
      text: '',
      style: { fontSize: 12, fill: COLORS.textWhite, fontFamily: 'Arial', fontWeight: 'bold' },
    });
    this.nameText.anchor.set(0.5);
    this.nameText.y = -8;
    this.addChild(this.nameText);

    // Chips
    this.chipsText = new Text({
      text: '',
      style: { fontSize: 12, fill: COLORS.gold, fontFamily: 'Arial', fontWeight: 'bold' },
    });
    this.chipsText.anchor.set(0.5);
    this.chipsText.y = 10;
    this.addChild(this.chipsText);

    // Status text (overlays when folded/all-in)
    this.statusText = new Text({
      text: '',
      style: { fontSize: 10, fill: COLORS.textMuted, fontFamily: 'Arial', fontStyle: 'italic' },
    });
    this.statusText.anchor.set(0.5);
    this.statusText.y = PANEL_H / 2 + 10;
    this.addChild(this.statusText);

    // Dealer chip
    this.dealerChip = this.buildDealerChip();
    this.addChild(this.dealerChip);

    // Blind label
    this.blindLabel = new Container();
    const blindBg = new Graphics();
    blindBg.roundRect(-14, -9, 28, 18, 4);
    blindBg.fill({ color: 0x555577, alpha: 0.9 });
    this.blindLabel.addChild(blindBg);
    this.blindText = new Text({
      text: '',
      style: { fontSize: 10, fill: COLORS.textWhite, fontFamily: 'Arial', fontWeight: 'bold' },
    });
    this.blindText.anchor.set(0.5);
    this.blindLabel.addChild(this.blindText);
    this.blindLabel.y = PANEL_H / 2 + 12;
    this.blindLabel.visible = false;
    this.addChild(this.blindLabel);

    // Bet chip stack (positioned toward table center)
    this.betChips = new ChipStack();
    const betOff = BET_OFFSETS[seatIndex] || { x: 0, y: -40 };
    this.betChips.x = betOff.x;
    this.betChips.y = betOff.y;
    this.addChild(this.betChips);

    // Hand description (e.g., "Pair, J's") — shown below cards for the human player
    this.handDescText = new Text({
      text: '',
      style: {
        fontSize: 11,
        fill: 0xfbbf24,
        fontFamily: 'Arial',
        fontWeight: 'bold',
        stroke: { color: 0x000000, width: 3 },
      },
    });
    this.handDescText.anchor.set(0.5);
    this.handDescText.y = -PANEL_H / 2 - 4;
    this.addChild(this.handDescText);
  }

  /** Whether avatar goes on the right side of the panel */
  private isAvatarRight(): boolean {
    return this.seatIndex === 3 || this.seatIndex === 4 || this.seatIndex === 5;
  }

  /** X position for the avatar center */
  private getAvatarX(): number {
    const offset = PANEL_W / 2 + AVATAR_SIZE / 2 + 3;
    return this.isAvatarRight() ? offset : -offset;
  }

  private buildDealerChip(): Container {
    const chip = new Container();

    const shadow = new Graphics();
    shadow.circle(1, 1, 10);
    shadow.fill({ color: 0x000000, alpha: 0.3 });
    chip.addChild(shadow);

    const body = new Graphics();
    body.circle(0, 0, 10);
    body.fill(0xf5f5dc);
    body.stroke({ color: 0x333333, width: 1.5 });
    body.circle(0, 0, 6);
    body.stroke({ color: 0xaaaaaa, width: 0.5 });
    chip.addChild(body);

    const dText = new Text({
      text: 'D',
      style: { fontSize: 11, fill: 0x222222, fontFamily: 'Arial', fontWeight: 'bold' },
    });
    dText.anchor.set(0.5);
    dText.x = 1;
    chip.addChild(dText);

    // Position on opposite side from avatar
    chip.x = this.isAvatarRight() ? -(PANEL_W / 2 + 6) : (PANEL_W / 2 + 6);
    chip.y = -PANEL_H / 2 + 3;
    chip.visible = false;
    return chip;
  }

  private drawPanel(isWinner: boolean): void {
    this.bgPanel.clear();
    if (isWinner) {
      this.bgPanel.roundRect(-PANEL_W / 2, -PANEL_H / 2, PANEL_W, PANEL_H, 10);
      this.bgPanel.fill({ color: 0x1a3d1a, alpha: 0.92 });
      this.bgPanel.stroke({ color: COLORS.gold, width: 2 });
    } else {
      this.bgPanel.roundRect(-PANEL_W / 2, -PANEL_H / 2, PANEL_W, PANEL_H, 10);
      this.bgPanel.fill({ color: COLORS.panelBg, alpha: 0.9 });
      this.bgPanel.stroke({ color: COLORS.panelBorder, width: 1.2 });
    }
  }

  setReplayMode(enabled: boolean): void {
    this.isReplayMode = enabled;
  }

  update(player: Player, phase: GamePhase, isWinner: boolean): void {
    // Avatar ΓÇö positioned to the side of the panel
    if (player.avatarId !== this.currentAvatarId) {
      if (this.avatarSprite) this.removeChild(this.avatarSprite);
      if (this.avatarMask) this.removeChild(this.avatarMask);
      if (this.avatarRing) this.removeChild(this.avatarRing);

      const avatarX = this.getAvatarX();
      const avatarY = 0;

      // Ring around avatar
      this.avatarRing = new Graphics();
      this.avatarRing.circle(avatarX, avatarY, AVATAR_SIZE / 2 + 3);
      this.avatarRing.fill({ color: COLORS.panelBg, alpha: 0.95 });
      this.avatarRing.circle(avatarX, avatarY, AVATAR_SIZE / 2 + 2);
      this.avatarRing.stroke({ color: COLORS.panelBorder, width: 1.5 });
      this.addChild(this.avatarRing);

      const tex = generateAvatarTexture(player.avatarId, AVATAR_SIZE, this.app);
      this.avatarSprite = new Sprite(tex);
      this.avatarSprite.anchor.set(0.5);
      this.avatarSprite.x = avatarX;
      this.avatarSprite.y = avatarY;

      // Circular mask
      this.avatarMask = new Graphics();
      this.avatarMask.circle(avatarX, avatarY, AVATAR_SIZE / 2);
      this.avatarMask.fill(0xffffff);
      this.addChild(this.avatarMask);
      this.addChild(this.avatarSprite);
      this.avatarSprite.mask = this.avatarMask;
      this.currentAvatarId = player.avatarId;
    }

    this.nameText.text = player.name;
    this.chipsText.text = `$${player.chips.toLocaleString()}`;

    // Status
    if (player.isFolded) {
      this.statusText.text = 'FOLD';
      this.statusText.style.fill = 0x996666;
      this.alpha = 0.4;
    } else if (player.isAllIn) {
      this.statusText.text = 'ALL IN';
      this.statusText.style.fill = 0xff6644;
      this.alpha = 1;
    } else {
      this.statusText.text = '';
      this.alpha = 1;
    }

    this.dealerChip.visible = player.isDealer;

    if (player.isSB) {
      this.blindText.text = 'SB';
      this.blindLabel.visible = true;
    } else if (player.isBB) {
      this.blindText.text = 'BB';
      this.blindLabel.visible = true;
    } else {
      this.blindLabel.visible = false;
    }

    // Active player pulse
    if (player.isCurrent && !this.stopPulse) {
      this.highlightGlow.visible = true;
      this.stopPulse = pulseAlpha(this.app.ticker, this.highlightGlow, 0.3, 1.0, 800);
    } else if (!player.isCurrent && this.stopPulse) {
      this.stopPulse();
      this.stopPulse = null;
      this.highlightGlow.visible = false;
      this.highlightGlow.alpha = 1;
    }

    // Bet chips
    this.betChips.update(player.currentBet);

    this.drawPanel(isWinner && phase === 'showdown');
    this.updateCards(player, phase);
  }

  private updateCards(player: Player, phase: GamePhase): void {
    // Determine what to display: real cards, card backs, or nothing
    const hasRealCards = player.holeCards.length > 0 && !player.isFolded;
    const showBacks = !hasRealCards && player.hasHiddenCards && !player.isFolded;

    if (!hasRealCards && !showBacks) {
      if (this.cards.length > 0) {
        this.cardContainer.removeChildren();
        this.cards = [];
        this.prevCardKey = '';
      }
      return;
    }

    const showFace = hasRealCards && (player.isHuman || phase === 'showdown' || this.isReplayMode);
    const cardData = hasRealCards ? player.holeCards : [HIDDEN_CARD, HIDDEN_CARD];

    // Build a key from the card codes so we detect when cards actually change
    // (e.g., hidden backs → real showdown cards, or new hand cards)
    const cardKey = cardData.map(c => c.code).join(',');

    if (cardKey !== this.prevCardKey) {
      // Check if this is a showdown reveal (hidden backs → real cards)
      const isShowdownReveal = this.prevCardKey === '_hidden,_hidden'
        && hasRealCards && showFace && this.cards.length === cardData.length;

      if (isShowdownReveal) {
        // Swap face textures and flip existing card backs in place
        for (let i = 0; i < this.cards.length; i++) {
          this.cards[i].updateFace(cardData[i], this.app);
          const flipDelay = i * 100;
          setTimeout(() => {
            this.cards[i].flipAnimation(this.app.ticker, true);
          }, flipDelay);
        }
        this.prevCardKey = cardKey;
      } else {
        // Cards changed — recreate sprites
        this.cardContainer.removeChildren();
        this.cards = [];
        const overlap = CARD_WIDTH * 0.35;

        for (let i = 0; i < cardData.length; i++) {
          const card = new CardSprite(cardData[i], this.app, showFace);
          const targetX = (i - 0.5) * (CARD_WIDTH - overlap);
          const targetRotation = (i - 0.5) * 0.06;

          const globalCenter = { x: TABLE_CENTER_X, y: TABLE_CENTER_Y };
          const localCenter = this.cardContainer.toLocal(globalCenter, undefined);

          card.x = localCenter.x;
          card.y = localCenter.y;
          card.alpha = 0;
          card.scale.set(0.3);
          card.rotation = 0;

          this.cards.push(card);
          this.cardContainer.addChild(card);

          const staggerDelay = i * 80;
          setTimeout(() => {
            tween(this.app.ticker, {
              target: card, duration: 350, easing: easeOutBack,
              props: { x: targetX, y: 0, scaleX: 1, scaleY: 1 },
            });
            tween(this.app.ticker, {
              target: card, duration: 250, easing: easeOutCubic,
              props: { alpha: 1, rotation: targetRotation },
            });
          }, staggerDelay);
        }
        this.prevCardKey = cardKey;
      }
    } else {
      // Same cards — just update face/back visibility
      for (let i = 0; i < this.cards.length; i++) {
        if (this.cards[i].isFaceUp !== showFace) {
          this.cards[i].flipAnimation(this.app.ticker, showFace);
        }
      }
    }
  }

  async playWinAnimation(): Promise<void> {
    await tween(this.app.ticker, {
      target: this, duration: 200, easing: easeOutCubic,
      props: { scaleX: 1.08, scaleY: 1.08 },
    });
    await tween(this.app.ticker, {
      target: this, duration: 300, easing: easeOutBack,
      props: { scaleX: 1.0, scaleY: 1.0 },
    });
  }

  setHandDescription(text: string): void {
    this.handDescText.text = text;
  }

  resetForNewHand(): void {
    this.prevCardKey = '';
    this.cardContainer.removeChildren();
    this.cards = [];
    this.handDescText.text = '';
  }

  /** Show a juicy animated pop text over the player for their action */
  showActionPop(text: string, color: number): void {
    // Clear any existing pop
    if (this.actionPopText) {
      if (this.actionPopTimeout) clearTimeout(this.actionPopTimeout);
      this.removeChild(this.actionPopText);
      this.actionPopText = null;
      this.actionPopTimeout = null;
    }

    const pop = new Text({
      text,
      style: {
        fontSize: 18,
        fill: color,
        fontFamily: 'Arial',
        fontWeight: 'bold',
        stroke: { color: 0x000000, width: 4 },
      },
    });
    pop.anchor.set(0.5);
    pop.y = -PANEL_H / 2 - CARD_HEIGHT - 14;
    pop.alpha = 0;
    pop.scale.set(0.3);

    this.addChild(pop);
    this.actionPopText = pop;

    // Pop in
    tween(this.app.ticker, {
      target: pop, duration: 250, easing: easeOutBack,
      props: { scaleX: 1.15, scaleY: 1.15, alpha: 1 },
    }).then(() =>
      tween(this.app.ticker, {
        target: pop, duration: 120, easing: easeOutCubic,
        props: { scaleX: 1, scaleY: 1 },
      }),
    );

    // Fade out after hold
    this.actionPopTimeout = setTimeout(() => {
      const startY = pop.y;
      tween(this.app.ticker, {
        target: pop, duration: 500, easing: easeOutCubic,
        props: { alpha: 0, y: startY - 12 },
      }).then(() => {
        if (this.actionPopText === pop) {
          this.removeChild(pop);
          this.actionPopText = null;
          this.actionPopTimeout = null;
        }
      });
    }, 1400);
  }
}