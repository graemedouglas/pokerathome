import {
  TABLE_CENTER_X, TABLE_CENTER_Y,
  SEAT_ELLIPSE_RX, SEAT_ELLIPSE_RY,
  NUM_SEATS,
} from '../constants';

export interface SeatPosition {
  x: number;
  y: number;
  angle: number;
}

/**
 * Compute seat positions evenly distributed on an ellipse.
 * Seat 0 is at the bottom center (6 o'clock) for the human player.
 */
export function computeSeatPositions(): SeatPosition[] {
  const positions: SeatPosition[] = [];
  for (let i = 0; i < NUM_SEATS; i++) {
    // Start at bottom (╧Ç/2) and go clockwise
    const angle = (Math.PI / 2) + (i * (2 * Math.PI) / NUM_SEATS);
    const x = TABLE_CENTER_X + SEAT_ELLIPSE_RX * Math.cos(angle);
    const y = TABLE_CENTER_Y + SEAT_ELLIPSE_RY * Math.sin(angle);
    positions.push({ x, y, angle });
  }
  return positions;
}