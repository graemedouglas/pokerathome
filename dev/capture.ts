/**
 * Browser capture utility for development.
 * Takes a screenshot and captures console output from the running dev server.
 *
 * Usage:
 *   npx tsx dev/capture.ts                    # screenshot + console (5s wait)
 *   npx tsx dev/capture.ts --wait 10000       # wait 10s before capture
 *   npx tsx dev/capture.ts --url http://localhost:5174
 */

import { chromium } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const SCREENSHOT_DIR = path.join(__dirname, 'screenshots');
const DEFAULT_URL = 'http://localhost:5173';
const DEFAULT_WAIT = 5000;

interface CaptureOptions {
  url: string;
  wait: number;
}

function parseArgs(): CaptureOptions {
  const args = process.argv.slice(2);
  let url = DEFAULT_URL;
  let wait = DEFAULT_WAIT;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--url' && args[i + 1]) {
      url = args[i + 1];
      i++;
    } else if (args[i] === '--wait' && args[i + 1]) {
      wait = parseInt(args[i + 1], 10);
      i++;
    }
  }

  return { url, wait };
}

async function capture() {
  const opts = parseArgs();

  // Ensure screenshot directory exists
  fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({
    viewport: { width: 1400, height: 900 },
  });

  // Collect console messages
  const consoleLogs: string[] = [];
  page.on('console', (msg) => {
    const type = msg.type().toUpperCase();
    consoleLogs.push(`[${type}] ${msg.text()}`);
  });

  // Collect errors
  page.on('pageerror', (err) => {
    consoleLogs.push(`[PAGE_ERROR] ${err.message}`);
  });

  try {
    console.log(`Navigating to ${opts.url}...`);
    await page.goto(opts.url, { waitUntil: 'networkidle', timeout: 15000 });

    console.log(`Waiting ${opts.wait}ms for game to render...`);
    await page.waitForTimeout(opts.wait);

    // Take screenshot
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const screenshotPath = path.join(SCREENSHOT_DIR, `capture-${timestamp}.png`);
    await page.screenshot({ path: screenshotPath, fullPage: false });
    console.log(`Screenshot saved: ${screenshotPath}`);

    // Print console output
    console.log('\n=== BROWSER CONSOLE OUTPUT ===');
    if (consoleLogs.length === 0) {
      console.log('(no console output)');
    } else {
      for (const log of consoleLogs) {
        console.log(log);
      }
    }
    console.log('=== END CONSOLE OUTPUT ===\n');

    // Also save console log to file
    const logPath = path.join(SCREENSHOT_DIR, `console-${timestamp}.txt`);
    fs.writeFileSync(logPath, consoleLogs.join('\n'));

    // Return the screenshot path for easy reading
    console.log(`\nFiles:\n  Screenshot: ${screenshotPath}\n  Console log: ${logPath}`);

  } catch (err) {
    console.error('Capture failed:', err);
    // Still print any console output we got
    if (consoleLogs.length > 0) {
      console.log('\n=== BROWSER CONSOLE OUTPUT (partial) ===');
      for (const log of consoleLogs) {
        console.log(log);
      }
    }
  } finally {
    await browser.close();
  }
}

capture();
