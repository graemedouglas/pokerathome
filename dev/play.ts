import { chromium } from '@playwright/test';
import { mkdirSync } from 'fs';

interface DebugButton {
  label: string;
  globalX: number;
  globalY: number;
}

interface PokerDebug {
  visible: boolean;
  buttons: DebugButton[];
}

const TARGET_URL = process.env.URL || 'http://localhost:5173';
const MAX_HANDS = 5;
const POLL_INTERVAL = 500;

// Ensure screenshots directory exists
try { mkdirSync('dev/screenshots', { recursive: true }); } catch { /* exists */ }

async function main() {
  console.log('Launching browser...');
  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  const page = await context.newPage();

  // Forward console messages and errors
  page.on('console', msg => {
    console.log(`[browser:${msg.type()}] ${msg.text()}`);
  });
  page.on('pageerror', err => {
    console.error(`[PAGE ERROR] ${err.message}`);
  });

  console.log(`Navigating to ${TARGET_URL}...`);
  await page.goto(TARGET_URL);

  // Clear localStorage so new defaults take effect, then reload
  await page.evaluate(() => localStorage.removeItem('pokerathome_settings'));
  await page.reload();
  await page.waitForTimeout(3000);

  // Take initial screenshot
  await page.screenshot({ path: 'dev/screenshots/initial.png' });
  console.log('Screenshot saved: dev/screenshots/initial.png');

  let actionsPerformed = 0;
  let handEstimate = 0;

  console.log('Watching for human turn...');

  while (handEstimate < MAX_HANDS) {
    let debug: PokerDebug | undefined;
    try {
      debug = await page.evaluate(() => (window as any).__pokerDebug as PokerDebug | undefined);
    } catch {
      console.log('Browser closed, exiting.');
      return;
    }

    if (debug?.visible && debug.buttons.length > 0) {
      // Pick action: Check > Call > Fold
      let chosen: DebugButton | null = null;
      chosen = debug.buttons.find(b => b.label === 'Check') || null;
      if (!chosen) chosen = debug.buttons.find(b => b.label.startsWith('Call')) || null;
      if (!chosen) chosen = debug.buttons.find(b => b.label === 'Fold') || null;
      if (!chosen) chosen = debug.buttons[0];

      if (chosen) {
        console.log(`Action #${actionsPerformed + 1}: Clicking "${chosen.label}" at (${Math.round(chosen.globalX)}, ${Math.round(chosen.globalY)})`);

        const canvas = await page.$('canvas');
        if (canvas) {
          await canvas.click({
            position: { x: chosen.globalX, y: chosen.globalY },
          });
        }

        actionsPerformed++;

        await page.waitForTimeout(300);
        const screenshotPath = `dev/screenshots/action_${actionsPerformed}.png`;
        await page.screenshot({ path: screenshotPath });
        console.log(`Screenshot saved: ${screenshotPath}`);

        if (chosen.label === 'Fold') {
          handEstimate++;
          console.log(`Estimated hand #${handEstimate} complete (folded)`);
        }

        await page.waitForTimeout(1000);
      }
    } else {
      await page.waitForTimeout(POLL_INTERVAL);
    }
  }

  console.log(`Done! Performed ${actionsPerformed} actions across ~${handEstimate} hands.`);
  await page.waitForTimeout(3000);
  await browser.close();
}

main().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
