import { Container, Graphics, Text, Sprite, FederatedPointerEvent } from 'pixi.js';
import { CANVAS_WIDTH, CANVAS_HEIGHT, COLORS } from '../constants';
import { GameSettings } from '../settings/GameSettings';
import { generateAvatarTexture, AVATAR_COUNT } from './AvatarRenderer';

type AppLike = { renderer: { generateTexture: (g: Container) => import('pixi.js').Texture } };

export class SettingsPanel extends Container {
  private overlay: Graphics;
  private panel: Container;
  private toggleKnob!: Graphics;
  private toggleBg!: Graphics;
  private avatarSprites: Container[] = [];
  private selectedBorder: Graphics | null = null;
  private app: AppLike;

  constructor(app: AppLike) {
    super();
    this.app = app;
    this.visible = false;

    // Full-screen overlay
    this.overlay = new Graphics();
    this.overlay.rect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
    this.overlay.fill({ color: 0x000000, alpha: 0.5 });
    this.overlay.eventMode = 'static';
    this.overlay.cursor = 'pointer';
    this.overlay.on('pointerdown', () => this.hide());
    this.addChild(this.overlay);

    // Panel
    this.panel = new Container();
    this.panel.x = CANVAS_WIDTH / 2;
    this.panel.y = CANVAS_HEIGHT / 2;
    this.panel.eventMode = 'static';
    // Stop clicks on panel from closing
    this.panel.on('pointerdown', (e: FederatedPointerEvent) => e.stopPropagation());
    this.addChild(this.panel);

    const PW = 500;
    const PH = 420;

    // Panel background
    const bg = new Graphics();
    bg.roundRect(-PW / 2, -PH / 2, PW, PH, 16);
    bg.fill({ color: 0x1a1a35, alpha: 0.97 });
    bg.stroke({ color: 0x3a3a60, width: 1.5 });
    this.panel.addChild(bg);

    // Header
    const title = new Text({
      text: 'Settings',
      style: { fontSize: 22, fill: COLORS.textWhite, fontFamily: 'Arial', fontWeight: 'bold' },
    });
    title.anchor.set(0.5);
    title.y = -PH / 2 + 35;
    this.panel.addChild(title);

    // Close button (X)
    const closeBtn = new Container();
    closeBtn.x = PW / 2 - 30;
    closeBtn.y = -PH / 2 + 30;
    closeBtn.eventMode = 'static';
    closeBtn.cursor = 'pointer';
    const closeBg = new Graphics();
    closeBg.circle(0, 0, 14);
    closeBg.fill({ color: 0x444466, alpha: 0.8 });
    closeBtn.addChild(closeBg);
    const closeX = new Text({
      text: '\u00D7',
      style: { fontSize: 20, fill: COLORS.textWhite, fontFamily: 'Arial', fontWeight: 'bold' },
    });
    closeX.anchor.set(0.5);
    closeX.y = -1;
    closeBtn.addChild(closeX);
    closeBtn.on('pointerdown', () => this.hide());
    closeBtn.on('pointerover', () => { closeBg.clear(); closeBg.circle(0, 0, 14); closeBg.fill(0x666688); });
    closeBtn.on('pointerout', () => { closeBg.clear(); closeBg.circle(0, 0, 14); closeBg.fill({ color: 0x444466, alpha: 0.8 }); });
    this.panel.addChild(closeBtn);

    // Divider
    const divider = new Graphics();
    divider.rect(-PW / 2 + 20, -PH / 2 + 60, PW - 40, 1);
    divider.fill({ color: 0x3a3a60, alpha: 0.5 });
    this.panel.addChild(divider);

    // --- 4-Color Suits Toggle ---
    const toggleY = -PH / 2 + 100;
    const toggleLabel = new Text({
      text: '4-Color Suits',
      style: { fontSize: 16, fill: COLORS.textLight, fontFamily: 'Arial' },
    });
    toggleLabel.anchor.set(0, 0.5);
    toggleLabel.x = -PW / 2 + 40;
    toggleLabel.y = toggleY;
    this.panel.addChild(toggleLabel);

    // Toggle switch
    const toggleContainer = new Container();
    toggleContainer.x = PW / 2 - 70;
    toggleContainer.y = toggleY;
    toggleContainer.eventMode = 'static';
    toggleContainer.cursor = 'pointer';

    this.toggleBg = new Graphics();
    this.drawToggleBg(GameSettings.fourColorSuits);
    toggleContainer.addChild(this.toggleBg);

    this.toggleKnob = new Graphics();
    this.drawToggleKnob(GameSettings.fourColorSuits);
    toggleContainer.addChild(this.toggleKnob);

    toggleContainer.on('pointerdown', () => {
      GameSettings.fourColorSuits = !GameSettings.fourColorSuits;
      this.drawToggleBg(GameSettings.fourColorSuits);
      this.drawToggleKnob(GameSettings.fourColorSuits);
    });
    this.panel.addChild(toggleContainer);

    // Description text
    const toggleDesc = new Text({
      text: 'Diamonds blue, clubs green for easier reading',
      style: { fontSize: 11, fill: COLORS.textMuted, fontFamily: 'Arial' },
    });
    toggleDesc.x = -PW / 2 + 40;
    toggleDesc.y = toggleY + 16;
    this.panel.addChild(toggleDesc);

    // --- Avatar Picker ---
    const avatarHeaderY = -PH / 2 + 160;
    const avatarLabel = new Text({
      text: 'Your Avatar',
      style: { fontSize: 16, fill: COLORS.textLight, fontFamily: 'Arial' },
    });
    avatarLabel.anchor.set(0, 0.5);
    avatarLabel.x = -PW / 2 + 40;
    avatarLabel.y = avatarHeaderY;
    this.panel.addChild(avatarLabel);

    // 4x4 grid of avatars
    const gridStartX = -PW / 2 + 80;
    const gridStartY = avatarHeaderY + 30;
    const thumbSize = 42;
    const gap = 10;

    for (let i = 0; i < AVATAR_COUNT; i++) {
      const col = i % 4;
      const row = Math.floor(i / 4);
      const ax = gridStartX + col * (thumbSize + gap);
      const ay = gridStartY + row * (thumbSize + gap);

      const avatarBtn = new Container();
      avatarBtn.x = ax;
      avatarBtn.y = ay;
      avatarBtn.eventMode = 'static';
      avatarBtn.cursor = 'pointer';

      // Avatar image
      const tex = generateAvatarTexture(i, thumbSize, this.app);
      const sprite = new Sprite(tex);
      avatarBtn.addChild(sprite);

      // Circular mask
      const mask = new Graphics();
      mask.circle(thumbSize / 2, thumbSize / 2, thumbSize / 2);
      mask.fill(0xffffff);
      avatarBtn.addChild(mask);
      sprite.mask = mask;

      // Selection border (drawn on top)
      const border = new Graphics();
      if (i === GameSettings.humanAvatarId) {
        border.circle(thumbSize / 2, thumbSize / 2, thumbSize / 2 + 2);
        border.stroke({ color: COLORS.gold, width: 3 });
        this.selectedBorder = border;
      }
      avatarBtn.addChild(border);

      avatarBtn.on('pointerdown', () => {
        // Clear previous selection
        if (this.selectedBorder) {
          this.selectedBorder.clear();
        }
        // Set new selection
        border.clear();
        border.circle(thumbSize / 2, thumbSize / 2, thumbSize / 2 + 2);
        border.stroke({ color: COLORS.gold, width: 3 });
        this.selectedBorder = border;
        GameSettings.humanAvatarId = i;
      });

      this.panel.addChild(avatarBtn);
      this.avatarSprites.push(avatarBtn);
    }
  }

  private drawToggleBg(on: boolean): void {
    this.toggleBg.clear();
    this.toggleBg.roundRect(0, -10, 44, 20, 10);
    this.toggleBg.fill(on ? 0x16a34a : 0x555555);
  }

  private drawToggleKnob(on: boolean): void {
    this.toggleKnob.clear();
    this.toggleKnob.circle(on ? 34 : 10, 0, 8);
    this.toggleKnob.fill(0xffffff);
  }

  show(): void {
    this.visible = true;
    // Refresh toggle state
    this.drawToggleBg(GameSettings.fourColorSuits);
    this.drawToggleKnob(GameSettings.fourColorSuits);
  }

  hide(): void {
    this.visible = false;
  }
}