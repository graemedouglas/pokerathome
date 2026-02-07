import { Container, Sprite, Graphics, Text, Texture, Ticker } from 'pixi.js';
import { Card, SUIT_SYMBOLS } from '../types';
import { CARD_WIDTH, CARD_HEIGHT } from '../constants';
import { GameSettings } from '../settings/GameSettings';
import { tween, easeInOutCubic } from '../utils/Animations';

const STANDARD_COLORS: Record<string, number> = {
  hearts: 0xdc2626,
  diamonds: 0xdc2626,
  clubs: 0x1a1a2e,
  spades: 0x1a1a2e,
};

const FOUR_COLORS: Record<string, number> = {
  hearts: 0xdc2626,
  diamonds: 0x2563eb,
  clubs: 0x16a34a,
  spades: 0x1a1a2e,
};

function getSuitColors(): Record<string, number> {
  return GameSettings.fourColorSuits ? FOUR_COLORS : STANDARD_COLORS;
}

type AppLike = { renderer: { generateTexture: (g: Container) => Texture } };

function createCardFaceTexture(card: Card, app: AppLike): Texture {
  const w = CARD_WIDTH;
  const h = CARD_HEIGHT;
  const container = new Container();

  // Card background with slight shadow inset
  const shadow = new Graphics();
  shadow.roundRect(1, 1, w, h, 5);
  shadow.fill({ color: 0x000000, alpha: 0.2 });
  container.addChild(shadow);

  const bg = new Graphics();
  bg.roundRect(0, 0, w, h, 5);
  bg.fill(0xf8f6f0); // warm white
  bg.stroke({ color: 0xccccbb, width: 0.8 });
  container.addChild(bg);

  const color = getSuitColors()[card.suit];
  const symbol = SUIT_SYMBOLS[card.suit];
  const rankStr = card.rank;

  // Top-left rank
  const rankTop = new Text({
    text: rankStr,
    style: { fontSize: 16, fontWeight: 'bold', fill: color, fontFamily: 'Georgia, serif' },
  });
  rankTop.x = 5;
  rankTop.y = 3;
  container.addChild(rankTop);

  // Top-left suit (below rank)
  const suitTop = new Text({
    text: symbol,
    style: { fontSize: 13, fill: color, fontFamily: 'Arial' },
  });
  suitTop.x = 6;
  suitTop.y = 19;
  container.addChild(suitTop);

  // Center suit (large, prominent)
  const centerSuit = new Text({
    text: symbol,
    style: { fontSize: 32, fill: color, fontFamily: 'Arial' },
  });
  centerSuit.anchor.set(0.5);
  centerSuit.x = w / 2;
  centerSuit.y = h / 2;
  container.addChild(centerSuit);

  // Bottom-right rank (upside down)
  const rankBot = new Text({
    text: rankStr,
    style: { fontSize: 16, fontWeight: 'bold', fill: color, fontFamily: 'Georgia, serif' },
  });
  rankBot.anchor.set(0.5);
  rankBot.rotation = Math.PI;
  rankBot.x = w - 12;
  rankBot.y = h - 12;
  container.addChild(rankBot);

  // Bottom-right suit (upside down)
  const suitBot = new Text({
    text: symbol,
    style: { fontSize: 13, fill: color, fontFamily: 'Arial' },
  });
  suitBot.anchor.set(0.5);
  suitBot.rotation = Math.PI;
  suitBot.x = w - 12;
  suitBot.y = h - 28;
  container.addChild(suitBot);

  const texture = app.renderer.generateTexture(container);
  container.destroy();
  return texture;
}

function createCardBackTexture(app: AppLike): Texture {
  const w = CARD_WIDTH;
  const h = CARD_HEIGHT;
  const container = new Container();

  // Shadow
  const shadow = new Graphics();
  shadow.roundRect(1, 1, w, h, 5);
  shadow.fill({ color: 0x000000, alpha: 0.2 });
  container.addChild(shadow);

  // Blue card back
  const bg = new Graphics();
  bg.roundRect(0, 0, w, h, 5);
  bg.fill(0x1e3a6e);
  bg.stroke({ color: 0x152a50, width: 1 });
  container.addChild(bg);

  // Inner border (gold)
  const innerBorder = new Graphics();
  innerBorder.roundRect(4, 4, w - 8, h - 8, 3);
  innerBorder.stroke({ color: 0xc8a84e, width: 1.5 });
  container.addChild(innerBorder);

  // Second inner border
  const innerBorder2 = new Graphics();
  innerBorder2.roundRect(7, 7, w - 14, h - 14, 2);
  innerBorder2.stroke({ color: 0xc8a84e, width: 0.5, alpha: 0.5 });
  container.addChild(innerBorder2);

  // Center diamond pattern
  const pattern = new Graphics();
  const centerX = w / 2;
  const centerY = h / 2;

  // Large center diamond
  pattern.moveTo(centerX, centerY - 20);
  pattern.lineTo(centerX + 14, centerY);
  pattern.lineTo(centerX, centerY + 20);
  pattern.lineTo(centerX - 14, centerY);
  pattern.closePath();
  pattern.fill({ color: 0xc8a84e, alpha: 0.6 });
  pattern.stroke({ color: 0xc8a84e, width: 0.5 });

  // Small corner diamonds
  const smallDiamond = (dx: number, dy: number, size: number) => {
    pattern.moveTo(dx, dy - size);
    pattern.lineTo(dx + size * 0.7, dy);
    pattern.lineTo(dx, dy + size);
    pattern.lineTo(dx - size * 0.7, dy);
    pattern.closePath();
    pattern.fill({ color: 0x2a5090, alpha: 0.8 });
  };
  smallDiamond(centerX - 16, centerY - 22, 5);
  smallDiamond(centerX + 16, centerY - 22, 5);
  smallDiamond(centerX - 16, centerY + 22, 5);
  smallDiamond(centerX + 16, centerY + 22, 5);

  container.addChild(pattern);

  const texture = app.renderer.generateTexture(container);
  container.destroy();
  return texture;
}

const textureCache = new Map<string, Texture>();
let backTexture: Texture | null = null;

export class CardSprite extends Container {
  private faceSprite: Sprite;
  private backSprite: Sprite;
  private _faceUp: boolean;

  constructor(card: Card, app: AppLike, faceUp = false) {
    super();
    this._faceUp = faceUp;

    const faceKey = card.code;
    if (!textureCache.has(faceKey)) {
      textureCache.set(faceKey, createCardFaceTexture(card, app));
    }
    if (!backTexture) {
      backTexture = createCardBackTexture(app);
    }

    this.faceSprite = new Sprite(textureCache.get(faceKey)!);
    this.faceSprite.anchor.set(0.5);
    this.backSprite = new Sprite(backTexture);
    this.backSprite.anchor.set(0.5);

    this.addChild(this.faceSprite);
    this.addChild(this.backSprite);

    this.faceSprite.visible = faceUp;
    this.backSprite.visible = !faceUp;
  }

  get isFaceUp(): boolean {
    return this._faceUp;
  }

  setFaceUp(faceUp: boolean): void {
    this._faceUp = faceUp;
    this.faceSprite.visible = faceUp;
    this.backSprite.visible = !faceUp;
  }

  async flipAnimation(ticker: Ticker, faceUp: boolean): Promise<void> {
    await tween(ticker, {
      target: this,
      duration: 150,
      props: { scaleX: 0 },
      easing: easeInOutCubic,
    });

    this.setFaceUp(faceUp);

    await tween(ticker, {
      target: this,
      duration: 150,
      props: { scaleX: 1 },
      easing: easeInOutCubic,
    });
  }
}

export function clearTextureCache(): void {
  textureCache.clear();
  backTexture = null;
}