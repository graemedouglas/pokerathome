import { Container, Graphics, Text } from 'pixi.js';
import { COLORS, CANVAS_HEIGHT } from '../constants';

const PANEL_W = 280;
const PANEL_H = 340;
const TAB_H = 28;
const TAB_W = 80;
const HEADER_H = 32;

type TabId = 'log' | 'stats' | 'chance';

const HAND_RANKS_DISPLAY: Array<{ key: string; label: string; color: number }> = [
  { key: 'ROYAL_FLUSH',     label: 'Royal Flush',     color: 0xffd700 },
  { key: 'STRAIGHT_FLUSH',  label: 'Straight Flush',  color: 0xe5a100 },
  { key: 'FOUR_OF_A_KIND',  label: 'Four of a Kind',  color: 0xcc7722 },
  { key: 'FULL_HOUSE',      label: 'Full House',      color: 0xbb5544 },
  { key: 'FLUSH',           label: 'Flush',           color: 0x4488cc },
  { key: 'STRAIGHT',        label: 'Straight',        color: 0x44aa88 },
  { key: 'THREE_OF_A_KIND', label: 'Three of a Kind', color: 0x66aa44 },
  { key: 'TWO_PAIR',        label: 'Two Pair',        color: 0x88aa44 },
  { key: 'PAIR',            label: 'One Pair',        color: 0xaaaa44 },
  { key: 'HIGH_CARD',       label: 'Highest Card',    color: 0x888888 },
];

const BAR_MAX_W = 70;
const BAR_H = 7;

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

  // Chance tab
  private chanceRows: Map<string, { makePctText: Text; winPctText: Text; bar: Graphics }> = new Map();
  private totalEquityText!: Text;

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
    this.buildTab('log', 'Log', 12, HEADER_H + 4);
    this.buildTab('stats', 'Stats', 12 + TAB_W + 4, HEADER_H + 4);
    this.buildTab('chance', 'Chance', 12 + (TAB_W + 4) * 2, HEADER_H + 4);

    // Tab contents
    const contentY = HEADER_H + TAB_H + 10;

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

    // Chance content
    const chanceContainer = new Container();
    chanceContainer.y = contentY;
    chanceContainer.visible = false;
    this.panel.addChild(chanceContainer);
    this.buildChanceContent(chanceContainer);
    this.tabContents.set('chance', chanceContainer);

    this.setActiveTab('log');
  }

  private buildChanceContent(container: Container): void {
    const ROW_H = 22;
    const MAKE_X = 120;
    const BAR_X = 148;
    const WIN_X = PANEL_W - 14;

    // Column headers
    const makeHeader = new Text({
      text: 'Make',
      style: { fontSize: 9, fill: COLORS.textMuted, fontFamily: 'Arial', fontWeight: 'bold' },
    });
    makeHeader.anchor.set(1, 0);
    makeHeader.x = MAKE_X;
    makeHeader.y = -2;
    container.addChild(makeHeader);

    const winHeader = new Text({
      text: 'Win',
      style: { fontSize: 9, fill: COLORS.textMuted, fontFamily: 'Arial', fontWeight: 'bold' },
    });
    winHeader.anchor.set(1, 0);
    winHeader.x = WIN_X;
    winHeader.y = -2;
    container.addChild(winHeader);

    const headerOffset = 14;

    for (let i = 0; i < HAND_RANKS_DISPLAY.length; i++) {
      const { key, label } = HAND_RANKS_DISPLAY[i];
      const rowY = headerOffset + i * ROW_H;

      // Subtle row separator
      if (i > 0) {
        const sep = new Graphics();
        sep.rect(12, rowY - 2, PANEL_W - 24, 1);
        sep.fill({ color: 0x2a2a50, alpha: 0.3 });
        container.addChild(sep);
      }

      const nameText = new Text({
        text: label,
        style: { fontSize: 10, fill: COLORS.textLight, fontFamily: 'Arial' },
      });
      nameText.x = 12;
      nameText.y = rowY + 2;
      container.addChild(nameText);

      // Make % (formation probability)
      const makePctText = new Text({
        text: '0%',
        style: { fontSize: 10, fill: COLORS.textMuted, fontFamily: 'Arial' },
      });
      makePctText.anchor.set(1, 0);
      makePctText.x = MAKE_X;
      makePctText.y = rowY + 2;
      container.addChild(makePctText);

      // Win equity bar
      const bar = new Graphics();
      bar.x = BAR_X;
      bar.y = rowY + 5;
      container.addChild(bar);

      // Win % (win equity)
      const winPctText = new Text({
        text: '0%',
        style: { fontSize: 10, fill: COLORS.textLight, fontFamily: 'Arial', fontWeight: 'bold' },
      });
      winPctText.anchor.set(1, 0);
      winPctText.x = WIN_X;
      winPctText.y = rowY + 2;
      container.addChild(winPctText);

      this.chanceRows.set(key, { makePctText, winPctText, bar });
    }

    // Total win equity summary
    const totalY = headerOffset + HAND_RANKS_DISPLAY.length * ROW_H + 4;
    const totalSep = new Graphics();
    totalSep.rect(12, totalY, PANEL_W - 24, 1);
    totalSep.fill({ color: 0x2a2a50, alpha: 0.5 });
    container.addChild(totalSep);

    this.totalEquityText = new Text({
      text: 'Win Equity: --%',
      style: { fontSize: 12, fill: COLORS.textLight, fontFamily: 'Arial', fontWeight: 'bold' },
    });
    this.totalEquityText.x = 12;
    this.totalEquityText.y = totalY + 6;
    container.addChild(this.totalEquityText);
  }

  private buildTab(id: TabId, label: string, x: number, y: number): void {
    const btn = new Container();
    btn.x = x;
    btn.y = y;

    const bg = new Graphics();
    bg.roundRect(0, 0, TAB_W, TAB_H, 4);
    bg.fill(id === this.activeTab ? 0x222250 : 0x151530);
    bg.eventMode = 'static';
    bg.cursor = 'pointer';
    bg.hitArea = { contains: (bx: number, by: number) => bx >= 0 && bx <= TAB_W && by >= 0 && by <= TAB_H };
    btn.addChild(bg);
    this.tabBgs.set(id, bg);

    const text = new Text({
      text: label,
      style: { fontSize: 11, fill: id === this.activeTab ? COLORS.textWhite : COLORS.textMuted, fontFamily: 'Arial', fontWeight: 'bold' },
    });
    text.anchor.set(0.5);
    text.x = TAB_W / 2;
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
      bg.roundRect(0, 0, TAB_W, TAB_H, 4);
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

  /** Update hand probability display with formation probability and win equity */
  updateHandProbabilities(formation: Record<string, number>, winEquity: Record<string, number>): void {
    let totalEquity = 0;

    for (const { key, color } of HAND_RANKS_DISPLAY) {
      const row = this.chanceRows.get(key);
      if (!row) continue;

      // Formation probability (Make column)
      const makeProb = formation[key] ?? 0;
      const makePct = Math.round(makeProb * 100);
      row.makePctText.text = `${makePct}%`;

      // Win equity (Win column + bar)
      const winProb = winEquity[key] ?? 0;
      totalEquity += winProb;
      const winPct = Math.round(winProb * 1000) / 10; // One decimal place
      row.winPctText.text = winProb > 0 ? `${winPct}%` : '0%';

      row.bar.clear();
      if (winProb > 0) {
        const barW = Math.max(3, winProb * BAR_MAX_W * 3); // Scale up since win equity values are smaller
        row.bar.roundRect(0, 0, Math.min(barW, BAR_MAX_W), BAR_H, 2);
        row.bar.fill(color);
      }
    }

    // Update total equity display
    const totalPct = Math.round(totalEquity * 100);
    this.totalEquityText.text = `Win Equity: ${totalPct}%`;

    // Color based on equity level
    if (totalPct >= 50) {
      this.totalEquityText.style.fill = 0x44cc66; // Green
    } else if (totalPct >= 30) {
      this.totalEquityText.style.fill = 0xcccc44; // Yellow
    } else {
      this.totalEquityText.style.fill = 0xcc5544; // Red
    }
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
