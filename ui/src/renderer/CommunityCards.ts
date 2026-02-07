import { Container, Ticker, Texture } from 'pixi.js';
import { Card } from '../types';
import { CARD_WIDTH, TABLE_CENTER_X, TABLE_CENTER_Y } from '../constants';
import { CardSprite } from './CardSprite';
import { tween, delay, easeOutBack, easeOutCubic, easeInOutCubic } from '../utils/Animations';

type AppLike = { renderer: { generateTexture: (g: Container) => Texture }; ticker: Ticker };

export class CommunityCards extends Container {
  private cards: CardSprite[] = [];
  private app: AppLike;
  private isAnimating = false;

  constructor(app: AppLike) {
    super();
    this.app = app;
    this.x = TABLE_CENTER_X;
    this.y = TABLE_CENTER_Y - 30;
  }

  update(communityCards: Card[]): void {
    // Reset if fewer cards (new hand)
    if (communityCards.length < this.cards.length) {
      // Fade out old cards
      for (const card of this.cards) {
        tween(this.app.ticker, {
          target: card, duration: 200, easing: easeOutCubic,
          props: { alpha: 0, scaleX: 0.5, scaleY: 0.5 },
        }).then(() => {
          if (card.parent) card.parent.removeChild(card);
        });
      }
      this.cards = [];
    }

    // Add new cards with animation
    while (this.cards.length < communityCards.length) {
      const idx = this.cards.length;
      const card = new CardSprite(communityCards[idx], this.app, false); // Start face-down

      const gap = CARD_WIDTH + 8;
      const totalWidth = 5 * gap - 8;
      const startX = -totalWidth / 2 + CARD_WIDTH / 2;
      const targetX = startX + idx * gap;

      // Start from center, small, invisible
      card.x = 0;
      card.y = 40;
      card.alpha = 0;
      card.scale.set(0.2);

      this.cards.push(card);
      this.addChild(card);

      // Stagger the reveal for dramatic effect
      const revealDelay = (idx % 3 === 0 && idx > 0) ? 0 : (idx % 3) * 150;
      const isFlop = idx < 3;

      setTimeout(() => {
        // Slide into position
        tween(this.app.ticker, {
          target: card, duration: 400, easing: easeOutBack,
          props: { x: targetX, y: 0, scaleX: 1, scaleY: 1 },
        });
        tween(this.app.ticker, {
          target: card, duration: 300, easing: easeOutCubic,
          props: { alpha: 1 },
        });

        // Flip face-up after landing
        setTimeout(() => {
          card.flipAnimation(this.app.ticker, true);
        }, isFlop ? 350 : 300);
      }, revealDelay);
    }
  }

  /** Dramatic reveal for a set of new community cards */
  async animateReveal(newCards: Card[], existingCount: number): Promise<void> {
    this.isAnimating = true;

    const gap = CARD_WIDTH + 8;
    const totalWidth = 5 * gap - 8;
    const startX = -totalWidth / 2 + CARD_WIDTH / 2;

    // Brief suspense pause
    await delay(300);

    for (let i = 0; i < newCards.length; i++) {
      const idx = existingCount + i;
      const card = new CardSprite(newCards[i], this.app, false);

      const targetX = startX + idx * gap;

      // Start off-screen above, face-down
      card.x = targetX;
      card.y = -80;
      card.alpha = 0;
      card.scale.set(0.6);

      this.cards.push(card);
      this.addChild(card);

      // Whoosh down into position
      await tween(this.app.ticker, {
        target: card, duration: 300, easing: easeOutCubic,
        props: { y: 0, alpha: 1, scaleX: 1, scaleY: 1 },
      });

      // Suspenseful pause before flip
      await delay(newCards.length === 1 ? 400 : 150);

      // Dramatic flip
      await card.flipAnimation(this.app.ticker, true);

      // Small bounce after flip
      await tween(this.app.ticker, {
        target: card, duration: 120,
        props: { scaleX: 1.06, scaleY: 1.06 },
      });
      await tween(this.app.ticker, {
        target: card, duration: 150, easing: easeOutCubic,
        props: { scaleX: 1, scaleY: 1 },
      });

      if (i < newCards.length - 1) {
        await delay(100);
      }
    }

    this.isAnimating = false;
  }

  /** Clear all cards immediately (for new hand reset) */
  clearAll(): void {
    this.removeChildren();
    this.cards = [];
  }
}