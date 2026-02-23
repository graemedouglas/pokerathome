import { Container, Graphics, Text } from 'pixi.js';
import { COLORS, CANVAS_HEIGHT } from '../constants';

const PANEL_W = 280;
const PANEL_H = 320;
const TAB_H = 28;
const HEADER_H = 32;

type TabId = 'log' | 'stats';

export class InfoPanel extends Container {
  private panel!: Container;
  private toggleBtn!: Container;
  private logEntries: string[] = [];
  private logText!: Text;
  private statsText!: Text;
  private tabBgs: Map<TabId, Graphics> = new Map();
  private tabTexts: Map<TabId, Text> = new Map();
  private tabContents: Map<TabId, Container> = new Map();
  private activeTab: TabId = 'log';
  private expanded = false;

  // Stats tracking
  private handsPlayed = 0;
  private handsWon = 0;
  private biggestPot = 0;

  constructor() {
    super();
    this.x = 12;
    this.y = CANVAS_HEIGHT - 12;

    this.buildToggleButton();
    this.buildPanel();

    this.panel.visible = false;
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

    // Log icon — notepad with lines
    const icon = new Graphics();
    icon.roundRect(10, -28, 16, 20, 2);
    icon.fill(COLORS.textMuted);
    // Three horizontal lines (text lines)
    icon.rect(13, -24, 10, 1.5);
    icon.rect(13, -20, 10, 1.5);
    icon.rect(13, -16, 7, 1.5);
    icon.fill(0x181830);
    this.toggleBtn.addChild(icon);

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
      text: 'Game Info',
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
      closeBg.clear(); closeBg.circle(0, 0, 10); closeBg.fill({ color: 0x553333, alpha: 0.7 });
    });
    closeBg.on('pointerout', () => {
      closeText.style.fill = COLORS.textMuted;
      closeBg.clear(); closeBg.circle(0, 0, 10); closeBg.fill({ color: 0x333355, alpha: 0.5 });
    });
    this.panel.addChild(closeBtn);

    // Tabs
    this.buildTab('log', 'Game Log', 12, HEADER_H + 4);
    this.buildTab('stats', 'Stats', 100, HEADER_H + 4);

    // Tab contents
    const contentY = HEADER_H + TAB_H + 10;
    const contentH = PANEL_H - contentY - 10;

    // Log content
    const logContainer = new Container();
    logContainer.y = contentY;
    this.panel.addChild(logContainer);

    this.logText = new Text({
      text: 'Game starting...',
      style: {
        fontSize: 11,
        fill: COLORS.textLight,
        fontFamily: 'Arial',
        wordWrap: true,
        wordWrapWidth: PANEL_W - 24,
        lineHeight: 16,
      },
    });
    this.logText.x = 12;
    logContainer.addChild(this.logText);
    this.tabContents.set('log', logContainer);

    // Stats content
    const statsContainer = new Container();
    statsContainer.y = contentY;
    statsContainer.visible = false;
    this.panel.addChild(statsContainer);

    this.statsText = new Text({
      text: this.getStatsString(),
      style: {
        fontSize: 11,
        fill: COLORS.textLight,
        fontFamily: 'Arial',
        wordWrap: true,
        wordWrapWidth: PANEL_W - 24,
        lineHeight: 18,
      },
    });
    this.statsText.x = 12;
    statsContainer.addChild(this.statsText);
    this.tabContents.set('stats', statsContainer);

    this.setActiveTab('log');
  }

  private buildTab(id: TabId, label: string, x: number, y: number): void {
    const btn = new Container();
    btn.x = x;
    btn.y = y;

    const bg = new Graphics();
    bg.roundRect(0, 0, 80, TAB_H, 4);
    bg.fill(id === this.activeTab ? 0x222250 : 0x151530);
    bg.eventMode = 'static';
    bg.cursor = 'pointer';
    bg.hitArea = { contains: (bx: number, by: number) => bx >= 0 && bx <= 80 && by >= 0 && by <= TAB_H };
    btn.addChild(bg);
    this.tabBgs.set(id, bg);

    const text = new Text({
      text: label,
      style: { fontSize: 11, fill: id === this.activeTab ? COLORS.textWhite : COLORS.textMuted, fontFamily: 'Arial', fontWeight: 'bold' },
    });
    text.anchor.set(0.5);
    text.x = 40;
    text.y = TAB_H / 2;
    btn.addChild(text);
    this.tabTexts.set(id, text);

    bg.on('pointerdown', () => this.setActiveTab(id));
    this.panel.addChild(btn);
  }

  private setActiveTab(id: TabId): void {
    this.activeTab = id;

    for (const [tabId, bg] of this.tabBgs) {
      const isActive = tabId === id;
      bg.clear();
      bg.roundRect(0, 0, 80, TAB_H, 4);
      bg.fill(isActive ? 0x222250 : 0x151530);
    }

    for (const [tabId, text] of this.tabTexts) {
      text.style.fill = tabId === id ? COLORS.textWhite : COLORS.textMuted;
    }

    for (const [tabId, content] of this.tabContents) {
      content.visible = tabId === id;
    }
  }

  toggle(): void {
    this.expanded = !this.expanded;
    this.panel.visible = this.expanded;
    this.toggleBtn.visible = !this.expanded;
  }

  /** Add a log entry to the game log */
  addLog(message: string): void {
    this.logEntries.push(message);
    // Keep last 20 entries
    if (this.logEntries.length > 20) {
      this.logEntries.shift();
    }
    this.logText.text = this.logEntries.join('\n');

    // Clip text height to fit panel
    const maxH = PANEL_H - (HEADER_H + TAB_H + 20);
    if (this.logText.height > maxH) {
      // Show only the most recent entries that fit
      while (this.logEntries.length > 1 && this.logText.height > maxH) {
        this.logEntries.shift();
        this.logText.text = this.logEntries.join('\n');
      }
    }
  }

  /** Update stats display */
  updateStats(handsPlayed: number, handsWon: number, biggestPot: number): void {
    this.handsPlayed = handsPlayed;
    this.handsWon = handsWon;
    this.biggestPot = Math.max(this.biggestPot, biggestPot);
    this.statsText.text = this.getStatsString();
  }

  private getStatsString(): string {
    const winRate = this.handsPlayed > 0
      ? ((this.handsWon / this.handsPlayed) * 100).toFixed(1)
      : '0.0';
    return [
      `Hands Played: ${this.handsPlayed}`,
      `Hands Won: ${this.handsWon}`,
      `Win Rate: ${winRate}%`,
      `Biggest Pot: $${this.biggestPot}`,
      '',
      'Blinds: $5 / $10',
      'Players: 6',
    ].join('\n');
  }
}