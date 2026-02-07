import { Container, Graphics, Text } from 'pixi.js';
import { COLORS, TABLE_CENTER_X, TABLE_CENTER_Y } from '../constants';
import { PotChipStack } from './ChipStack';

export class PotDisplay extends Container {
  private potText: Text;
  private bg: Graphics;
  private chipStack: PotChipStack;

  constructor() {
    super();
    this.x = TABLE_CENTER_X;
    this.y = TABLE_CENTER_Y + 65;

    // Chip stack (to the left of the text)
    this.chipStack = new PotChipStack();
    this.chipStack.y = 0;
    this.addChild(this.chipStack);

    // Background pill
    this.bg = new Graphics();
    this.bg.roundRect(-55, -13, 110, 26, 13);
    this.bg.fill({ color: 0x000000, alpha: 0.4 });
    this.addChild(this.bg);

    // Pot text
    this.potText = new Text({
      text: 'Pot: $0',
      style: {
        fontSize: 14,
        fill: COLORS.textWhite,
        fontFamily: 'Arial',
        fontWeight: 'bold',
      },
    });
    this.potText.anchor.set(0.5);
    this.addChild(this.potText);
  }

  update(pot: number): void {
    this.potText.text = `Pot: $${pot.toLocaleString()}`;
    this.visible = pot > 0;

    // Resize background to fit text
    const textWidth = this.potText.width;
    this.bg.clear();
    const bgWidth = textWidth + 24;
    this.bg.roundRect(-bgWidth / 2, -13, bgWidth, 26, 13);
    this.bg.fill({ color: 0x000000, alpha: 0.4 });

    // Update chip stack (position to the left of the text)
    this.chipStack.update(pot);
    this.chipStack.x = -bgWidth / 2 - 28;
  }
}
