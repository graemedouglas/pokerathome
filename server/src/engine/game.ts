/**
 * Core game state machine. Pure functions — no I/O, no side effects.
 *
 * Takes engine state + action → returns new engine state + events emitted.
 * The GameManager calls these and handles broadcasting.
 */

import type {
  Event,
  GameState,
  PotBreakdown,
  ActionRequest,
  GameStateUpdatePayload,
  Winner,
} from '@pokerathome/schema';
import { createDeck, shuffle, deal } from './deck.js';
import { evaluateShowdown } from './hand-evaluator.js';
import { calculatePots, distributePots } from './pot.js';
import { getAvailableActions } from './action-validator.js';

// ═══════════════════════════════════════════════════════════════════════════════
// Engine-internal types
// ═══════════════════════════════════════════════════════════════════════════════

export interface EnginePlayer {
  id: string;
  displayName: string;
  seatIndex: number;
  role: 'player' | 'spectator';
  stack: number;
  bet: number;
  potShare: number;
  folded: boolean;
  holeCards: [string, string] | null;
  connected: boolean;
  isAllIn: boolean;
  isReady: boolean;
}

export interface EngineState {
  gameId: string;
  gameName: string;
  gameType: 'cash' | 'tournament';
  handNumber: number;
  stage: 'PRE_FLOP' | 'FLOP' | 'TURN' | 'RIVER' | 'SHOWDOWN';
  communityCards: string[];
  pot: number;
  pots: PotBreakdown[];
  players: EnginePlayer[];
  dealerSeatIndex: number;
  smallBlindAmount: number;
  bigBlindAmount: number;
  activePlayerId: string | null;

  // Engine-internal (not sent to clients)
  deck: string[];
  currentBet: number;
  lastRaiseSize: number;
  actedThisRound: string[];
  handEvents: Event[];
  handInProgress: boolean;
  maxPlayers: number;
  startingStack: number;
}

export interface Transition {
  state: EngineState;
  event: Event;
}

// ═══════════════════════════════════════════════════════════════════════════════
// State creation
// ═══════════════════════════════════════════════════════════════════════════════

export interface GameConfig {
  gameId: string;
  gameName: string;
  gameType: 'cash' | 'tournament';
  smallBlindAmount: number;
  bigBlindAmount: number;
  maxPlayers: number;
  startingStack: number;
}

export function createInitialState(config: GameConfig): EngineState {
  return {
    gameId: config.gameId,
    gameName: config.gameName,
    gameType: config.gameType,
    handNumber: 0,
    stage: 'PRE_FLOP',
    communityCards: [],
    pot: 0,
    pots: [],
    players: [],
    dealerSeatIndex: 0,
    smallBlindAmount: config.smallBlindAmount,
    bigBlindAmount: config.bigBlindAmount,
    activePlayerId: null,
    deck: [],
    currentBet: 0,
    lastRaiseSize: config.bigBlindAmount,
    actedThisRound: [],
    handEvents: [],
    handInProgress: false,
    maxPlayers: config.maxPlayers,
    startingStack: config.startingStack,
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// Player management
// ═══════════════════════════════════════════════════════════════════════════════

export function addPlayer(
  state: EngineState,
  playerId: string,
  displayName: string,
  role: 'player' | 'spectator' = 'player'
): { state: EngineState; seatIndex: number; event: Event } {
  const occupiedSeats = new Set(state.players.map((p) => p.seatIndex));
  let seatIndex = -1;
  for (let i = 0; i < state.maxPlayers; i++) {
    if (!occupiedSeats.has(i)) {
      seatIndex = i;
      break;
    }
  }
  if (seatIndex === -1) throw new Error('No seats available');

  const player: EnginePlayer = {
    id: playerId,
    displayName,
    seatIndex,
    role,
    stack: state.startingStack,
    bet: 0,
    potShare: 0,
    folded: false,
    holeCards: null,
    connected: true,
    isAllIn: false,
    isReady: false,
  };

  const event: Event = {
    type: 'PLAYER_JOINED',
    playerId,
    displayName,
    seatIndex,
  };

  return {
    state: { ...state, players: [...state.players, player] },
    seatIndex,
    event,
  };
}

export function removePlayer(state: EngineState, playerId: string): { state: EngineState; event: Event } {
  const event: Event = { type: 'PLAYER_LEFT', playerId };
  return {
    state: {
      ...state,
      players: state.players.filter((p) => p.id !== playerId),
    },
    event,
  };
}

export function setPlayerReady(state: EngineState, playerId: string): EngineState {
  return {
    ...state,
    players: state.players.map((p) => (p.id === playerId ? { ...p, isReady: true } : p)),
  };
}

export function setPlayerConnected(state: EngineState, playerId: string, connected: boolean): EngineState {
  return {
    ...state,
    players: state.players.map((p) => (p.id === playerId ? { ...p, connected } : p)),
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// Hand lifecycle
// ═══════════════════════════════════════════════════════════════════════════════

/** Start a new hand. Returns a sequence of transitions (HAND_START, BLINDS_POSTED, DEAL). */
export function startHand(inputState: EngineState, deckOverride?: string[]): Transition[] {
  const transitions: Transition[] = [];
  let state = { ...inputState };

  const activePlayers = state.players.filter((p) => p.role === 'player' && p.stack > 0);
  if (activePlayers.length < 2) {
    throw new Error('Not enough players to start a hand');
  }

  // Advance dealer button
  const prevDealer = state.dealerSeatIndex;
  const nextDealer = findNextPlayer(state.players, prevDealer, (p) => p.role === 'player' && p.stack > 0);
  if (!nextDealer) throw new Error('Cannot find next dealer');

  // Reset hand state
  state = {
    ...state,
    handNumber: state.handNumber + 1,
    stage: 'PRE_FLOP',
    communityCards: [],
    pot: 0,
    pots: [],
    dealerSeatIndex: nextDealer.seatIndex,
    activePlayerId: null,
    deck: deckOverride ?? shuffle(createDeck()),
    currentBet: 0,
    lastRaiseSize: state.bigBlindAmount,
    actedThisRound: [],
    handEvents: [],
    handInProgress: true,
    players: state.players.map((p) => ({
      ...p,
      bet: 0,
      potShare: 0,
      folded: p.role !== 'player' || p.stack <= 0,
      holeCards: null,
      isAllIn: false,
    })),
  };

  // HAND_START event
  const handStartEvent: Event = {
    type: 'HAND_START',
    handNumber: state.handNumber,
    dealerSeatIndex: state.dealerSeatIndex,
  };
  state.handEvents.push(handStartEvent);
  transitions.push({ state: cloneState(state), event: handStartEvent });

  // Post blinds
  state = postBlinds(state);
  const blindsEvent = state.handEvents[state.handEvents.length - 1];
  transitions.push({ state: cloneState(state), event: blindsEvent });

  // Deal hole cards
  state = dealHoleCards(state);
  const dealEvent: Event = { type: 'DEAL' };
  state.handEvents.push(dealEvent);

  // Set first to act (UTG pre-flop, or dealer in heads-up)
  const firstToAct = getFirstToActPreFlop(state);
  state.activePlayerId = firstToAct?.id ?? null;

  // Recalculate pots
  const { pot, pots } = calculatePots(state.players);
  state.pot = pot;
  state.pots = pots;

  transitions.push({ state: cloneState(state), event: dealEvent });

  return transitions;
}

function postBlinds(state: EngineState): EngineState {
  const isHeadsUp = state.players.filter((p) => !p.folded).length === 2;

  let sbPlayer: EnginePlayer;
  let bbPlayer: EnginePlayer;

  if (isHeadsUp) {
    // Heads-up: dealer posts SB
    sbPlayer = state.players.find((p) => p.seatIndex === state.dealerSeatIndex && !p.folded)!;
    bbPlayer = findNextPlayer(state.players, state.dealerSeatIndex, (p) => !p.folded)!;
  } else {
    // Normal: SB is left of dealer, BB is left of SB
    sbPlayer = findNextPlayer(state.players, state.dealerSeatIndex, (p) => !p.folded)!;
    bbPlayer = findNextPlayer(state.players, sbPlayer.seatIndex, (p) => !p.folded)!;
  }

  const sbAmount = Math.min(state.smallBlindAmount, sbPlayer.stack);
  const bbAmount = Math.min(state.bigBlindAmount, bbPlayer.stack);

  state = applyBet(state, sbPlayer.id, sbAmount);
  state = applyBet(state, bbPlayer.id, bbAmount);
  state.currentBet = bbAmount;
  state.lastRaiseSize = bbAmount;

  // Mark all-in if blind consumed entire stack
  state = {
    ...state,
    players: state.players.map((p) => {
      if (p.id === sbPlayer.id && p.stack === 0) return { ...p, isAllIn: true };
      if (p.id === bbPlayer.id && p.stack === 0) return { ...p, isAllIn: true };
      return p;
    }),
  };

  const blindsEvent: Event = {
    type: 'BLINDS_POSTED',
    smallBlind: { playerId: sbPlayer.id, amount: sbAmount },
    bigBlind: { playerId: bbPlayer.id, amount: bbAmount },
  };
  state.handEvents.push(blindsEvent);

  return state;
}

function dealHoleCards(state: EngineState): EngineState {
  let deck = [...state.deck];
  const players = state.players.map((p) => {
    if (p.folded || p.role !== 'player') return p;
    const { cards, remaining } = deal(deck, 2);
    deck = remaining;
    return { ...p, holeCards: cards as [string, string] };
  });
  return { ...state, deck, players };
}

// ═══════════════════════════════════════════════════════════════════════════════
// Action processing
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Process a player action. Returns transitions that occurred.
 * May include PLAYER_ACTION, stage transitions (FLOP/TURN/RIVER), SHOWDOWN, HAND_END.
 */
export function processAction(
  inputState: EngineState,
  playerId: string,
  actionType: string,
  actionAmount?: number
): Transition[] {
  const transitions: Transition[] = [];
  let state = { ...inputState, players: inputState.players.map((p) => ({ ...p })) };

  const player = state.players.find((p) => p.id === playerId)!;

  // Pre-compute values from current state before applyBet creates new objects
  switch (actionType) {
    case 'FOLD': {
      state = {
        ...state,
        players: state.players.map((p) => (p.id === playerId ? { ...p, folded: true } : p)),
      };
      break;
    }
    case 'CHECK': {
      // No chip movement
      break;
    }
    case 'CALL': {
      const callAmount = Math.min(state.currentBet - player.bet, player.stack);
      const willBeAllIn = callAmount >= player.stack;
      state = applyBet(state, playerId, callAmount);
      if (willBeAllIn) state = markAllIn(state, playerId);
      break;
    }
    case 'BET': {
      const betAmount = actionAmount!;
      const newBet = player.bet + betAmount;
      const willBeAllIn = betAmount >= player.stack;
      state = applyBet(state, playerId, betAmount);
      state.lastRaiseSize = betAmount;
      state.currentBet = newBet;
      state.actedThisRound = []; // Reset — everyone else must respond
      if (willBeAllIn) state = markAllIn(state, playerId);
      break;
    }
    case 'RAISE': {
      const raiseAmount = actionAmount!;
      const newBet = player.bet + raiseAmount;
      const raiseIncrement = newBet - state.currentBet;
      const willBeAllIn = raiseAmount >= player.stack;
      state = applyBet(state, playerId, raiseAmount);
      state.lastRaiseSize = Math.max(raiseIncrement, state.lastRaiseSize);
      state.currentBet = newBet;
      state.actedThisRound = []; // Reset — everyone else must respond
      if (willBeAllIn) state = markAllIn(state, playerId);
      break;
    }
    case 'ALL_IN': {
      const allInAmount = player.stack;
      const newBet = player.bet + allInAmount;
      const isRaise = newBet > state.currentBet;
      state = applyBet(state, playerId, allInAmount);
      if (isRaise) {
        const raiseIncrement = newBet - state.currentBet;
        state.lastRaiseSize = Math.max(raiseIncrement, state.lastRaiseSize);
        state.currentBet = newBet;
        state.actedThisRound = []; // Reset — everyone else must respond
      }
      state = markAllIn(state, playerId);
      break;
    }
  }

  // Track who has acted
  if (!state.actedThisRound.includes(playerId)) {
    state.actedThisRound.push(playerId);
  }

  // Recalculate pots
  const { pot, pots } = calculatePots(state.players);
  state.pot = pot;
  state.pots = pots;

  // Emit PLAYER_ACTION event
  const actionEvent: Event = {
    type: 'PLAYER_ACTION',
    playerId,
    action: {
      type: actionType as 'FOLD' | 'CHECK' | 'CALL' | 'BET' | 'RAISE' | 'ALL_IN',
      ...(actionAmount !== undefined ? { amount: actionAmount } : {}),
    },
  };
  state.handEvents.push(actionEvent);

  // Check if hand is over (everyone folded except one)
  const nonFolded = state.players.filter((p) => !p.folded && p.role === 'player');
  if (nonFolded.length === 1) {
    // Everyone else folded — award pot to last player
    state.activePlayerId = null;
    transitions.push({ state: cloneState(state), event: actionEvent });

    const handEndTransitions = resolveHandEnd(state, nonFolded);
    transitions.push(...handEndTransitions);
    return transitions;
  }

  // Determine next active player
  const nextPlayer = getNextActivePlayer(state, player.seatIndex);
  const roundComplete = isBettingRoundComplete(state);

  if (roundComplete) {
    state.activePlayerId = null;
    transitions.push({ state: cloneState(state), event: actionEvent });

    // Advance stage
    const stageTransitions = advanceStage(state);
    transitions.push(...stageTransitions);
  } else {
    state.activePlayerId = nextPlayer?.id ?? null;
    transitions.push({ state: cloneState(state), event: actionEvent });
  }

  return transitions;
}

// ═══════════════════════════════════════════════════════════════════════════════
// Stage advancement
// ═══════════════════════════════════════════════════════════════════════════════

function advanceStage(inputState: EngineState): Transition[] {
  const transitions: Transition[] = [];
  let state = sweepBets(inputState);

  // Check if all action is complete (0 or 1 players can still bet)
  const canBet = state.players.filter((p) => !p.folded && !p.isAllIn && p.role === 'player');
  const nonFolded = state.players.filter((p) => !p.folded && p.role === 'player');
  const skipBetting = canBet.length <= 1;

  const stageOrder: Array<'PRE_FLOP' | 'FLOP' | 'TURN' | 'RIVER' | 'SHOWDOWN'> = [
    'PRE_FLOP', 'FLOP', 'TURN', 'RIVER', 'SHOWDOWN',
  ];
  const currentIdx = stageOrder.indexOf(state.stage);

  // Deal remaining community cards and advance through stages
  let nextStageIdx = currentIdx + 1;

  while (nextStageIdx < stageOrder.length) {
    const nextStage = stageOrder[nextStageIdx];

    if (nextStage === 'FLOP') {
      const { cards, remaining } = deal(state.deck, 3);
      state = {
        ...state,
        stage: 'FLOP',
        communityCards: [...state.communityCards, ...cards],
        deck: remaining,
      };
      const event: Event = { type: 'FLOP', cards: cards as [string, string, string] };
      state.handEvents.push(event);
      const { pot, pots } = calculatePots(state.players);
      state.pot = pot;
      state.pots = pots;

      if (!skipBetting) {
        const firstActor = getFirstToActPostFlop(state);
        state.activePlayerId = firstActor?.id ?? null;
        transitions.push({ state: cloneState(state), event });
        return transitions; // Pause for betting
      }
      transitions.push({ state: cloneState(state), event });
    } else if (nextStage === 'TURN') {
      const { cards, remaining } = deal(state.deck, 1);
      state = {
        ...state,
        stage: 'TURN',
        communityCards: [...state.communityCards, ...cards],
        deck: remaining,
      };
      const event: Event = { type: 'TURN', card: cards[0] };
      state.handEvents.push(event);
      const { pot, pots } = calculatePots(state.players);
      state.pot = pot;
      state.pots = pots;

      if (!skipBetting) {
        const firstActor = getFirstToActPostFlop(state);
        state.activePlayerId = firstActor?.id ?? null;
        transitions.push({ state: cloneState(state), event });
        return transitions;
      }
      transitions.push({ state: cloneState(state), event });
    } else if (nextStage === 'RIVER') {
      const { cards, remaining } = deal(state.deck, 1);
      state = {
        ...state,
        stage: 'RIVER',
        communityCards: [...state.communityCards, ...cards],
        deck: remaining,
      };
      const event: Event = { type: 'RIVER', card: cards[0] };
      state.handEvents.push(event);
      const { pot, pots } = calculatePots(state.players);
      state.pot = pot;
      state.pots = pots;

      if (!skipBetting) {
        const firstActor = getFirstToActPostFlop(state);
        state.activePlayerId = firstActor?.id ?? null;
        transitions.push({ state: cloneState(state), event });
        return transitions;
      }
      transitions.push({ state: cloneState(state), event });
    } else if (nextStage === 'SHOWDOWN') {
      state.stage = 'SHOWDOWN';
      const showdownTransitions = resolveShowdown(state);
      transitions.push(...showdownTransitions);
      return transitions;
    }

    nextStageIdx++;
  }

  return transitions;
}

function resolveShowdown(state: EngineState): Transition[] {
  const transitions: Transition[] = [];
  const nonFolded = state.players.filter((p) => !p.folded && p.role === 'player');

  const { results, evaluatedHands } = evaluateShowdown(
    nonFolded.map((p) => ({ id: p.id, holeCards: p.holeCards, folded: false })),
    state.communityCards
  );

  const showdownEvent: Event = { type: 'SHOWDOWN', results };
  state.handEvents.push(showdownEvent);

  // Recalculate pots for distribution
  const { pots } = calculatePots(state.players);
  const winners = distributePots(pots, evaluatedHands);

  state.activePlayerId = null;
  transitions.push({ state: cloneState(state), event: showdownEvent });

  // HAND_END
  const handEndEvent: Event = { type: 'HAND_END', winners };
  state.handEvents.push(handEndEvent);

  // Apply winnings to stacks
  for (const w of winners) {
    const player = state.players.find((p) => p.id === w.playerId);
    if (player) player.stack += w.amount;
  }

  state.handInProgress = false;
  transitions.push({ state: cloneState(state), event: handEndEvent });

  return transitions;
}

/** When all but one player folds, award pot without showdown. */
function resolveHandEnd(state: EngineState, nonFolded: EnginePlayer[]): Transition[] {
  const transitions: Transition[] = [];
  const winner = nonFolded[0];

  const { pot, pots } = calculatePots(state.players);
  state.pot = pot;
  state.pots = pots;

  const winners: Winner[] = pots.map((p, i) => ({
    playerId: winner.id,
    amount: p.amount,
    potIndex: i,
  }));

  const handEndEvent: Event = { type: 'HAND_END', winners };
  state.handEvents.push(handEndEvent);

  // Apply winnings
  const totalWon = winners.reduce((sum, w) => sum + w.amount, 0);
  const winnerPlayer = state.players.find((p) => p.id === winner.id);
  if (winnerPlayer) winnerPlayer.stack += totalWon;

  state.handInProgress = false;
  state.activePlayerId = null;
  transitions.push({ state: cloneState(state), event: handEndEvent });

  return transitions;
}

// ═══════════════════════════════════════════════════════════════════════════════
// Betting round helpers
// ═══════════════════════════════════════════════════════════════════════════════

function sweepBets(state: EngineState): EngineState {
  return {
    ...state,
    currentBet: 0,
    lastRaiseSize: state.bigBlindAmount,
    actedThisRound: [],
    players: state.players.map((p) => ({ ...p, bet: 0 })),
  };
}

function applyBet(state: EngineState, playerId: string, amount: number): EngineState {
  return {
    ...state,
    players: state.players.map((p) => {
      if (p.id !== playerId) return p;
      const actualAmount = Math.min(amount, p.stack);
      return {
        ...p,
        stack: p.stack - actualAmount,
        bet: p.bet + actualAmount,
        potShare: p.potShare + actualAmount,
      };
    }),
  };
}

function markAllIn(state: EngineState, playerId: string): EngineState {
  return {
    ...state,
    players: state.players.map((p) => (p.id === playerId ? { ...p, isAllIn: true } : p)),
  };
}

function isBettingRoundComplete(state: EngineState): boolean {
  const activeBettors = state.players.filter(
    (p) => !p.folded && !p.isAllIn && p.role === 'player'
  );

  // If 0 or 1 players can bet, round is over
  if (activeBettors.length <= 1) return true;

  // All active bettors must have acted and bets must be equalized
  const allActed = activeBettors.every((p) => state.actedThisRound.includes(p.id));
  const betsEqual = activeBettors.every((p) => p.bet === state.currentBet);

  return allActed && betsEqual;
}

function getNextActivePlayer(state: EngineState, afterSeatIndex: number): EnginePlayer | null {
  return findNextPlayer(
    state.players,
    afterSeatIndex,
    (p) => !p.folded && !p.isAllIn && p.role === 'player'
  );
}

function getFirstToActPreFlop(state: EngineState): EnginePlayer | null {
  const activePlayers = state.players.filter((p) => !p.folded && p.role === 'player');
  const isHeadsUp = activePlayers.length === 2;

  if (isHeadsUp) {
    // Heads-up: dealer/SB acts first pre-flop
    return state.players.find((p) => p.seatIndex === state.dealerSeatIndex && !p.folded) ?? null;
  }

  // Multi-way: UTG = player after BB. BB is 2 seats after dealer.
  const sb = findNextPlayer(state.players, state.dealerSeatIndex, (p) => !p.folded && p.role === 'player');
  if (!sb) return null;
  const bb = findNextPlayer(state.players, sb.seatIndex, (p) => !p.folded && p.role === 'player');
  if (!bb) return null;
  // UTG = next active player after BB
  return findNextPlayer(state.players, bb.seatIndex, (p) => !p.folded && !p.isAllIn && p.role === 'player');
}

function getFirstToActPostFlop(state: EngineState): EnginePlayer | null {
  // First active (non-folded, non-all-in) player after the dealer
  return findNextPlayer(
    state.players,
    state.dealerSeatIndex,
    (p) => !p.folded && !p.isAllIn && p.role === 'player'
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// State projection (engine → client-facing)
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Convert engine state to a client-facing GameState for a specific viewer.
 * Hides opponent hole cards and strips engine-internal fields.
 */
export function toClientGameState(state: EngineState, viewerPlayerId: string): GameState {
  const viewer = state.players.find((p) => p.id === viewerPlayerId);
  const isSpectator = viewer?.role === 'spectator';

  return {
    gameId: state.gameId,
    gameType: state.gameType,
    handNumber: state.handNumber,
    stage: state.stage,
    communityCards: state.communityCards,
    pot: state.pot,
    pots: state.pots,
    players: state.players.map((p) => ({
      id: p.id,
      displayName: p.displayName,
      seatIndex: p.seatIndex,
      role: p.role,
      stack: p.stack,
      bet: p.bet,
      potShare: p.potShare,
      folded: p.folded,
      holeCards:
        isSpectator || p.id === viewerPlayerId
          ? p.holeCards
          : null,
      connected: p.connected,
    })),
    dealerSeatIndex: state.dealerSeatIndex,
    smallBlindAmount: state.smallBlindAmount,
    bigBlindAmount: state.bigBlindAmount,
    activePlayerId: state.activePlayerId,
  };
}

/** Build a full gameState update payload for a specific viewer. */
export function buildGameStatePayload(
  state: EngineState,
  event: Event,
  viewerPlayerId: string,
  timeToActMs?: number
): GameStateUpdatePayload {
  const gameState = toClientGameState(state, viewerPlayerId);

  let actionRequest: ActionRequest | undefined;
  if (state.activePlayerId === viewerPlayerId && timeToActMs) {
    const availableActions = getAvailableActions(state, viewerPlayerId);
    actionRequest = { availableActions, timeToActMs };
  }

  return { gameState, event, actionRequest };
}

// ═══════════════════════════════════════════════════════════════════════════════
// Utilities
// ═══════════════════════════════════════════════════════════════════════════════

function findNextPlayer(
  players: EnginePlayer[],
  afterSeatIndex: number,
  predicate: (p: EnginePlayer) => boolean
): EnginePlayer | null {
  const sorted = [...players].sort((a, b) => a.seatIndex - b.seatIndex);
  // Players clockwise from afterSeatIndex
  const after = sorted.filter((p) => p.seatIndex > afterSeatIndex && predicate(p));
  const before = sorted.filter((p) => p.seatIndex <= afterSeatIndex && predicate(p));
  const candidates = [...after, ...before];
  return candidates[0] ?? null;
}

function cloneState(state: EngineState): EngineState {
  return {
    ...state,
    communityCards: [...state.communityCards],
    pots: state.pots.map((p) => ({ ...p, eligiblePlayerIds: [...p.eligiblePlayerIds] })),
    players: state.players.map((p) => ({ ...p, holeCards: p.holeCards ? [...p.holeCards] as [string, string] : null })),
    deck: [...state.deck],
    actedThisRound: [...state.actedThisRound],
    handEvents: [...state.handEvents],
  };
}
