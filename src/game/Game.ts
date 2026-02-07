import { GameState, GamePhase, Player, PlayerAction, Card, WinnerInfo, AvailableActions } from '../types';
import { Deck } from './Deck';
import { getAvailableActions, validateAction } from './BettingRound';
import { evaluateHand, compareHands } from './HandEvaluator';
import { decideBotAction, getRandomBotName, getRandomBotStyle, getBotThinkTime, resetNamePool, getRandomAvatarId } from './BotPlayer';
import { GameSettings } from '../settings/GameSettings';
import {
  NUM_SEATS, STARTING_CHIPS, SMALL_BLIND, BIG_BLIND,
  DEAL_DELAY, PHASE_DELAY, SHOWDOWN_DELAY, NEXT_HAND_DELAY,
} from '../constants';
import { delay } from '../utils/Animations';

export type GameEventCallback = (state: GameState) => void;

interface GameRendererInterface {
  update: (state: GameState) => void;
  waitForHumanAction: (available: AvailableActions, pot: number) => Promise<PlayerAction>;
  animateCommunityReveal: (newCards: Card[], existingCount: number) => Promise<void>;
  animatePhaseChange: (phase: string) => Promise<void>;
  animateWinners: (winnerIndices: number[]) => Promise<void>;
  resetForNewHand: () => void;
  addLog: (message: string) => void;
  updateStats: (handsPlayed: number, handsWon: number, biggestPot: number) => void;
}

export class Game {
  private state: GameState;
  private deck: Deck;
  private renderer: GameRendererInterface;
  private running = false;
  private currentHighBet = 0;
  private lastRaise = BIG_BLIND;
  private humanSeatIndex = -1;
  private humanHandsWon = 0;

  constructor(renderer: GameRendererInterface) {
    this.deck = new Deck();
    this.renderer = renderer;
    this.state = this.createInitialState();
  }

  private createInitialState(): GameState {
    resetNamePool();
    const humanAvatarId = GameSettings.humanAvatarId;
    const players: Player[] = [];
    for (let i = 0; i < NUM_SEATS; i++) {
      const isHuman = i === this.humanSeatIndex;
      players.push({
        id: i,
        name: isHuman ? 'You' : getRandomBotName(),
        chips: STARTING_CHIPS,
        holeCards: [],
        currentBet: 0,
        totalBetThisRound: 0,
        isFolded: false,
        isAllIn: false,
        isDealer: false,
        isSB: false,
        isBB: false,
        isCurrent: false,
        isHuman,
        seatIndex: i,
        avatarId: isHuman ? humanAvatarId : getRandomAvatarId([humanAvatarId]),
        botStyle: isHuman ? undefined : getRandomBotStyle(),
      });
    }
    return {
      phase: 'waiting',
      players,
      communityCards: [],
      pot: 0,
      currentPlayerIndex: 0,
      dealerIndex: 0,
      winners: [],
      handNumber: 0,
    };
  }

  setHumanSeat(seatIndex: number): void {
    this.humanSeatIndex = seatIndex;
    // Re-create state now that we know which seat is human
    this.state = this.createInitialState();
  }

  async start(): Promise<void> {
    this.running = true;
    this.state.dealerIndex = Math.floor(Math.random() * NUM_SEATS);

    while (this.running) {
      const activePlayers = this.state.players.filter(p => p.chips > 0);
      if (activePlayers.length < 2) {
        this.state.phase = 'waiting';
        this.emit();
        break;
      }

      await this.playHand();
      await delay(NEXT_HAND_DELAY);

      this.state.dealerIndex = this.nextActivePlayer(this.state.dealerIndex);
    }
  }

  stop(): void {
    this.running = false;
  }

  private async playHand(): Promise<void> {
    this.state.handNumber++;
    this.deck.reset();
    this.state.communityCards = [];
    this.state.pot = 0;
    this.state.winners = [];
    this.renderer.addLog(`--- Hand #${this.state.handNumber} ---`);

    // Reset players
    for (const p of this.state.players) {
      p.holeCards = [];
      p.currentBet = 0;
      p.totalBetThisRound = 0;
      p.isFolded = p.chips <= 0;
      p.isAllIn = false;
      p.isDealer = false;
      p.isSB = false;
      p.isBB = false;
      p.isCurrent = false;
    }

    // Reset renderer for new hand
    this.renderer.resetForNewHand();

    // Assign positions
    const dealer = this.state.dealerIndex;
    this.state.players[dealer].isDealer = true;

    const sbIndex = this.nextActivePlayer(dealer);
    const bbIndex = this.nextActivePlayer(sbIndex);
    this.state.players[sbIndex].isSB = true;
    this.state.players[bbIndex].isBB = true;

    // Post blinds
    this.postBlind(sbIndex, SMALL_BLIND);
    this.postBlind(bbIndex, BIG_BLIND);
    this.currentHighBet = BIG_BLIND;
    this.lastRaise = BIG_BLIND;
    this.renderer.addLog(`${this.state.players[sbIndex].name} posts SB $${SMALL_BLIND}`);
    this.renderer.addLog(`${this.state.players[bbIndex].name} posts BB $${BIG_BLIND}`);

    this.emit();
    await delay(400); // Brief pause to show table setup

    // Deal hole cards with animation
    this.state.phase = 'preflop';
    await this.renderer.animatePhaseChange('preflop');
    await this.dealHoleCards();
    this.emit();

    // Preflop betting
    const preflopStart = this.nextActivePlayer(bbIndex);
    const allFolded = await this.runBettingRound(preflopStart, true);
    if (allFolded) { await this.awardPotToLastStanding(); return; }

    // Flop — deal 3 cards with dramatic reveal
    this.state.phase = 'flop';
    const flopCards = [this.deck.deal(), this.deck.deal(), this.deck.deal()];
    await this.renderer.animatePhaseChange('flop');
    await this.renderer.animateCommunityReveal(flopCards, 0);
    this.state.communityCards.push(...flopCards);
    this.emit();
    await delay(400);

    const flopFolded = await this.runBettingRound(this.nextActivePlayer(this.state.dealerIndex), false);
    if (flopFolded) { await this.awardPotToLastStanding(); return; }

    // Turn — single card, more suspense
    this.state.phase = 'turn';
    const turnCard = this.deck.deal();
    await this.renderer.animatePhaseChange('turn');
    await this.renderer.animateCommunityReveal([turnCard], 3);
    this.state.communityCards.push(turnCard);
    this.emit();
    await delay(400);

    const turnFolded = await this.runBettingRound(this.nextActivePlayer(this.state.dealerIndex), false);
    if (turnFolded) { await this.awardPotToLastStanding(); return; }

    // River — maximum suspense
    this.state.phase = 'river';
    const riverCard = this.deck.deal();
    await this.renderer.animatePhaseChange('river');
    await this.renderer.animateCommunityReveal([riverCard], 4);
    this.state.communityCards.push(riverCard);
    this.emit();
    await delay(400);

    const riverFolded = await this.runBettingRound(this.nextActivePlayer(this.state.dealerIndex), false);
    if (riverFolded) { await this.awardPotToLastStanding(); return; }

    // Showdown
    await this.showdown();
  }

  private async dealHoleCards(): Promise<void> {
    for (let round = 0; round < 2; round++) {
      for (let i = 0; i < NUM_SEATS; i++) {
        const idx = (this.state.dealerIndex + 1 + i) % NUM_SEATS;
        const player = this.state.players[idx];
        if (!player.isFolded && player.chips > 0) {
          player.holeCards.push(this.deck.deal());
          this.emit();
          await delay(DEAL_DELAY);
        }
      }
    }
    // Extra pause after dealing to appreciate the cards
    await delay(300);
  }

  private postBlind(playerIndex: number, amount: number): void {
    const player = this.state.players[playerIndex];
    const actual = Math.min(amount, player.chips);
    player.chips -= actual;
    player.currentBet = actual;
    player.totalBetThisRound = actual;
    this.state.pot += actual;
    if (player.chips === 0) player.isAllIn = true;
  }

  private async runBettingRound(startIndex: number, isPreflop: boolean): Promise<boolean> {
    this.resetBetsForRound(isPreflop);

    let playersToAct = this.countPlayersWhoCanAct();
    if (playersToAct <= 1) return this.checkAllFolded();

    let currentIndex = startIndex;
    let lastRaiserIndex = -1;
    let acted = 0;

    while (true) {
      const player = this.state.players[currentIndex];

      if (!player.isFolded && !player.isAllIn && player.chips > 0) {
        for (const p of this.state.players) p.isCurrent = false;
        player.isCurrent = true;
        this.state.currentPlayerIndex = currentIndex;
        this.emit();

        const available = getAvailableActions(player, this.currentHighBet, this.state.pot, this.lastRaise);
        let action: PlayerAction;

        if (player.isHuman) {
          action = await this.renderer.waitForHumanAction(available, this.state.pot);
        } else {
          await delay(getBotThinkTime());
          action = decideBotAction(player, available, this.state.phase, this.state.pot);
        }

        action = validateAction(action, available);
        this.logAction(player, action);
        this.applyAction(currentIndex, action);
        acted++;

        if (action.type === 'raise' || action.type === 'allin') {
          lastRaiserIndex = currentIndex;
          acted = 1;
          playersToAct = this.countPlayersWhoCanAct();
        }

        player.isCurrent = false;
        this.emit();

        if (this.checkAllFolded()) return true;
      }

      currentIndex = this.nextActivePlayer(currentIndex);

      if (currentIndex === lastRaiserIndex) break;
      if (lastRaiserIndex === -1 && acted >= playersToAct) break;
    }

    return false;
  }

  private resetBetsForRound(isPreflop: boolean): void {
    if (!isPreflop) {
      for (const p of this.state.players) {
        p.currentBet = 0;
      }
      this.currentHighBet = 0;
      this.lastRaise = BIG_BLIND;
    }
  }

  private countPlayersWhoCanAct(): number {
    return this.state.players.filter(p => !p.isFolded && !p.isAllIn && p.chips > 0).length;
  }

  private applyAction(playerIndex: number, action: PlayerAction): void {
    const player = this.state.players[playerIndex];

    switch (action.type) {
      case 'fold':
        player.isFolded = true;
        break;
      case 'check':
        break;
      case 'call': {
        const amount = Math.min(action.amount || 0, player.chips);
        player.chips -= amount;
        player.currentBet += amount;
        player.totalBetThisRound += amount;
        this.state.pot += amount;
        if (player.chips === 0) player.isAllIn = true;
        break;
      }
      case 'raise': {
        const amount = Math.min(action.amount || 0, player.chips);
        const raiseOver = (player.currentBet + amount) - this.currentHighBet;
        player.chips -= amount;
        player.currentBet += amount;
        player.totalBetThisRound += amount;
        this.state.pot += amount;
        if (raiseOver > this.lastRaise) this.lastRaise = raiseOver;
        this.currentHighBet = player.currentBet;
        if (player.chips === 0) player.isAllIn = true;
        break;
      }
      case 'allin': {
        const amount = player.chips;
        player.chips = 0;
        player.currentBet += amount;
        player.totalBetThisRound += amount;
        this.state.pot += amount;
        const raiseOver = player.currentBet - this.currentHighBet;
        if (raiseOver > 0) {
          if (raiseOver > this.lastRaise) this.lastRaise = raiseOver;
          this.currentHighBet = player.currentBet;
        }
        player.isAllIn = true;
        break;
      }
    }
  }

  private checkAllFolded(): boolean {
    const activePlayers = this.state.players.filter(p => !p.isFolded);
    return activePlayers.length <= 1;
  }

  private async awardPotToLastStanding(): Promise<void> {
    const winner = this.state.players.find(p => !p.isFolded);
    if (winner) {
      const potAmount = this.state.pot;
      winner.chips += potAmount;
      this.state.winners = [{
        playerIndex: winner.id,
        amount: potAmount,
        handDescription: 'Everyone folded',
      }];
      this.state.phase = 'showdown';
      this.state.pot = 0;
      this.renderer.addLog(`${winner.name} wins $${potAmount} (all others folded)`);
      if (winner.id === this.humanSeatIndex) this.humanHandsWon++;
      this.renderer.updateStats(this.state.handNumber, this.humanHandsWon, potAmount);
      this.emit();
      await this.renderer.animateWinners([winner.id]);
      await delay(SHOWDOWN_DELAY);
    }
  }

  private async showdown(): Promise<void> {
    this.state.phase = 'showdown';
    await this.renderer.animatePhaseChange('showdown');

    const contenders = this.state.players.filter(p => !p.isFolded);

    // Emit to trigger card flip animations
    this.emit();
    await delay(800); // Let card flips play

    // Evaluate hands
    const results = contenders.map(p => {
      const allCards = [...p.holeCards, ...this.state.communityCards];
      const handRank = evaluateHand(allCards);
      return { player: p, handRank };
    });

    results.sort((a, b) => compareHands(b.handRank, a.handRank));

    const winners: typeof results = [results[0]];
    for (let i = 1; i < results.length; i++) {
      if (compareHands(results[i].handRank, results[0].handRank) === 0) {
        winners.push(results[i]);
      } else {
        break;
      }
    }

    const share = Math.floor(this.state.pot / winners.length);
    const remainder = this.state.pot - share * winners.length;

    const totalPot = this.state.pot;
    this.state.winners = winners.map((w, i) => {
      const amount = share + (i === 0 ? remainder : 0);
      w.player.chips += amount;
      this.renderer.addLog(`${w.player.name} wins $${amount} — ${w.handRank.description}`);
      if (w.player.id === this.humanSeatIndex) this.humanHandsWon++;
      return {
        playerIndex: w.player.id,
        amount,
        handDescription: w.handRank.description,
      };
    });

    this.renderer.updateStats(this.state.handNumber, this.humanHandsWon, totalPot);
    this.state.pot = 0;
    this.emit();

    // Dramatic winner celebration
    const winnerIndices = this.state.winners.map(w => w.playerIndex);
    await this.renderer.animateWinners(winnerIndices);

    await delay(SHOWDOWN_DELAY);
  }

  private nextActivePlayer(fromIndex: number): number {
    let idx = (fromIndex + 1) % NUM_SEATS;
    let attempts = 0;
    while (attempts < NUM_SEATS) {
      const p = this.state.players[idx];
      if (!p.isFolded && p.chips >= 0 && !(p.chips === 0 && !p.isAllIn && p.holeCards.length === 0)) {
        return idx;
      }
      idx = (idx + 1) % NUM_SEATS;
      attempts++;
    }
    return fromIndex;
  }

  private logAction(player: Player, action: PlayerAction): void {
    switch (action.type) {
      case 'fold':
        this.renderer.addLog(`${player.name} folds`);
        break;
      case 'check':
        this.renderer.addLog(`${player.name} checks`);
        break;
      case 'call':
        this.renderer.addLog(`${player.name} calls $${action.amount}`);
        break;
      case 'raise':
        this.renderer.addLog(`${player.name} raises to $${player.currentBet + (action.amount || 0)}`);
        break;
      case 'allin':
        this.renderer.addLog(`${player.name} goes all in ($${player.chips})`);
        break;
    }
  }

  private emit(): void {
    this.renderer.update({ ...this.state });
  }
}
