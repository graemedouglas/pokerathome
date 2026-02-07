import { Player, AvailableActions, PlayerAction, BotStyle, GamePhase } from '../types';
import { BOT_THINK_MIN, BOT_THINK_MAX } from '../constants';
import { AVATAR_COUNT } from '../renderer/AvatarRenderer';

const BOT_NAMES = [
  'Alice', 'Bob', 'Charlie', 'Diana', 'Eddie', 'Fiona',
  'George', 'Helen', 'Ivan', 'Julia', 'Kevin', 'Linda',
];

const BOT_STYLES: BotStyle[] = ['tight-passive', 'loose-passive', 'tight-aggressive', 'loose-aggressive'];

let namePool = [...BOT_NAMES];
let avatarPool: number[] = [];

export function resetNamePool(): void {
  namePool = [...BOT_NAMES];
  avatarPool = [];
}

export function getRandomAvatarId(excludeIds: number[]): number {
  if (avatarPool.length === 0) {
    avatarPool = Array.from({ length: AVATAR_COUNT }, (_, i) => i);
  }
  // Filter out excluded IDs
  const available = avatarPool.filter(id => !excludeIds.includes(id));
  const pool = available.length > 0 ? available : avatarPool;
  const idx = Math.floor(Math.random() * pool.length);
  const chosen = pool[idx];
  avatarPool = avatarPool.filter(id => id !== chosen);
  return chosen;
}

export function getRandomBotName(): string {
  if (namePool.length === 0) namePool = [...BOT_NAMES];
  const idx = Math.floor(Math.random() * namePool.length);
  return 'Bot ' + namePool.splice(idx, 1)[0];
}

export function getRandomBotStyle(): BotStyle {
  return BOT_STYLES[Math.floor(Math.random() * BOT_STYLES.length)];
}

export function getBotThinkTime(): number {
  return BOT_THINK_MIN + Math.random() * (BOT_THINK_MAX - BOT_THINK_MIN);
}

export function decideBotAction(
  player: Player,
  available: AvailableActions,
  phase: GamePhase,
  pot: number,
): PlayerAction {
  const style = player.botStyle || 'tight-passive';
  const random = Math.random();

  const isLoose = style.startsWith('loose');
  const isAggressive = style.endsWith('aggressive');

  // Factor: how much to call relative to stack
  const callRatio = available.callAmount / (player.chips || 1);

  // Preflop behavior
  if (phase === 'preflop') {
    if (available.canCheck) {
      // In big blind, no raise to face
      if (isAggressive && random < 0.3) {
        const raiseAmt = Math.min(
          available.minRaise + Math.floor(Math.random() * pot),
          available.maxRaise,
        );
        return { type: 'raise', amount: raiseAmt };
      }
      return { type: 'check' };
    }

    // Facing a raise
    if (callRatio > 0.3) {
      // Expensive call
      if (isLoose) {
        return random < 0.5 ? { type: 'call' } : { type: 'fold' };
      }
      return random < 0.25 ? { type: 'call' } : { type: 'fold' };
    }

    // Cheap call
    if (isAggressive && random < 0.25 && available.canRaise) {
      const raiseAmt = Math.min(
        available.minRaise + Math.floor(Math.random() * pot * 0.5),
        available.maxRaise,
      );
      return { type: 'raise', amount: raiseAmt };
    }
    return { type: 'call' };
  }

  // Postflop behavior
  if (available.canCheck) {
    if (isAggressive && random < 0.35 && available.canRaise) {
      // Bet
      const betSize = Math.min(
        Math.floor(pot * (0.3 + Math.random() * 0.7)),
        available.maxRaise,
      );
      const amount = Math.max(available.minRaise, betSize);
      return { type: 'raise', amount };
    }
    return { type: 'check' };
  }

  // Facing a bet postflop
  if (callRatio > 0.5) {
    // Very expensive
    if (isLoose && random < 0.25) return { type: 'call' };
    if (!isLoose && random < 0.1) return { type: 'call' };
    return { type: 'fold' };
  }

  if (callRatio > 0.2) {
    // Moderate cost
    if (isLoose) {
      if (isAggressive && random < 0.2 && available.canRaise) {
        const raiseAmt = Math.min(
          available.minRaise + Math.floor(Math.random() * pot * 0.5),
          available.maxRaise,
        );
        return { type: 'raise', amount: raiseAmt };
      }
      return random < 0.65 ? { type: 'call' } : { type: 'fold' };
    }
    return random < 0.45 ? { type: 'call' } : { type: 'fold' };
  }

  // Cheap call
  if (isAggressive && random < 0.3 && available.canRaise) {
    const raiseAmt = Math.min(
      available.minRaise + Math.floor(Math.random() * pot * 0.5),
      available.maxRaise,
    );
    return { type: 'raise', amount: raiseAmt };
  }
  return { type: 'call' };
}
