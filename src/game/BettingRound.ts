import { Player, AvailableActions, PlayerAction } from '../types';

export function getAvailableActions(player: Player, currentHighBet: number, pot: number, lastRaise: number): AvailableActions {
  if (player.isFolded || player.isAllIn) {
    return {
      canFold: false,
      canCheck: false,
      canCall: false,
      callAmount: 0,
      canRaise: false,
      minRaise: 0,
      maxRaise: 0,
    };
  }

  const toCall = currentHighBet - player.currentBet;
  const canCheck = toCall === 0;
  const canCall = toCall > 0 && player.chips > 0;
  const callAmount = Math.min(toCall, player.chips);

  // Minimum raise: must be at least the size of the last raise (or big blind)
  const minRaiseSize = Math.max(lastRaise, 10); // 10 = big blind default
  const minRaiseTotal = currentHighBet + minRaiseSize;
  const minRaise = minRaiseTotal - player.currentBet;
  const maxRaise = player.chips;

  const canRaise = player.chips > callAmount;

  return {
    canFold: true,
    canCheck,
    canCall,
    callAmount,
    canRaise,
    minRaise: Math.min(minRaise, maxRaise),
    maxRaise,
  };
}

export function validateAction(action: PlayerAction, available: AvailableActions): PlayerAction {
  switch (action.type) {
    case 'fold':
      if (available.canCheck) return { type: 'check' }; // Don't fold when you can check
      return action;
    case 'check':
      if (!available.canCheck) return { type: 'fold' };
      return action;
    case 'call':
      if (!available.canCall) {
        if (available.canCheck) return { type: 'check' };
        return { type: 'fold' };
      }
      return { type: 'call', amount: available.callAmount };
    case 'raise':
      if (!available.canRaise) {
        if (available.canCall) return { type: 'call', amount: available.callAmount };
        if (available.canCheck) return { type: 'check' };
        return { type: 'fold' };
      }
      const amount = action.amount || available.minRaise;
      if (amount >= available.maxRaise) {
        return { type: 'allin', amount: available.maxRaise };
      }
      return { type: 'raise', amount: Math.max(available.minRaise, Math.min(amount, available.maxRaise)) };
    case 'allin':
      return { type: 'allin', amount: available.maxRaise };
    default:
      return { type: 'fold' };
  }
}
