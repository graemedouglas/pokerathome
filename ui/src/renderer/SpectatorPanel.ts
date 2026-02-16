import { Container, Graphics, Text } from 'pixi.js';
import { COLORS, CANVAS_WIDTH, CANVAS_HEIGHT } from '../constants';

const PANEL_W = 240;
const PANEL_H = 280;
const HEADER_H = 32;

export class SpectatorPanel extends Container {
  private panel!: Container;
  private toggleBtn!: Container;
  private spectatorListText!: Text;
  private countBadge!: Container;
  private badgeText!: Text;
  private expanded = false;
  private spectators: string[] = [];

  constructor() {
    super();
    // Position: bottom-right (mirrors InfoPanel on left)
    this.x = CANVAS_WIDTH - 12;
    this.y = CANVAS_HEIGHT - 12;

    this.buildToggleButton();
    this.buildPanel();

    this.panel.visible = false;
    this.visible = false; // Hidden until spectators join
  }

  private buildToggleButton(): void {
    this.toggleBtn = new Container();

    const bg = new Graphics();
    bg.roundRect(0, -32, 36, 32, 6);
    bg.fill({ color: 0x181830, alpha: 0.9 });
    bg.stroke({ color: 0x2a2a50, width: 1 });
    bg.eventMode = 'static';
    bg.cursor = 'pointer';
    bg.hitArea = { contains: (x: number, y: number) => x >= 0 && x <= 36 && y >= -32 && y <= 0 };
    this.toggleBtn.addChild(bg);

    // Users icon (two person silhouettes)
    const icon = new Graphics();
    // Left person
    icon.circle(-6, -22, 3);
    icon.fill(COLORS.textMuted);
    icon.roundRect(-9, -17, 6, 8, 2);
    icon.fill(COLORS.textMuted);
    // Right person
    icon.circle(6, -22, 3);
    icon.fill(COLORS.textMuted);
    icon.roundRect(3, -17, 6, 8, 2);
    icon.fill(COLORS.textMuted);
    icon.x = 18;
    this.toggleBtn.addChild(icon);

    // Count badge
    this.countBadge = new Container();
    this.countBadge.x = 28;
    this.countBadge.y = -28;

    const badgeBg = new Graphics();
    badgeBg.circle(0, 0, 8);
    badgeBg.fill(0xff6644);
    this.countBadge.addChild(badgeBg);

    this.badgeText = new Text({
      text: '0',
      style: { fontSize: 10, fill: 0xffffff, fontFamily: 'Arial', fontWeight: 'bold' },
    });
    this.badgeText.anchor.set(0.5);
    this.countBadge.addChild(this.badgeText);
    this.toggleBtn.addChild(this.countBadge);

    bg.on('pointerdown', () => this.toggle());
    bg.on('pointerover', () => {
      bg.clear();
      bg.roundRect(0, -32, 36, 32, 6);
      bg.fill({ color: 0x222250, alpha: 0.95 });
      bg.stroke({ color: 0x3a3a70, width: 1 });
    });
    bg.on('pointerout', () => {
      bg.clear();
      bg.roundRect(0, -32, 36, 32, 6);
      bg.fill({ color: 0x181830, alpha: 0.9 });
      bg.stroke({ color: 0x2a2a50, width: 1 });
    });

    this.addChild(this.toggleBtn);
  }

  private buildPanel(): void {
    this.panel = new Container();
    this.panel.y = -PANEL_H;
    // Anchor to top-right of panel
    this.panel.x = -PANEL_W;
    this.addChild(this.panel);

    // Panel background
    const bg = new Graphics();
    bg.roundRect(0, 0, PANEL_W, PANEL_H, 8);
    bg.fill({ color: 0x0f0f23, alpha: 0.95 });
    bg.stroke({ color: 0x2a2a50, width: 1 });
    this.panel.addChild(bg);

    // Header
    const headerBg = new Graphics();
    headerBg.roundRect(0, 0, PANEL_W, HEADER_H, 8);
    headerBg.fill({ color: 0x181830 });
    // Flatten bottom corners
    headerBg.rect(0, HEADER_H - 8, PANEL_W, 8);
    headerBg.fill({ color: 0x181830 });
    this.panel.addChild(headerBg);

    const headerText = new Text({
      text: 'Spectators',
      style: { fontSize: 12, fill: COLORS.textLight, fontFamily: 'Arial', fontWeight: 'bold' },
    });
    headerText.anchor.set(0, 0.5);
    headerText.x = 12;
    headerText.y = HEADER_H / 2;
    this.panel.addChild(headerText);

    // Close button
    const closeBtn = new Container();
    closeBtn.x = PANEL_W - 24;
    closeBtn.y = HEADER_H / 2;

    const closeBg = new Graphics();
    closeBg.circle(0, 0, 10);
    closeBg.fill({ color: 0x333355, alpha: 0.5 });
    closeBg.eventMode = 'static';
    closeBg.cursor = 'pointer';
    closeBg.hitArea = { contains: (x: number, y: number) => x * x + y * y <= 12 * 12 };
    closeBtn.addChild(closeBg);

    const closeText = new Text({
      text: '\u00d7',
      style: { fontSize: 16, fill: COLORS.textMuted, fontFamily: 'Arial' },
    });
    closeText.anchor.set(0.5);
    closeBtn.addChild(closeText);

    closeBg.on('pointerdown', () => this.toggle());
    closeBg.on('pointerover', () => {
      closeText.style.fill = 0xff6666;
      closeBg.clear();
      closeBg.circle(0, 0, 10);
      closeBg.fill({ color: 0x553333, alpha: 0.7 });
    });
    closeBg.on('pointerout', () => {
      closeText.style.fill = COLORS.textMuted;
      closeBg.clear();
      closeBg.circle(0, 0, 10);
      closeBg.fill({ color: 0x333355, alpha: 0.5 });
    });
    this.panel.addChild(closeBtn);

    // Spectator list
    const contentY = HEADER_H + 10;

    this.spectatorListText = new Text({
      text: 'No spectators',
      style: {
        fontSize: 11,
        fill: COLORS.textMuted,
        fontFamily: 'Arial',
        wordWrap: true,
        wordWrapWidth: PANEL_W - 24,
        lineHeight: 18,
      },
    });
    this.spectatorListText.x = 12;
    this.spectatorListText.y = contentY;
    this.panel.addChild(this.spectatorListText);
  }

  update(spectators: string[]): void {
    this.spectators = spectators;

    // Hide entire component if no spectators
    this.visible = spectators.length > 0;

    // Update badge count
    this.badgeText.text = spectators.length.toString();

    // Update list text
    if (spectators.length === 0) {
      this.spectatorListText.text = 'No spectators';
      this.spectatorListText.style.fill = COLORS.textMuted;
    } else {
      this.spectatorListText.text = spectators.map(name => `• ${name}`).join('\n');
      this.spectatorListText.style.fill = COLORS.textLight;
    }
  }

  toggle(): void {
    this.expanded = !this.expanded;
    this.panel.visible = this.expanded;
  }
}
