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
  private sfxToggleBg!: Graphics;
  private sfxToggleKnob!: Graphics;
  private ttsToggleBg!: Graphics;
  private ttsToggleKnob!: Graphics;
  private turnToggleBg!: Graphics;
  private turnToggleKnob!: Graphics;
  private chatToggleBg!: Graphics;
  private chatToggleKnob!: Graphics;
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
    const PH = 620;

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

    // --- Sound Effects Toggle ---
    const sfxToggleY = -PH / 2 + 150;
    const sfxLabel = new Text({
      text: 'Sound Effects',
      style: { fontSize: 16, fill: COLORS.textLight, fontFamily: 'Arial' },
    });
    sfxLabel.anchor.set(0, 0.5);
    sfxLabel.x = -PW / 2 + 40;
    sfxLabel.y = sfxToggleY;
    this.panel.addChild(sfxLabel);

    const sfxToggleContainer = new Container();
    sfxToggleContainer.x = PW / 2 - 70;
    sfxToggleContainer.y = sfxToggleY;
    sfxToggleContainer.eventMode = 'static';
    sfxToggleContainer.cursor = 'pointer';

    this.sfxToggleBg = new Graphics();
    this.drawToggle(this.sfxToggleBg, GameSettings.soundEffects);
    sfxToggleContainer.addChild(this.sfxToggleBg);

    this.sfxToggleKnob = new Graphics();
    this.drawKnob(this.sfxToggleKnob, GameSettings.soundEffects);
    sfxToggleContainer.addChild(this.sfxToggleKnob);

    sfxToggleContainer.on('pointerdown', () => {
      GameSettings.soundEffects = !GameSettings.soundEffects;
      this.drawToggle(this.sfxToggleBg, GameSettings.soundEffects);
      this.drawKnob(this.sfxToggleKnob, GameSettings.soundEffects);
    });
    this.panel.addChild(sfxToggleContainer);

    const sfxDesc = new Text({
      text: 'Card, chip, and action sound effects',
      style: { fontSize: 11, fill: COLORS.textMuted, fontFamily: 'Arial' },
    });
    sfxDesc.x = -PW / 2 + 40;
    sfxDesc.y = sfxToggleY + 16;
    this.panel.addChild(sfxDesc);

    // --- Dealer Narration Toggle ---
    const ttsToggleY = -PH / 2 + 200;
    const ttsLabel = new Text({
      text: 'Dealer Narration',
      style: { fontSize: 16, fill: COLORS.textLight, fontFamily: 'Arial' },
    });
    ttsLabel.anchor.set(0, 0.5);
    ttsLabel.x = -PW / 2 + 40;
    ttsLabel.y = ttsToggleY;
    this.panel.addChild(ttsLabel);

    const ttsToggleContainer = new Container();
    ttsToggleContainer.x = PW / 2 - 70;
    ttsToggleContainer.y = ttsToggleY;
    ttsToggleContainer.eventMode = 'static';
    ttsToggleContainer.cursor = 'pointer';

    this.ttsToggleBg = new Graphics();
    this.drawToggle(this.ttsToggleBg, GameSettings.dealerNarration);
    ttsToggleContainer.addChild(this.ttsToggleBg);

    this.ttsToggleKnob = new Graphics();
    this.drawKnob(this.ttsToggleKnob, GameSettings.dealerNarration);
    ttsToggleContainer.addChild(this.ttsToggleKnob);

    ttsToggleContainer.on('pointerdown', () => {
      GameSettings.dealerNarration = !GameSettings.dealerNarration;
      this.drawToggle(this.ttsToggleBg, GameSettings.dealerNarration);
      this.drawKnob(this.ttsToggleKnob, GameSettings.dealerNarration);
    });
    this.panel.addChild(ttsToggleContainer);

    const ttsDesc = new Text({
      text: 'TTS voice narrates game actions (browser speech)',
      style: { fontSize: 11, fill: COLORS.textMuted, fontFamily: 'Arial' },
    });
    ttsDesc.x = -PW / 2 + 40;
    ttsDesc.y = ttsToggleY + 16;
    this.panel.addChild(ttsDesc);

    // --- Turn Sound Toggle ---
    const turnToggleY = -PH / 2 + 250;
    const turnLabel = new Text({
      text: 'Turn Notification',
      style: { fontSize: 16, fill: COLORS.textLight, fontFamily: 'Arial' },
    });
    turnLabel.anchor.set(0, 0.5);
    turnLabel.x = -PW / 2 + 40;
    turnLabel.y = turnToggleY;
    this.panel.addChild(turnLabel);

    const turnToggleContainer = new Container();
    turnToggleContainer.x = PW / 2 - 70;
    turnToggleContainer.y = turnToggleY;
    turnToggleContainer.eventMode = 'static';
    turnToggleContainer.cursor = 'pointer';

    this.turnToggleBg = new Graphics();
    this.drawToggle(this.turnToggleBg, GameSettings.turnSound);
    turnToggleContainer.addChild(this.turnToggleBg);

    this.turnToggleKnob = new Graphics();
    this.drawKnob(this.turnToggleKnob, GameSettings.turnSound);
    turnToggleContainer.addChild(this.turnToggleKnob);

    turnToggleContainer.on('pointerdown', () => {
      GameSettings.turnSound = !GameSettings.turnSound;
      this.drawToggle(this.turnToggleBg, GameSettings.turnSound);
      this.drawKnob(this.turnToggleKnob, GameSettings.turnSound);
    });
    this.panel.addChild(turnToggleContainer);

    const turnDesc = new Text({
      text: 'Play a ding when it\'s your turn to act',
      style: { fontSize: 11, fill: COLORS.textMuted, fontFamily: 'Arial' },
    });
    turnDesc.x = -PW / 2 + 40;
    turnDesc.y = turnToggleY + 16;
    this.panel.addChild(turnDesc);

    // --- Chat Sound Toggle ---
    const chatToggleY = -PH / 2 + 300;
    const chatLabel = new Text({
      text: 'Chat Notification',
      style: { fontSize: 16, fill: COLORS.textLight, fontFamily: 'Arial' },
    });
    chatLabel.anchor.set(0, 0.5);
    chatLabel.x = -PW / 2 + 40;
    chatLabel.y = chatToggleY;
    this.panel.addChild(chatLabel);

    const chatToggleContainer = new Container();
    chatToggleContainer.x = PW / 2 - 70;
    chatToggleContainer.y = chatToggleY;
    chatToggleContainer.eventMode = 'static';
    chatToggleContainer.cursor = 'pointer';

    this.chatToggleBg = new Graphics();
    this.drawToggle(this.chatToggleBg, GameSettings.chatSound);
    chatToggleContainer.addChild(this.chatToggleBg);

    this.chatToggleKnob = new Graphics();
    this.drawKnob(this.chatToggleKnob, GameSettings.chatSound);
    chatToggleContainer.addChild(this.chatToggleKnob);

    chatToggleContainer.on('pointerdown', () => {
      GameSettings.chatSound = !GameSettings.chatSound;
      this.drawToggle(this.chatToggleBg, GameSettings.chatSound);
      this.drawKnob(this.chatToggleKnob, GameSettings.chatSound);
    });
    this.panel.addChild(chatToggleContainer);

    const chatDesc = new Text({
      text: 'Play a sound for incoming chat messages',
      style: { fontSize: 11, fill: COLORS.textMuted, fontFamily: 'Arial' },
    });
    chatDesc.x = -PW / 2 + 40;
    chatDesc.y = chatToggleY + 16;
    this.panel.addChild(chatDesc);

    // --- Avatar Picker ---
    const avatarHeaderY = -PH / 2 + 360;
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

  private drawToggle(bg: Graphics, on: boolean): void {
    bg.clear();
    bg.roundRect(0, -10, 44, 20, 10);
    bg.fill(on ? 0x16a34a : 0x555555);
  }

  private drawKnob(knob: Graphics, on: boolean): void {
    knob.clear();
    knob.circle(on ? 34 : 10, 0, 8);
    knob.fill(0xffffff);
  }

  private drawToggleBg(on: boolean): void {
    this.drawToggle(this.toggleBg, on);
  }

  private drawToggleKnob(on: boolean): void {
    this.drawKnob(this.toggleKnob, on);
  }

  show(): void {
    this.visible = true;
    // Refresh all toggle states
    this.drawToggleBg(GameSettings.fourColorSuits);
    this.drawToggleKnob(GameSettings.fourColorSuits);
    this.drawToggle(this.sfxToggleBg, GameSettings.soundEffects);
    this.drawKnob(this.sfxToggleKnob, GameSettings.soundEffects);
    this.drawToggle(this.ttsToggleBg, GameSettings.dealerNarration);
    this.drawKnob(this.ttsToggleKnob, GameSettings.dealerNarration);
    this.drawToggle(this.turnToggleBg, GameSettings.turnSound);
    this.drawKnob(this.turnToggleKnob, GameSettings.turnSound);
    this.drawToggle(this.chatToggleBg, GameSettings.chatSound);
    this.drawKnob(this.chatToggleKnob, GameSettings.chatSound);
  }

  hide(): void {
    this.visible = false;
  }
}