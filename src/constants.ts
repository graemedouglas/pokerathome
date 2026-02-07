// Canvas dimensions
export const CANVAS_WIDTH = 1400;
export const CANVAS_HEIGHT = 900;

// Table
export const TABLE_CENTER_X = CANVAS_WIDTH / 2;
export const TABLE_CENTER_Y = CANVAS_HEIGHT / 2 - 40;
export const TABLE_RX = 390; // ellipse horizontal radius
export const TABLE_RY = 185; // ellipse vertical radius
export const TABLE_RIM_WIDTH = 18;

// Seat layout (slightly larger ellipse than table)
export const SEAT_ELLIPSE_RX = TABLE_RX + 140;
export const SEAT_ELLIPSE_RY = TABLE_RY + 80;
export const NUM_SEATS = 6;

// Card sizing
export const CARD_WIDTH = 70;
export const CARD_HEIGHT = 98;
export const CARD_SCALE = 0.55; // scale applied to card sprites

// Colors
export const COLORS = {
  background: 0x0f0f23,
  felt: 0x1a6b35,
  feltLight: 0x228b44,
  feltDark: 0x145528,
  rim: 0x5c3a1e,
  rimLight: 0x7a5030,
  rimDark: 0x3d260f,
  chipWhite: 0xf0f0f0,
  chipRed: 0xcc3333,
  chipBlue: 0x3355cc,
  chipGreen: 0x33aa33,
  chipBlack: 0x333333,
  gold: 0xffd700,
  textWhite: 0xffffff,
  textLight: 0xcccccc,
  textMuted: 0x777799,
  btnFold: 0xcc3333,
  btnCheck: 0x3366cc,
  btnCall: 0x3366cc,
  btnRaise: 0x33aa44,
  btnHover: 0xffffff,
  highlight: 0xffcc00,
  panelBg: 0x181830,
  panelBorder: 0x2a2a50,
  panelActive: 0x222250,
};

// Timing (ms)
export const BOT_THINK_MIN = 500;
export const BOT_THINK_MAX = 1500;
export const DEAL_DELAY = 150;
export const PHASE_DELAY = 800;
export const SHOWDOWN_DELAY = 2500;
export const NEXT_HAND_DELAY = 3000;

// Game
export const STARTING_CHIPS = 1000;
export const SMALL_BLIND = 5;
export const BIG_BLIND = 10;

// Card asset path
export const CARD_ASSET_PATH = 'assets/cards/';
