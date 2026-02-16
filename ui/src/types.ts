export type Suit = 'hearts' | 'diamonds' | 'clubs' | 'spades'
export type Rank = '2' | '3' | '4' | '5' | '6' | '7' | '8' | '9' | '10' | 'J' | 'Q' | 'K' | 'A'

export interface Card {
  suit: Suit
  rank: Rank
  code: string
}

export type GamePhase = 'waiting' | 'preflop' | 'flop' | 'turn' | 'river' | 'showdown'

export type BotStyle = 'tight-passive' | 'loose-passive' | 'tight-aggressive' | 'loose-aggressive'

export type PlayerActionType = 'fold' | 'check' | 'call' | 'raise' | 'allin'

export interface PlayerAction {
  type: PlayerActionType
  amount?: number
}

export interface Player {
  id: number
  name: string
  chips: number
  holeCards: Card[]
  hasHiddenCards: boolean
  currentBet: number
  totalBetThisRound: number
  isFolded: boolean
  isAllIn: boolean
  isDealer: boolean
  isSB: boolean
  isBB: boolean
  isCurrent: boolean
  isHuman: boolean
  seatIndex: number
  avatarId: number
  botStyle?: BotStyle
}

export interface AvailableActions {
  canFold: boolean
  canCheck: boolean
  canCall: boolean
  callAmount: number
  canRaise: boolean
  minRaise: number
  maxRaise: number
  allInAmount: number
  raiseType: 'BET' | 'RAISE' | null
}

export interface GameState {
  phase: GamePhase
  players: Player[]
  spectators: string[]
  communityCards: Card[]
  pot: number
  currentPlayerIndex: number
  dealerIndex: number
  winners: WinnerInfo[]
  handNumber: number
}

export interface WinnerInfo {
  playerIndex: number
  amount: number
  handDescription: string
}

export type GameEventType =
  | 'deal'
  | 'communityReveal'
  | 'playerAction'
  | 'phaseChange'
  | 'showdown'
  | 'potUpdate'
  | 'newHand'
  | 'gameOver'

export interface GameEvent {
  type: GameEventType
  data?: unknown
}

export interface HandRank {
  rank: number
  description: string
  tiebreaker: number[]
}

export const SUITS: Suit[] = ['hearts', 'diamonds', 'clubs', 'spades']
export const RANKS: Rank[] = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A']

export const RANK_VALUES: Record<Rank, number> = {
  '2': 2, '3': 3, '4': 4, '5': 5, '6': 6, '7': 7, '8': 8, '9': 9, '10': 10,
  'J': 11, 'Q': 12, 'K': 13, 'A': 14,
}

export const SUIT_SYMBOLS: Record<Suit, string> = {
  hearts: '\u2665', diamonds: '\u2666', clubs: '\u2663', spades: '\u2660',
}
