import { Container, Graphics } from 'pixi.js';
import {
  TABLE_CENTER_X, TABLE_CENTER_Y,
  TABLE_RX, TABLE_RY, TABLE_RIM_WIDTH,
  COLORS,
} from '../constants';

export class TableRenderer extends Container {
  constructor() {
    super();
    this.drawTable();
  }

  private drawTable(): void {
    const cx = TABLE_CENTER_X;
    const cy = TABLE_CENTER_Y;
    const rx = TABLE_RX;
    const ry = TABLE_RY;
    const rim = TABLE_RIM_WIDTH;

    // Shadow
    const shadow = new Graphics();
    shadow.ellipse(cx + 5, cy + 8, rx + rim + 12, ry + rim + 12);
    shadow.fill({ color: 0x000000, alpha: 0.4 });
    this.addChild(shadow);

    // Outer rim (dark wood base)
    const rimOuter = new Graphics();
    rimOuter.ellipse(cx, cy, rx + rim, ry + rim);
    rimOuter.fill(COLORS.rimDark);
    this.addChild(rimOuter);

    // Rim highlight (lighter wood, offset up slightly for 3D)
    const rimHighlight = new Graphics();
    rimHighlight.ellipse(cx, cy - 2, rx + rim - 1, ry + rim - 1);
    rimHighlight.fill(COLORS.rim);
    this.addChild(rimHighlight);

    // Rim top highlight (lightest, narrower)
    const rimTop = new Graphics();
    rimTop.ellipse(cx, cy - 3, rx + rim - 3, ry + rim - 3);
    rimTop.fill(COLORS.rimLight);
    this.addChild(rimTop);

    // Inner rim edge
    const rimInner = new Graphics();
    rimInner.ellipse(cx, cy, rx + 3, ry + 3);
    rimInner.fill(COLORS.rimDark);
    this.addChild(rimInner);

    // Green felt base
    const felt = new Graphics();
    felt.ellipse(cx, cy, rx, ry);
    felt.fill(COLORS.felt);
    this.addChild(felt);

    // Felt darker edge (vignette effect)
    const feltEdge = new Graphics();
    feltEdge.ellipse(cx, cy, rx, ry);
    feltEdge.fill({ color: COLORS.feltDark, alpha: 0.0 }); // transparent center
    this.addChild(feltEdge);

    // Subtle center highlight
    const feltHighlight = new Graphics();
    feltHighlight.ellipse(cx, cy - 20, rx * 0.55, ry * 0.45);
    feltHighlight.fill({ color: COLORS.feltLight, alpha: 0.12 });
    this.addChild(feltHighlight);

    // Inner decorative line (betting line)
    const bettingLine = new Graphics();
    bettingLine.ellipse(cx, cy, rx * 0.7, ry * 0.65);
    bettingLine.stroke({ color: COLORS.feltLight, width: 1, alpha: 0.15 });
    this.addChild(bettingLine);
  }
}
