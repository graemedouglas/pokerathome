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
  BlindLevel,
  TournamentState,
} from '@pokerathome/schema';
import { createDeck, shuffle, deal } from './deck.js';
import { evaluateShowdown } from './hand-evaluator.js';
import { calculatePots, distributePots } from './pot.js';
import { getAvailableActions } from './action-validator.js';
import { calculateHandProbabilities, calculateWinEquity } from './hand-probability.js';
import { config } from '../config.js';

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
  sittingOut: boolean;
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

  // Tournament fields
  blindSchedule: BlindLevel[];
  currentBlindLevel: number;
  antesEnabled: boolean;
  tournamentStartedAt: number | null;
  totalPlayers: number;
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
  blindSchedule?: BlindLevel[];
  antesEnabled?: boolean;
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
    blindSchedule: config.blindSchedule ?? [],
    currentBlindLevel: 0,
    antesEnabled: config.antesEnabled ?? false,
    tournamentStartedAt: null,
    totalPlayers: 0,
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
  let seatIndex: number;

  if (role === 'spectator') {
    // Spectators get seats starting from maxPlayers onward (never collide with playing seats)
    const spectatorSeats = state.players
      .filter((p) => p.role === 'spectator')
      .map((p) => p.seatIndex);
    seatIndex = state.maxPlayers;
    while (spectatorSeats.includes(seatIndex)) seatIndex++;
  } else {
    const occupiedSeats = new Set(state.players.map((p) => p.seatIndex));
    seatIndex = -1;
    for (let i = 0; i < state.maxPlayers; i++) {
      if (!occupiedSeats.has(i)) {
        seatIndex = i;
        break;
      }
    }
    if (seatIndex === -1) throw new Error('No seats available');
  }

  const player: EnginePlayer = {
    id: playerId,
    displayName,
    seatIndex,
    role,
    stack: role === 'spectator' ? 0 : state.startingStack,
    bet: 0,
    potShare: 0,
    folded: false,
    holeCards: null,
    connected: true,
    isAllIn: false,
    isReady: role === 'spectator',
    sittingOut: false,
  };

  const event: Event = {
    type: 'PLAYER_JOINED',
    playerId,
    displayName,
    seatIndex,
    role,
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

export function setPlayerUnready(state: EngineState, playerId: string): EngineState {
  return {
    ...state,
    players: state.players.map((p) => (p.id === playerId ? { ...p, isReady: false } : p)),
  };
}

export function setPlayerConnected(state: EngineState, playerId: string, connected: boolean): EngineState {
  return {
    ...state,
    players: state.players.map((p) => (p.id === playerId ? { ...p, connected } : p)),
  };
}

export function setPlayerSittingOut(state: EngineState, playerId: string, sittingOut: boolean): EngineState {
  return {
    ...state,
    players: state.players.map((p) => (p.id === playerId ? { ...p, sittingOut } : p)),
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// Tournament blind level management
// ═══════════════════════════════════════════════════════════════════════════════

/** Advance to the next blind level. Returns a transition with the BLIND_LEVEL_UP event. */
export function advanceBlindLevel(inputState: EngineState): Transition {
  const schedule = inputState.blindSchedule;

  // Guard: empty schedule — return current state unchanged
  if (schedule.length === 0) {
    const fallbackLevel: BlindLevel = {
      level: 1,
      smallBlind: inputState.smallBlindAmount,
      bigBlind: inputState.bigBlindAmount,
      ante: 0,
      minChipDenom: 25,
    };
    return { state: inputState, event: { type: 'BLIND_LEVEL_UP', level: fallbackLevel } };
  }

  const nextIdx = inputState.currentBlindLevel + 1;

  // Clamp to last level (schedule is uncapped so this is a safety guard)
  const levelIdx = Math.min(nextIdx, schedule.length - 1);
  const level = schedule[levelIdx];

  const state: EngineState = {
    ...inputState,
    currentBlindLevel: levelIdx,
    smallBlindAmount: level.smallBlind,
    bigBlindAmount: level.bigBlind,
  };

  const event: Event = {
    type: 'BLIND_LEVEL_UP',
    level,
  };

  return { state, event };
}

// ═══════════════════════════════════════════════════════════════════════════════
// Hand lifecycle
// ═══════════════════════════════════════════════════════════════════════════════

/** Start a new hand. Returns a sequence of transitions (HAND_START, BLINDS_POSTED, DEAL). */
export function startHand(inputState: EngineState, deckOverride?: string[]): Transition[] {
  const transitions: Transition[] = [];
  let state = { ...inputState };

  const isTournament = state.gameType === 'tournament';

  // Sitting-out players are excluded from the hand entirely in both modes.
  // If a player sits out mid-hand, they auto-check/fold for that hand only.
  const activePlayers = state.players.filter((p) =>
    p.role === 'player' && p.stack > 0 && !p.sittingOut
  );
  if (activePlayers.length < 2) {
    throw new Error('Not enough players to start a hand');
  }

  // Advance dealer button (skip sitting-out players)
  const prevDealer = state.dealerSeatIndex;
  const nextDealer = findNextPlayer(state.players, prevDealer, (p) =>
    p.role === 'player' && p.stack > 0 && !p.sittingOut
  );
  if (!nextDealer) throw new Error('Cannot find next dealer');

  // Reset hand state — sitting-out players are folded (excluded) in both modes
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
      folded: p.role !== 'player' || p.stack <= 0 || p.sittingOut,
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

  // Post antes (if applicable) then blinds
  const anteInfo = postAntes(state);
  state = anteInfo.state;
  state = postBlinds(state, anteInfo.antes);
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

/** Post antes from all active players. Returns updated state and ante records. */
function postAntes(state: EngineState): { state: EngineState; antes: Array<{ playerId: string; amount: number }> } {
  const antes: Array<{ playerId: string; amount: number }> = [];

  // Get ante amount from current blind level
  const schedule = state.blindSchedule;
  const levelIdx = state.currentBlindLevel;
  const anteAmount = schedule.length > 0 && levelIdx < schedule.length
    ? schedule[levelIdx].ante
    : 0;

  if (!state.antesEnabled || anteAmount <= 0) {
    return { state, antes };
  }

  // Deduct ante from each non-folded player
  for (const p of state.players) {
    if (p.folded || p.role !== 'player') continue;
    const actual = Math.min(anteAmount, p.stack);
    if (actual <= 0) continue;
    state = applyBet(state, p.id, actual);
    antes.push({ playerId: p.id, amount: actual });
    // Mark all-in if ante consumed entire stack
    if (state.players.find((pl) => pl.id === p.id)!.stack === 0) {
      state = markAllIn(state, p.id);
    }
  }

  return { state, antes };
}

function postBlinds(state: EngineState, antes?: Array<{ playerId: string; amount: number }>): EngineState {
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
    ...(antes && antes.length > 0 ? { antes } : {}),
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
      actionAmount = callAmount; // Include in PLAYER_ACTION event
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
      actionAmount = allInAmount; // Include in PLAYER_ACTION event
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

  // If nobody can bet, round is over (everyone is folded or all-in)
  if (activeBettors.length === 0) return true;

  // All active bettors must have acted and bets must be equalized.
  // This correctly handles the case where someone goes all-in and the
  // remaining player(s) still need to respond (call/fold/raise).
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
 * Determines which cards should be visible to a viewer based on their role and config.
 */
function determineVisibleCards(
  player: EnginePlayer,
  viewerPlayerId: string,
  isSpectator: boolean,
  state: EngineState,
  spectatorVisibility?: string
): [string, string] | null {
  // Players always see their own cards
  if (player.id === viewerPlayerId) {
    return player.holeCards;
  }

  // Non-spectators see cards at showdown or when revealed
  if (!isSpectator) {
    return state.stage === 'SHOWDOWN' ? player.holeCards : null;
  }

  // Spectator visibility based on per-game setting or global config fallback
  const mode = spectatorVisibility ?? config.SPECTATOR_CARD_VISIBILITY;

  switch (mode) {
    case 'immediate':
      return player.holeCards;

    case 'showdown':
      return state.stage === 'SHOWDOWN' || !state.handInProgress
        ? player.holeCards
        : null;

    case 'delayed':
      // When GameManager has a previousHandState, it passes that as `state` so
      // player.holeCards are from the completed previous hand (all visible).
      // On the first hand (previousHandState === null), GameManager falls back to
      // active.state — so we must hide cards during play just like showdown mode.
      return state.stage === 'SHOWDOWN' || !state.handInProgress
        ? player.holeCards
        : null;

    default:
      return null;
  }
}

/**
 * Build the TournamentState object from engine state.
 * Note: nextBlindChangeAt and isPaused are managed by GameManager and injected
 * via tournamentOverrides when calling toClientGameState.
 */
function buildTournamentState(state: EngineState, overrides?: TournamentOverrides): TournamentState {
  const playersInGame = state.players.filter((p) => p.role === 'player');
  const playersRemaining = playersInGame.filter((p) => p.stack > 0).length;
  const totalStacks = playersInGame.reduce((sum, p) => sum + p.stack, 0);
  const averageStack = playersRemaining > 0 ? Math.round(totalStacks / playersRemaining) : 0;
  const currentLevel = state.blindSchedule[state.currentBlindLevel];

  return {
    blindSchedule: state.blindSchedule,
    currentBlindLevel: state.currentBlindLevel,
    nextBlindChangeAt: overrides?.nextBlindChangeAt ?? null,
    roundLengthMs: overrides?.roundLengthMs ?? 0,
    isPaused: overrides?.isPaused ?? false,
    minChipDenom: currentLevel?.minChipDenom ?? 25,
    averageStack,
    playersRemaining,
    totalPlayers: state.totalPlayers,
    startedAt: state.tournamentStartedAt ?? 0,
  };
}

export interface TournamentOverrides {
  nextBlindChangeAt: number | null;
  roundLengthMs: number;
  isPaused: boolean;
}

/**
 * Convert engine state to a client-facing GameState for a specific viewer.
 * Hides opponent hole cards and strips engine-internal fields.
 */
export function toClientGameState(
  state: EngineState,
  viewerPlayerId: string,
  spectatorVisibility?: string,
  tournamentOverrides?: TournamentOverrides
): GameState {
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
      holeCards: determineVisibleCards(p, viewerPlayerId, isSpectator, state, spectatorVisibility),
      connected: p.connected,
      sittingOut: p.sittingOut,
    })),
    dealerSeatIndex: state.dealerSeatIndex,
    smallBlindAmount: state.smallBlindAmount,
    bigBlindAmount: state.bigBlindAmount,
    activePlayerId: state.activePlayerId,
    ...(state.gameType === 'tournament'
      ? { tournament: buildTournamentState(state, tournamentOverrides) }
      : {}),
  };
}

/** Build a full gameState update payload for a specific viewer. */
export function buildGameStatePayload(
  state: EngineState,
  event: Event,
  viewerPlayerId: string,
  timeToActMs?: number,
  spectatorVisibility?: string,
  tournamentOverrides?: TournamentOverrides,
  includeHandProbabilities?: boolean
): GameStateUpdatePayload {
  const gameState = toClientGameState(state, viewerPlayerId, spectatorVisibility, tournamentOverrides);

  let actionRequest: ActionRequest | undefined;
  if (state.activePlayerId === viewerPlayerId && timeToActMs) {
    const availableActions = getAvailableActions(state, viewerPlayerId);
    actionRequest = { availableActions, timeToActMs };
  }

  let handProbabilities: Record<string, number> | undefined;
  let handWinEquity: Record<string, number> | undefined;
  if (includeHandProbabilities) {
    const viewer = state.players.find((p) => p.id === viewerPlayerId);
    if (viewer?.holeCards && viewer.role === 'player' && !viewer.folded) {
      handProbabilities = calculateHandProbabilities(viewer.holeCards, state.communityCards);
      const numOpponents = state.players.filter(
        (p) => p.role === 'player' && !p.folded && p.id !== viewerPlayerId
      ).length;
      handWinEquity = calculateWinEquity(viewer.holeCards, state.communityCards, numOpponents);
    }
  }

  return {
    gameState,
    event,
    actionRequest,
    ...(handProbabilities ? { handProbabilities } : {}),
    ...(handWinEquity ? { handWinEquity } : {}),
  };
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

export function cloneState(state: EngineState): EngineState {
  return {
    ...state,
    communityCards: [...state.communityCards],
    pots: state.pots.map((p) => ({ ...p, eligiblePlayerIds: [...p.eligiblePlayerIds] })),
    players: state.players.map((p) => ({ ...p, holeCards: p.holeCards ? [...p.holeCards] as [string, string] : null })),
    deck: [...state.deck],
    actedThisRound: [...state.actedThisRound],
    handEvents: [...state.handEvents],
    blindSchedule: [...state.blindSchedule],
  };
}
