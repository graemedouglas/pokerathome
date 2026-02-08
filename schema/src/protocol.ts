import { z } from 'zod';

// ═══════════════════════════════════════════════════════════════════════════════
// Primitives & Enums
// ═══════════════════════════════════════════════════════════════════════════════

/** Card in standard notation: rank (2-9, T, J, Q, K, A) + suit (h, d, c, s) */
export const Card = z.string().regex(/^[2-9TJQKA][hdcs]$/);
export type Card = z.infer<typeof Card>;

export const GameType = z.enum(['cash', 'tournament']);
export type GameType = z.infer<typeof GameType>;

export const Stage = z.enum(['PRE_FLOP', 'FLOP', 'TURN', 'RIVER', 'SHOWDOWN']);
export type Stage = z.infer<typeof Stage>;

export const ActionType = z.enum(['FOLD', 'CHECK', 'CALL', 'BET', 'RAISE', 'ALL_IN']);
export type ActionType = z.infer<typeof ActionType>;

export const PlayerRole = z.enum(['player', 'spectator']);
export type PlayerRole = z.infer<typeof PlayerRole>;

export const ErrorCode = z.enum([
  'INVALID_ACTION',
  'OUT_OF_TURN',
  'INVALID_AMOUNT',
  'NOT_IN_GAME',
  'GAME_NOT_FOUND',
  'GAME_FULL',
  'ALREADY_IN_GAME',
  'NOT_IDENTIFIED',
  'INVALID_MESSAGE',
]);
export type ErrorCode = z.infer<typeof ErrorCode>;

export const HandRank = z.enum([
  'HIGH_CARD',
  'PAIR',
  'TWO_PAIR',
  'THREE_OF_A_KIND',
  'STRAIGHT',
  'FLUSH',
  'FULL_HOUSE',
  'FOUR_OF_A_KIND',
  'STRAIGHT_FLUSH',
  'ROYAL_FLUSH',
]);
export type HandRank = z.infer<typeof HandRank>;

export const GameStatus = z.enum(['waiting', 'in_progress', 'completed']);
export type GameStatus = z.infer<typeof GameStatus>;

// ═══════════════════════════════════════════════════════════════════════════════
// Core Domain Objects
// ═══════════════════════════════════════════════════════════════════════════════

export const PlayerState = z.object({
  id: z.string().uuid(),
  displayName: z.string(),
  seatIndex: z.number().int().min(0),
  role: PlayerRole,
  stack: z.number().int().min(0),
  bet: z.number().int().min(0),
  potShare: z.number().int().min(0),
  folded: z.boolean(),
  holeCards: z.array(Card).length(2).nullable(),
  connected: z.boolean(),
});
export type PlayerState = z.infer<typeof PlayerState>;

export const PotBreakdown = z.object({
  amount: z.number().int().min(0),
  eligiblePlayerIds: z.array(z.string().uuid()),
});
export type PotBreakdown = z.infer<typeof PotBreakdown>;

export const GameState = z.object({
  gameId: z.string().uuid(),
  gameType: GameType,
  handNumber: z.number().int().min(0),
  stage: Stage,
  communityCards: z.array(Card).max(5),
  pot: z.number().int().min(0),
  pots: z.array(PotBreakdown),
  players: z.array(PlayerState),
  dealerSeatIndex: z.number().int().min(0),
  smallBlindAmount: z.number().int().min(1),
  bigBlindAmount: z.number().int().min(1),
  activePlayerId: z.string().uuid().nullable(),
});
export type GameState = z.infer<typeof GameState>;

// ═══════════════════════════════════════════════════════════════════════════════
// Action Schemas
// ═══════════════════════════════════════════════════════════════════════════════

export const ActionOption = z.object({
  type: ActionType,
  amount: z.number().int().min(0).optional(),
  min: z.number().int().min(0).optional(),
  max: z.number().int().min(0).optional(),
});
export type ActionOption = z.infer<typeof ActionOption>;

export const ActionRequest = z.object({
  availableActions: z.array(ActionOption),
  timeToActMs: z.number().int().min(0),
});
export type ActionRequest = z.infer<typeof ActionRequest>;

export const Action = z.object({
  type: ActionType,
  amount: z.number().int().min(0).optional(),
});
export type Action = z.infer<typeof Action>;

// ═══════════════════════════════════════════════════════════════════════════════
// Event Schemas (discriminated union on "type")
// ═══════════════════════════════════════════════════════════════════════════════

export const HandStartEvent = z.object({
  type: z.literal('HAND_START'),
  handNumber: z.number().int().min(1),
  dealerSeatIndex: z.number().int().min(0),
});
export type HandStartEvent = z.infer<typeof HandStartEvent>;

export const BlindsPostedEvent = z.object({
  type: z.literal('BLINDS_POSTED'),
  smallBlind: z.object({
    playerId: z.string().uuid(),
    amount: z.number().int().min(1),
  }),
  bigBlind: z.object({
    playerId: z.string().uuid(),
    amount: z.number().int().min(1),
  }),
});
export type BlindsPostedEvent = z.infer<typeof BlindsPostedEvent>;

export const DealEvent = z.object({
  type: z.literal('DEAL'),
});
export type DealEvent = z.infer<typeof DealEvent>;

export const FlopEvent = z.object({
  type: z.literal('FLOP'),
  cards: z.array(Card).length(3),
});
export type FlopEvent = z.infer<typeof FlopEvent>;

export const TurnEvent = z.object({
  type: z.literal('TURN'),
  card: Card,
});
export type TurnEvent = z.infer<typeof TurnEvent>;

export const RiverEvent = z.object({
  type: z.literal('RIVER'),
  card: Card,
});
export type RiverEvent = z.infer<typeof RiverEvent>;

export const PlayerActionEvent = z.object({
  type: z.literal('PLAYER_ACTION'),
  playerId: z.string().uuid(),
  action: Action,
});
export type PlayerActionEvent = z.infer<typeof PlayerActionEvent>;

export const PlayerTimeoutEvent = z.object({
  type: z.literal('PLAYER_TIMEOUT'),
  playerId: z.string().uuid(),
  defaultAction: Action,
});
export type PlayerTimeoutEvent = z.infer<typeof PlayerTimeoutEvent>;

export const ShowdownResult = z.object({
  playerId: z.string().uuid(),
  holeCards: z.array(Card).length(2),
  handRank: HandRank,
  handDescription: z.string(),
});
export type ShowdownResult = z.infer<typeof ShowdownResult>;

export const ShowdownEvent = z.object({
  type: z.literal('SHOWDOWN'),
  results: z.array(ShowdownResult),
});
export type ShowdownEvent = z.infer<typeof ShowdownEvent>;

export const Winner = z.object({
  playerId: z.string().uuid(),
  amount: z.number().int().min(0),
  potIndex: z.number().int().min(0),
});
export type Winner = z.infer<typeof Winner>;

export const HandEndEvent = z.object({
  type: z.literal('HAND_END'),
  winners: z.array(Winner),
});
export type HandEndEvent = z.infer<typeof HandEndEvent>;

export const PlayerRevealedEvent = z.object({
  type: z.literal('PLAYER_REVEALED'),
  playerId: z.string().uuid(),
  holeCards: z.array(Card).length(2),
});
export type PlayerRevealedEvent = z.infer<typeof PlayerRevealedEvent>;

export const PlayerJoinedEvent = z.object({
  type: z.literal('PLAYER_JOINED'),
  playerId: z.string().uuid(),
  displayName: z.string(),
  seatIndex: z.number().int().min(0),
  role: PlayerRole.optional(),
});
export type PlayerJoinedEvent = z.infer<typeof PlayerJoinedEvent>;

export const PlayerLeftEvent = z.object({
  type: z.literal('PLAYER_LEFT'),
  playerId: z.string().uuid(),
});
export type PlayerLeftEvent = z.infer<typeof PlayerLeftEvent>;

export const Event = z.discriminatedUnion('type', [
  HandStartEvent,
  BlindsPostedEvent,
  DealEvent,
  FlopEvent,
  TurnEvent,
  RiverEvent,
  PlayerActionEvent,
  PlayerTimeoutEvent,
  ShowdownEvent,
  HandEndEvent,
  PlayerRevealedEvent,
  PlayerJoinedEvent,
  PlayerLeftEvent,
]);
export type Event = z.infer<typeof Event>;

// ═══════════════════════════════════════════════════════════════════════════════
// Message Payloads
// ═══════════════════════════════════════════════════════════════════════════════

// -- Client -> Server payloads --

export const IdentifyPayload = z.object({
  displayName: z.string().min(1).max(32),
  reconnectToken: z.string().optional(),
});
export type IdentifyPayload = z.infer<typeof IdentifyPayload>;

export const JoinGamePayload = z.object({
  gameId: z.string().uuid(),
  role: PlayerRole.optional(),
});
export type JoinGamePayload = z.infer<typeof JoinGamePayload>;

export const PlayerActionPayload = z.object({
  handNumber: z.number().int(),
  type: ActionType,
  amount: z.number().int().min(0).optional(),
});
export type PlayerActionPayload = z.infer<typeof PlayerActionPayload>;

export const RevealCardsPayload = z.object({
  handNumber: z.number().int(),
});
export type RevealCardsPayload = z.infer<typeof RevealCardsPayload>;

export const ChatSendPayload = z.object({
  message: z.string().min(1).max(500),
});
export type ChatSendPayload = z.infer<typeof ChatSendPayload>;

// -- Server -> Client payloads --

export const GameStateUpdatePayload = z.object({
  gameState: GameState,
  event: Event,
  actionRequest: ActionRequest.optional(),
});
export type GameStateUpdatePayload = z.infer<typeof GameStateUpdatePayload>;

export const IdentifiedPayload = z.object({
  playerId: z.string().uuid(),
  reconnectToken: z.string(),
  currentGame: GameStateUpdatePayload.optional(),
});
export type IdentifiedPayload = z.infer<typeof IdentifiedPayload>;

export const GameListItem = z.object({
  gameId: z.string().uuid(),
  name: z.string(),
  gameType: GameType,
  playerCount: z.number().int().min(0),
  maxPlayers: z.number().int().min(2),
  smallBlindAmount: z.number().int().min(1),
  bigBlindAmount: z.number().int().min(1),
  status: GameStatus,
});
export type GameListItem = z.infer<typeof GameListItem>;

export const GameListPayload = z.object({
  games: z.array(GameListItem),
});
export type GameListPayload = z.infer<typeof GameListPayload>;

export const GameJoinedPayload = z.object({
  gameState: GameState,
});
export type GameJoinedPayload = z.infer<typeof GameJoinedPayload>;

export const TimeWarningPayload = z.object({
  remainingMs: z.number().int().min(0),
});
export type TimeWarningPayload = z.infer<typeof TimeWarningPayload>;

export const Standing = z.object({
  playerId: z.string().uuid(),
  displayName: z.string(),
  finalStack: z.number().int().min(0),
  rank: z.number().int().min(1),
});
export type Standing = z.infer<typeof Standing>;

export const GameOverPayload = z.object({
  gameId: z.string().uuid(),
  reason: z.enum(['completed', 'cancelled', 'insufficient_players']),
  standings: z.array(Standing),
});
export type GameOverPayload = z.infer<typeof GameOverPayload>;

export const ChatMessagePayload = z.object({
  playerId: z.string().uuid(),
  displayName: z.string(),
  message: z.string(),
  timestamp: z.string().datetime(),
});
export type ChatMessagePayload = z.infer<typeof ChatMessagePayload>;

export const ErrorPayload = z.object({
  code: ErrorCode,
  message: z.string(),
  details: z.record(z.string(), z.unknown()).optional(),
});
export type ErrorPayload = z.infer<typeof ErrorPayload>;

// ═══════════════════════════════════════════════════════════════════════════════
// Message Envelopes
// ═══════════════════════════════════════════════════════════════════════════════

// -- Client -> Server messages --

export const IdentifyMessage = z.object({
  action: z.literal('identify'),
  payload: IdentifyPayload,
});

export const ListGamesMessage = z.object({
  action: z.literal('listGames'),
  payload: z.object({}).strict(),
});

export const JoinGameMessage = z.object({
  action: z.literal('joinGame'),
  payload: JoinGamePayload,
});

export const ReadyMessage = z.object({
  action: z.literal('ready'),
  payload: z.object({}).strict(),
});

export const PlayerActionMessage = z.object({
  action: z.literal('playerAction'),
  payload: PlayerActionPayload,
});

export const RevealCardsMessage = z.object({
  action: z.literal('revealCards'),
  payload: RevealCardsPayload,
});

export const ChatMessage = z.object({
  action: z.literal('chat'),
  payload: ChatSendPayload,
});

export const LeaveGameMessage = z.object({
  action: z.literal('leaveGame'),
  payload: z.object({}).strict(),
});

/** Discriminated union of all client-to-server messages */
export const ClientMessage = z.discriminatedUnion('action', [
  IdentifyMessage,
  ListGamesMessage,
  JoinGameMessage,
  ReadyMessage,
  PlayerActionMessage,
  RevealCardsMessage,
  ChatMessage,
  LeaveGameMessage,
]);
export type ClientMessage = z.infer<typeof ClientMessage>;

// -- Server -> Client messages --

export const IdentifiedServerMessage = z.object({
  action: z.literal('identified'),
  payload: IdentifiedPayload,
});

export const GameListServerMessage = z.object({
  action: z.literal('gameList'),
  payload: GameListPayload,
});

export const GameJoinedServerMessage = z.object({
  action: z.literal('gameJoined'),
  payload: GameJoinedPayload,
});

export const GameStateServerMessage = z.object({
  action: z.literal('gameState'),
  payload: GameStateUpdatePayload,
});

export const TimeWarningServerMessage = z.object({
  action: z.literal('timeWarning'),
  payload: TimeWarningPayload,
});

export const GameOverServerMessage = z.object({
  action: z.literal('gameOver'),
  payload: GameOverPayload,
});

export const ChatBroadcastServerMessage = z.object({
  action: z.literal('chatMessage'),
  payload: ChatMessagePayload,
});

export const ErrorServerMessage = z.object({
  action: z.literal('error'),
  payload: ErrorPayload,
});

/** Union of all server-to-client messages */
export const ServerMessage = z.discriminatedUnion('action', [
  IdentifiedServerMessage,
  GameListServerMessage,
  GameJoinedServerMessage,
  GameStateServerMessage,
  TimeWarningServerMessage,
  GameOverServerMessage,
  ChatBroadcastServerMessage,
  ErrorServerMessage,
]);
export type ServerMessage = z.infer<typeof ServerMessage>;
