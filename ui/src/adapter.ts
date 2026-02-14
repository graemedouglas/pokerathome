import type {
  GameState as ServerGameState,
  PlayerState as ServerPlayerState,
  ActionRequest as ServerActionRequest,
  Event as ServerEvent,
  Card as ServerCard,
} from '@pokerathome/schema'
import type {
  GameState, Player, Card, Suit, Rank, GamePhase,
  AvailableActions, PlayerAction, WinnerInfo,
} from './types'

const SUIT_MAP: Record<string, Suit> = {
  h: 'hearts',
  d: 'diamonds',
  c: 'clubs',
  s: 'spades',
}

const RANK_MAP: Record<string, Rank> = {
  '2': '2', '3': '3', '4': '4', '5': '5', '6': '6',
  '7': '7', '8': '8', '9': '9', 'T': '10',
  'J': 'J', 'Q': 'Q', 'K': 'K', 'A': 'A',
}

const STAGE_MAP: Record<string, GamePhase> = {
  PRE_FLOP: 'preflop',
  FLOP: 'flop',
  TURN: 'turn',
  RIVER: 'river',
  SHOWDOWN: 'showdown',
}

export function adaptCard(serverCard: ServerCard): Card {
  const rankChar = serverCard.slice(0, -1)
  const suitChar = serverCard.slice(-1)
  return {
    suit: SUIT_MAP[suitChar] ?? 'spades',
    rank: RANK_MAP[rankChar] ?? 'A',
    code: serverCard,
  }
}

export interface AdapterContext {
  myPlayerId: string
  sbPlayerId?: string
  bbPlayerId?: string
  winners?: WinnerInfo[]
  cardsDealt?: boolean
  /** Hole cards revealed at showdown, keyed by server playerId */
  showdownHoleCards?: Map<string, [string, string]>
}

export function adaptGameState(
  server: ServerGameState,
  ctx: AdapterContext,
): GameState {
  const phase = STAGE_MAP[server.stage] ?? 'waiting'

  const players: Player[] = server.players.map((sp) => {
    const isDealer = sp.seatIndex === server.dealerSeatIndex
    const isCurrent = sp.id === server.activePlayerId
    const isHuman = sp.id === ctx.myPlayerId
    const isAllIn = sp.stack === 0 && !sp.folded && sp.bet > 0

    // Use showdown holeCards if the server state doesn't include them (opponents)
    const serverCards = sp.holeCards
    const showdownCards = ctx.showdownHoleCards?.get(sp.id)
    const resolvedCards = serverCards
      ? serverCards.map(adaptCard)
      : showdownCards
        ? showdownCards.map(adaptCard)
        : []

    return {
      id: sp.seatIndex,
      name: sp.displayName,
      chips: sp.stack,
      holeCards: resolvedCards,
      hasHiddenCards: !serverCards && !showdownCards && !!ctx.cardsDealt && !sp.folded,
      currentBet: sp.bet,
      totalBetThisRound: sp.bet,
      isFolded: sp.folded,
      isAllIn,
      isDealer,
      isSB: sp.id === ctx.sbPlayerId,
      isBB: sp.id === ctx.bbPlayerId,
      isCurrent,
      isHuman,
      seatIndex: sp.seatIndex,
      avatarId: sp.seatIndex,
    }
  })

  // Sort players by seatIndex so renderer can index by seat
  players.sort((a, b) => a.seatIndex - b.seatIndex)

  const currentPlayerIndex = players.findIndex(p => p.isCurrent)

  return {
    phase,
    players,
    communityCards: server.communityCards.map(adaptCard),
    pot: server.pot,
    currentPlayerIndex: currentPlayerIndex >= 0 ? currentPlayerIndex : 0,
    dealerIndex: server.dealerSeatIndex,
    winners: ctx.winners ?? [],
    handNumber: server.handNumber,
  }
}

export function adaptActionRequest(req: ServerActionRequest): AvailableActions {
  let canFold = false
  let canCheck = false
  let canCall = false
  let callAmount = 0
  let canRaise = false
  let minRaise = 0
  let maxRaise = 0
  let allInAmount = 0
  let raiseType: 'BET' | 'RAISE' | null = null

  for (const opt of req.availableActions) {
    switch (opt.type) {
      case 'FOLD':
        canFold = true
        break
      case 'CHECK':
        canCheck = true
        break
      case 'CALL':
        canCall = true
        callAmount = opt.amount ?? 0
        break
      case 'BET':
        canRaise = true
        raiseType = 'BET'
        minRaise = opt.min ?? 0
        maxRaise = opt.max ?? 0
        break
      case 'RAISE':
        canRaise = true
        raiseType = 'RAISE'
        minRaise = opt.min ?? 0
        maxRaise = opt.max ?? 0
        break
      case 'ALL_IN':
        allInAmount = opt.amount ?? 0
        // Only use ALL_IN for the raise slider when no BET/RAISE is available
        // (e.g. player can't afford the min raise but can still shove)
        if (!canRaise) {
          canRaise = true
          minRaise = allInAmount
          maxRaise = allInAmount
        }
        break
    }
  }

  return { canFold, canCheck, canCall, callAmount, canRaise, minRaise, maxRaise, allInAmount, raiseType }
}

export function adaptPlayerAction(
  uiAction: PlayerAction,
  handNumber: number,
  available: AvailableActions,
): { handNumber: number; type: string; amount?: number } {
  // For raise/bet actions, determine the correct server action type.
  // The UI merges BET/RAISE/ALL_IN into a single slider — we need to
  // reverse-map to the right server type based on what's actually available.
  if (uiAction.type === 'raise') {
    if (available.allInAmount > 0 && uiAction.amount === available.allInAmount) {
      return { handNumber, type: 'ALL_IN' }
    }
    return {
      handNumber,
      type: available.raiseType ?? 'RAISE',
      amount: uiAction.amount,
    }
  }

  const TYPE_MAP: Record<string, string> = {
    fold: 'FOLD',
    check: 'CHECK',
    call: 'CALL',
    allin: 'ALL_IN',
  }

  return {
    handNumber,
    type: TYPE_MAP[uiAction.type] ?? 'FOLD',
  }
}

export function extractBlindPlayers(event: ServerEvent): { sbPlayerId?: string; bbPlayerId?: string } {
  if (event.type === 'BLINDS_POSTED') {
    return {
      sbPlayerId: event.smallBlind.playerId,
      bbPlayerId: event.bigBlind.playerId,
    }
  }
  return {}
}

export function extractWinners(
  event: ServerEvent,
  players: ServerPlayerState[],
  showdownResults?: Map<string, string>,
): WinnerInfo[] {
  if (event.type !== 'HAND_END') return []

  // Aggregate by playerId so a player who wins multiple pots appears once
  const byPlayer = new Map<string, WinnerInfo>()
  for (const w of event.winners) {
    const player = players.find(p => p.id === w.playerId)
    const seatIndex = player?.seatIndex ?? 0
    const handDesc = showdownResults?.get(w.playerId) ?? 'Winner'

    const existing = byPlayer.get(w.playerId)
    if (existing) {
      existing.amount += w.amount
    } else {
      byPlayer.set(w.playerId, {
        playerIndex: seatIndex,
        amount: w.amount,
        handDescription: handDesc,
      })
    }
  }

  return [...byPlayer.values()]
}
