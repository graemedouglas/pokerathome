import { Container, Graphics, Text } from 'pixi.js';
import { COLORS } from '../constants';

// Chip denomination colors (sorted high to low)
const CHIP_DENOM = [
  { value: 500, color: 0x222222, edge: 0x555555 },  // black
  { value: 100, color: 0x333333, edge: 0x666666 },  // dark gray
  { value: 25, color: 0x22aa44, edge: 0x44cc66 },   // green
  { value: 5, color: 0xcc3333, edge: 0xee5555 },    // red
  { value: 1, color: 0xdddddd, edge: 0xffffff },    // white
];

/** Break an amount into chip denominations, returns array of chip colors (bottom to top) */
function getChipBreakdown(amount: number): { color: number; edge: number }[] {
  const chips: { color: number; edge: number }[] = [];
  let remaining = amount;

  for (const denom of CHIP_DENOM) {
    const count = Math.floor(remaining / denom.value);
    remaining -= count * denom.value;
    const visualCount = Math.min(count, 5);
    for (let i = 0; i < visualCount; i++) {
      chips.push({ color: denom.color, edge: denom.edge });
    }
  }

  if (chips.length > 12) chips.length = 12;
  // Reverse so largest denomination is on top
  chips.reverse();
  return chips;
}

/** Draw a single poker chip (top-down 3D view) */
function drawChip(g: Graphics, x: number, y: number, radius: number, color: number, edgeColor: number) {
  // Chip edge (bottom ellipse for 3D effect)
  g.ellipse(x, y + 2, radius, radius * 0.4);
  g.fill({ color: 0x000000, alpha: 0.3 });

  // Chip body
  g.ellipse(x, y, radius, radius * 0.4);
  g.fill(color);
  g.ellipse(x, y, radius, radius * 0.4);
  g.stroke({ color: edgeColor, width: 1 });

  // Inner ring
  g.ellipse(x, y, radius * 0.55, radius * 0.55 * 0.4);
  g.stroke({ color: edgeColor, width: 0.7, alpha: 0.5 });
}

/**
 * ChipStack - visual chip stack display for player bets
 */
export class ChipStack extends Container {
  private chipGraphics: Graphics;
  private amountText: Text;
  private currentAmount = -1;

  constructor() {
    super();

    this.chipGraphics = new Graphics();
    this.addChild(this.chipGraphics);

    this.amountText = new Text({
      text: '',
      style: {
        fontSize: 11,
        fill: COLORS.textWhite,
        fontFamily: 'Arial',
        fontWeight: 'bold',
      },
    });
    this.amountText.anchor.set(0.5, 0);
    this.addChild(this.amountText);

    this.visible = false;
  }

  update(amount: number): void {
    if (amount === this.currentAmount) return;
    this.currentAmount = amount;

    this.chipGraphics.clear();

    if (amount <= 0) {
      this.visible = false;
      return;
    }
    this.visible = true;

    const chips = getChipBreakdown(amount);
    const chipRadius = 10;
    const stackSpacing = 3;

    // Draw chips from bottom to top
    for (let i = 0; i < chips.length; i++) {
      const y = -i * stackSpacing;
      drawChip(this.chipGraphics, 0, y, chipRadius, chips[i].color, chips[i].edge);
    }

    // Amount label below the stack
    this.amountText.text = `$${amount}`;
    this.amountText.y = 8;
  }
}

/**
 * PotChipStack - larger chip display for the pot area
 * Shows multiple stacks side by side for larger pots
 */
export class PotChipStack extends Container {
  private chipGraphics: Graphics;
  private currentAmount = -1;

  constructor() {
    super();
    this.chipGraphics = new Graphics();
    this.addChild(this.chipGraphics);
    this.visible = false;
  }

  update(amount: number): void {
    if (amount === this.currentAmount) return;
    this.currentAmount = amount;
    this.chipGraphics.clear();

    if (amount <= 0) {
      this.visible = false;
      return;
    }
    this.visible = true;

    const chips = getChipBreakdown(amount);
    const chipRadius = 13;
    const stackSpacing = 3;
    const maxPerStack = 5;

    // Split into stacks
    const stacks: typeof chips[] = [];
    for (let i = 0; i < chips.length; i += maxPerStack) {
      stacks.push(chips.slice(i, i + maxPerStack));
    }

    // Draw stacks side by side
    const stackWidth = chipRadius * 2.2;
    const totalWidth = stacks.length * stackWidth;
    const startX = -totalWidth / 2 + chipRadius;

    for (let s = 0; s < stacks.length; s++) {
      const stack = stacks[s];
      const sx = startX + s * stackWidth;
      for (let i = 0; i < stack.length; i++) {
        const y = -i * stackSpacing;
        drawChip(this.chipGraphics, sx, y, chipRadius, stack[i].color, stack[i].edge);
      }
    }
  }
}
