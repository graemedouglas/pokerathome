import { Application, Container, Graphics, Text } from 'pixi.js';
import { GameState, AvailableActions, PlayerAction, Card } from '../types';
import { CANVAS_WIDTH, CANVAS_HEIGHT, COLORS, NUM_SEATS, TABLE_CENTER_X, TABLE_CENTER_Y } from '../constants';
import { computeSeatPositions } from '../utils/Layout';
import { TableRenderer } from './TableRenderer';
import { PlayerRenderer } from './PlayerRenderer';
import { CommunityCards } from './CommunityCards';
import { PotDisplay } from './PotDisplay';
import { ActionPanel } from './ActionPanel';
import { SettingsPanel } from './SettingsPanel';
import { clearTextureCache } from './CardSprite';
import { GameSettings } from '../settings/GameSettings';
import { InfoPanel } from './InfoPanel';
import { SpectatorPanel } from './SpectatorPanel';
import { ChatPanel, type ChatMessage } from './ChatPanel';
import type { WsClient } from '../network/ws-client';
import type { ReplayController } from '../network/replay-controller';
import { ReplayControls } from './ReplayControls';
import { ReplayCardVisibilityPanel } from './ReplayCardVisibilityPanel';
import { tween, delay, easeOutBack, easeOutCubic } from '../utils/Animations';
import { evaluateHandDescription } from '../utils/hand-evaluator';

const PHASE_LABELS: Record<string, string> = {
  waiting: '',
  preflop: 'PRE-FLOP',
  flop: 'FLOP',
  turn: 'TURN',
  river: 'RIVER',
  showdown: 'SHOWDOWN',
};

export class GameRenderer {
  private app!: Application;
  private tableLayer!: Container;
  private playerLayer!: Container;
  private communityLayer!: Container;
  private uiLayer!: Container;

  private playerRenderers: PlayerRenderer[] = [];
  private communityCards!: CommunityCards;
  private potDisplay!: PotDisplay;
  private actionPanel!: ActionPanel;
  private settingsPanel!: SettingsPanel;
  private infoPanel!: InfoPanel;
  private spectatorPanel!: SpectatorPanel;
  private chatPanel!: ChatPanel;
  private isSpectator = false;
  private spectatorText!: Text;
  private lastState: GameState | null = null;
  private winnerBanner!: Container;
  private winnerBannerBg!: Graphics;
  private winnerText!: Text;
  private handInfoText!: Text;
  private phaseText!: Text;
  private statusText!: Text;

  private humanActionResolve: ((action: PlayerAction) => void) | null = null;
  private isReplayMode = false;
  private replayControls: ReplayControls | null = null;
  private replayCardPanel: ReplayCardVisibilityPanel | null = null;

  async init(isSpectator = false, ws?: WsClient, replayController?: ReplayController): Promise<void> {
    this.isSpectator = isSpectator;
    this.isReplayMode = !!replayController;
    this.app = new Application();
    await this.app.init({
      width: CANVAS_WIDTH,
      height: CANVAS_HEIGHT,
      backgroundColor: COLORS.background,
      antialias: true,
      resolution: window.devicePixelRatio || 1,
      autoDensity: true,
    });
    document.body.appendChild(this.app.canvas);

    // Scale canvas to fit viewport using CSS transform (preserves coordinate mapping)
    const fitToWindow = () => {
      const canvas = this.app.canvas;
      const scaleX = window.innerWidth / CANVAS_WIDTH;
      const scaleY = window.innerHeight / CANVAS_HEIGHT;
      const scale = Math.min(scaleX, scaleY, 1);
      canvas.style.position = 'absolute';
      canvas.style.transformOrigin = 'top left';
      canvas.style.transform = `scale(${scale})`;
      canvas.style.left = `${(window.innerWidth - CANVAS_WIDTH * scale) / 2}px`;
      canvas.style.top = `${(window.innerHeight - CANVAS_HEIGHT * scale) / 2}px`;
    };
    window.addEventListener('resize', fitToWindow);
    fitToWindow();

    this.tableLayer = new Container();
    this.playerLayer = new Container();
    this.communityLayer = new Container();
    this.uiLayer = new Container();

    this.app.stage.addChild(this.tableLayer);
    this.app.stage.addChild(this.playerLayer);
    this.app.stage.addChild(this.communityLayer);
    this.app.stage.addChild(this.uiLayer);

    // Table
    this.tableLayer.addChild(new TableRenderer());

    // Player seats
    const seatPositions = computeSeatPositions();
    for (let i = 0; i < NUM_SEATS; i++) {
      const pr = new PlayerRenderer(i, this.app);
      pr.x = seatPositions[i].x;
      pr.y = seatPositions[i].y;
      this.playerRenderers.push(pr);
      this.playerLayer.addChild(pr);
    }
    if (this.isReplayMode) {
      for (const pr of this.playerRenderers) pr.setReplayMode(true);
    }

    // Community cards
    this.communityCards = new CommunityCards(this.app);
    this.communityLayer.addChild(this.communityCards);

    // Pot display
    this.potDisplay = new PotDisplay();
    this.communityLayer.addChild(this.potDisplay);

    // Action panel (hidden for spectators and replay mode)
    this.actionPanel = new ActionPanel();
    if (!this.isSpectator && !this.isReplayMode) {
      this.uiLayer.addChild(this.actionPanel);
    }

    // Replay controls (shown only in replay mode)
    if (this.isReplayMode && replayController) {
      this.replayControls = new ReplayControls(replayController);
      this.uiLayer.addChild(this.replayControls);
      this.replayCardPanel = new ReplayCardVisibilityPanel(replayController);
      this.replayCardPanel.mount();
    }

    // Phase indicator ΓÇö white with dark stroke for visibility over green felt
    this.phaseText = new Text({
      text: '',
      style: {
        fontSize: 13,
        fill: 0xffffff,
        fontFamily: 'Arial',
        fontWeight: 'bold',
        letterSpacing: 3,
        stroke: { color: 0x000000, width: 3 },
      },
    });
    this.phaseText.anchor.set(0.5);
    this.phaseText.x = TABLE_CENTER_X;
    this.phaseText.y = TABLE_CENTER_Y - 100;
    this.uiLayer.addChild(this.phaseText);

    // Status indicator — shows whose turn it is / what's happening
    this.statusText = new Text({
      text: '',
      style: {
        fontSize: 12,
        fill: 0x94a3b8,
        fontFamily: 'Arial',
        fontStyle: 'italic',
      },
    });
    this.statusText.anchor.set(0.5);
    this.statusText.x = TABLE_CENTER_X;
    this.statusText.y = TABLE_CENTER_Y - 82;
    this.uiLayer.addChild(this.statusText);

    // Winner banner
    this.winnerBanner = new Container();
    this.winnerBanner.x = TABLE_CENTER_X;
    this.winnerBanner.y = TABLE_CENTER_Y + 100;
    this.winnerBanner.visible = false;
    this.uiLayer.addChild(this.winnerBanner);

    this.winnerBannerBg = new Graphics();
    this.winnerBanner.addChild(this.winnerBannerBg);

    this.winnerText = new Text({
      text: '',
      style: {
        fontSize: 16,
        fill: COLORS.gold,
        fontFamily: 'Arial',
        fontWeight: 'bold',
        align: 'center',
      },
    });
    this.winnerText.anchor.set(0.5);
    this.winnerBanner.addChild(this.winnerText);

    // Hand info
    this.handInfoText = new Text({
      text: '',
      style: { fontSize: 12, fill: COLORS.textMuted, fontFamily: 'Arial' },
    });
    this.handInfoText.x = 15;
    this.handInfoText.y = 12;
    this.uiLayer.addChild(this.handInfoText);

    // Title ΓÇö with more spacing from gear button
    const title = new Text({
      text: 'POKER AT HOME',
      style: { fontSize: 12, fill: COLORS.textMuted, fontFamily: 'Arial', letterSpacing: 3 },
    });
    title.anchor.set(1, 0);
    title.x = CANVAS_WIDTH - 60;
    title.y = 14;
    this.uiLayer.addChild(title);

    // Gear button (settings) ΓÇö proper gear/cog icon
    const gearBtn = new Container();
    gearBtn.x = CANVAS_WIDTH - 24;
    gearBtn.y = 22;

    const gearBg = new Graphics();
    gearBg.circle(0, 0, 16);
    gearBg.fill({ color: 0x333355, alpha: 0.7 });
    gearBg.eventMode = 'static';
    gearBg.cursor = 'pointer';
    gearBg.hitArea = { contains: (x: number, y: number) => x * x + y * y <= 18 * 18 };
    gearBtn.addChild(gearBg);

    const gearIcon = new Graphics();
    const drawGearIcon = (g: Graphics, color: number, bgColor: number) => {
      g.clear();
      const teeth = 8;
      const outerR = 9;
      const innerR = 6.5;
      const pts: number[] = [];
      for (let i = 0; i < teeth; i++) {
        const a = (i / teeth) * Math.PI * 2;
        const step = Math.PI / teeth;
        const tw = step * 0.4;
        pts.push(Math.cos(a - step + tw) * innerR, Math.sin(a - step + tw) * innerR);
        pts.push(Math.cos(a - tw) * outerR, Math.sin(a - tw) * outerR);
        pts.push(Math.cos(a + tw) * outerR, Math.sin(a + tw) * outerR);
        pts.push(Math.cos(a + step - tw) * innerR, Math.sin(a + step - tw) * innerR);
      }
      g.poly(pts);
      g.fill(color);
      g.circle(0, 0, 3);
      g.fill(bgColor);
    };
    drawGearIcon(gearIcon, COLORS.textLight, 0x333355);
    gearBtn.addChild(gearIcon);

    gearBg.on('pointerdown', () => {
      this.settingsPanel.show();
    });
    gearBg.on('pointerover', () => {
      drawGearIcon(gearIcon, 0xffffff, 0x555599);
      gearBg.clear(); gearBg.circle(0, 0, 16); gearBg.fill({ color: 0x555599, alpha: 0.95 });
      gearBtn.scale.set(1.1);
    });
    gearBg.on('pointerout', () => {
      drawGearIcon(gearIcon, COLORS.textLight, 0x333355);
      gearBg.clear(); gearBg.circle(0, 0, 16); gearBg.fill({ color: 0x333355, alpha: 0.7 });
      gearBtn.scale.set(1);
    });
    this.uiLayer.addChild(gearBtn);

    // Settings panel
    this.settingsPanel = new SettingsPanel(this.app);
    this.uiLayer.addChild(this.settingsPanel);

    // Info panel (bottom-left)
    this.infoPanel = new InfoPanel();
    this.uiLayer.addChild(this.infoPanel);

    // Spectator panel (bottom-right)
    this.spectatorPanel = new SpectatorPanel();
    this.uiLayer.addChild(this.spectatorPanel);

    // Spectator / Replay indicator
    this.spectatorText = new Text({
      text: this.isReplayMode ? 'REPLAY' : 'SPECTATING',
      style: {
        fontSize: 14,
        fill: this.isReplayMode ? 0x60a5fa : 0xfbbf24,
        fontFamily: 'Arial',
        fontWeight: 'bold',
        letterSpacing: 3,
        stroke: { color: 0x000000, width: 3 },
      },
    });
    this.spectatorText.anchor.set(0.5);
    this.spectatorText.x = TABLE_CENTER_X;
    // Move up in replay mode to avoid overlapping with replay controls
    this.spectatorText.y = this.isReplayMode ? CANVAS_HEIGHT - 90 : CANVAS_HEIGHT - 40;
    this.spectatorText.visible = this.isSpectator || this.isReplayMode;
    this.uiLayer.addChild(this.spectatorText);

    // Chat panel (HTML overlay)
    if (ws) {
      this.chatPanel = new ChatPanel(ws);
      this.chatPanel.mount();
    }

    // Listen for settings changes — clear card cache + re-render
    GameSettings.onChange(() => {
      clearTextureCache();
      // Force re-render of all player cards by resetting prevCardCount
      for (const pr of this.playerRenderers) {
        pr.resetForNewHand();
      }
      this.communityCards.clearAll();
      // Re-render current state if available
      if (this.lastState) {
        this.update(this.lastState);
        // Re-render community cards
        if (this.lastState.communityCards.length > 0) {
          this.communityCards.update(this.lastState.communityCards);
        }
      }
    });
  }

  update(state: GameState): void {
    this.lastState = state;
    const winnerIds = new Set(state.winners.map(w => w.playerIndex));

    for (let i = 0; i < NUM_SEATS; i++) {
      const player = state.players.find(p => p.seatIndex === i);
      if (player) {
        this.playerRenderers[i].visible = true;
        this.playerRenderers[i].update(player, state.phase, winnerIds.has(i));

        // Show hand description for human player
        if (player.isHuman && player.holeCards.length === 2 && !player.isFolded) {
          const desc = evaluateHandDescription(player.holeCards, state.communityCards);
          this.playerRenderers[i].setHandDescription(desc ?? '');
        } else {
          this.playerRenderers[i].setHandDescription('');
        }
      } else {
        this.playerRenderers[i].visible = false;
      }
    }

    this.communityCards.update(state.communityCards);
    this.potDisplay.update(state.pot);
    this.handInfoText.text = state.handNumber > 0
      ? `Hand #${state.handNumber}  $${state.smallBlindAmount}/$${state.bigBlindAmount}`
      : '';
    this.phaseText.text = PHASE_LABELS[state.phase] || '';

    // Status line — context-aware feedback
    const currentPlayer = state.players.find(p => p.isCurrent);
    if (currentPlayer && !currentPlayer.isHuman) {
      this.statusText.text = `Waiting for ${currentPlayer.name}...`;
      this.statusText.style.fill = 0x94a3b8;
    } else if (state.phase === 'waiting') {
      this.statusText.text = 'Waiting for game to start...';
      this.statusText.style.fill = 0x94a3b8;
    } else {
      this.statusText.text = '';
    }

    if (state.winners.length > 0) {
      const lines = state.winners.map(w => {
        const player = state.players.find(p => p.seatIndex === w.playerIndex);
        return player
          ? `${player.name} wins $${w.amount.toLocaleString()} — ${w.handDescription}`
          : `Winner: $${w.amount.toLocaleString()} — ${w.handDescription}`;
      });
      this.winnerText.text = lines.join('\n');

      // Draw bg pill behind text
      const tw = this.winnerText.width + 40;
      const th = this.winnerText.height + 16;
      this.winnerBannerBg.clear();
      this.winnerBannerBg.roundRect(-tw / 2, -th / 2, tw, th, 8);
      this.winnerBannerBg.fill({ color: 0x000000, alpha: 0.6 });

      // Don't show yet — animateWinners will pop it in
      this.winnerBanner.visible = false;
    } else {
      this.winnerBanner.visible = false;
    }

    // Update spectator panel
    this.spectatorPanel.update(state.spectators);
  }

  /** Animate community card reveal (called by Game instead of direct state update) */
  async animateCommunityReveal(newCards: Card[], existingCount: number): Promise<void> {
    await this.communityCards.animateReveal(newCards, existingCount);
  }

  /** Animate the phase label changing */
  async animatePhaseChange(phase: string): Promise<void> {
    const label = PHASE_LABELS[phase] || '';
    if (!label) return;

    this.phaseText.text = label;
    this.phaseText.alpha = 0;
    this.phaseText.scale.set(1.5);

    await tween(this.app.ticker, {
      target: this.phaseText, duration: 400, easing: easeOutBack,
      props: { alpha: 1, scaleX: 1, scaleY: 1 },
    });
  }

  /** Play winner celebration */
  async animateWinners(winnerIndices: number[]): Promise<void> {
    // Show banner with pop animation
    this.winnerBanner.scale.set(0.5);
    this.winnerBanner.alpha = 0;
    this.winnerBanner.visible = true;

    await tween(this.app.ticker, {
      target: this.winnerBanner, duration: 400, easing: easeOutBack,
      props: { scaleX: 1, scaleY: 1, alpha: 1 },
    });

    // Bounce the winning player panels
    const promises = winnerIndices.map(i => this.playerRenderers[i].playWinAnimation());
    await Promise.all(promises);
  }

  /** Reset all player cards for new hand */
  resetForNewHand(): void {
    for (const pr of this.playerRenderers) {
      pr.resetForNewHand();
    }
    this.communityCards.clearAll();
    this.winnerBanner.visible = false;
  }

  addLog(message: string): void {
    this.infoPanel.addLog(message);
  }

  addChatMessage(msg: ChatMessage): void {
    this.chatPanel?.addMessage(msg);
  }

  updateStats(handsPlayed: number, handsWon: number, biggestPot: number): void {
    this.infoPanel.updateStats(handsPlayed, handsWon, biggestPot);
  }

  waitForHumanAction(available: AvailableActions, pot: number, timeToActMs?: number): Promise<PlayerAction> {
    return new Promise((resolve) => {
      this.humanActionResolve = resolve;
      this.actionPanel.show(available, pot, (action: PlayerAction) => {
        this.humanActionResolve = null;
        this.actionPanel.hide();
        resolve(action);
      }, timeToActMs);
    });
  }

  /** Force-cancel a pending human action (e.g. on timeout) */
  cancelHumanAction(): void {
    this.actionPanel.hide();
    if (this.humanActionResolve) {
      this.humanActionResolve({ type: 'fold' }); // dummy; won't be sent to server
      this.humanActionResolve = null;
    }
  }

  /** Update the action timer display */
  updateTimer(remainingMs: number): void {
    this.actionPanel.updateTimer(remainingMs);
  }

  /** Show action pop text on a player seat */
  showPlayerActionPop(seatIndex: number, text: string, color: number): void {
    if (seatIndex >= 0 && seatIndex < this.playerRenderers.length) {
      this.playerRenderers[seatIndex].showActionPop(text, color);
    }
  }
}