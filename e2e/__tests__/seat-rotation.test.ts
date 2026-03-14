/**
 * Regression tests for seat rotation logic.
 * Ensures toVisualSeat correctly maps absolute seat indices to visual positions
 * so the human player always appears at the bottom center (visual seat 0).
 */
import { toVisualSeat } from '../../ui/src/utils/Layout'

describe('Seat rotation (toVisualSeat)', () => {
  test('offset 0 — no rotation', () => {
    for (let i = 0; i < 6; i++) {
      expect(toVisualSeat(i, 0)).toBe(i)
    }
  })

  test('offset 3 — human at seat 3 maps to visual seat 0', () => {
    expect(toVisualSeat(3, 3)).toBe(0) // human at bottom
    expect(toVisualSeat(4, 3)).toBe(1)
    expect(toVisualSeat(5, 3)).toBe(2)
    expect(toVisualSeat(0, 3)).toBe(3)
    expect(toVisualSeat(1, 3)).toBe(4)
    expect(toVisualSeat(2, 3)).toBe(5)
  })

  test('offset 1 — human at seat 1 maps to visual seat 0', () => {
    expect(toVisualSeat(1, 1)).toBe(0)
    expect(toVisualSeat(0, 1)).toBe(5)
  })

  test('all seats map to unique visual positions for every offset', () => {
    for (let offset = 0; offset < 6; offset++) {
      const visual = new Set<number>()
      for (let seat = 0; seat < 6; seat++) {
        visual.add(toVisualSeat(seat, offset))
      }
      expect(visual.size).toBe(6)
    }
  })
})
