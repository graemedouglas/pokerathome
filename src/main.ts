import { GameRenderer } from './renderer/GameRenderer';
import { Game } from './game/Game';

async function main() {
  const renderer = new GameRenderer();
  await renderer.init();

  const game = new Game(renderer);
  game.setHumanSeat(0);
  game.start();
}

main().catch(console.error);
