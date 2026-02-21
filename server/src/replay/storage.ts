/**
 * Replay file I/O — save, load, and list replay files.
 */

import fs from 'node:fs';
import path from 'node:path';
import { config } from '../config.js';

export interface ReplayFileInfo {
  gameId: string;
  gameName: string;
  filePath: string;
  createdAt: string;
}

/** Save a replay file to disk. Returns the file path. */
export function saveReplayFile(gameId: string, replayData: object): string {
  const dir = config.REPLAY_DIR;
  fs.mkdirSync(dir, { recursive: true });
  const filePath = path.join(dir, `${gameId}.replay.json`);
  fs.writeFileSync(filePath, JSON.stringify(replayData));
  return filePath;
}

/** Load and parse a replay file from disk. */
export function loadReplayFile(filePath: string): unknown {
  const raw = fs.readFileSync(filePath, 'utf-8');
  return JSON.parse(raw);
}

/** List all available replay files. */
export function listReplayFiles(): ReplayFileInfo[] {
  const dir = config.REPLAY_DIR;
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter(f => f.endsWith('.replay.json'))
    .map(f => {
      const filePath = path.join(dir, f);
      const stat = fs.statSync(filePath);
      // Try to extract gameName from the file
      let gameName = f.replace('.replay.json', '');
      try {
        const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
        if (data?.gameConfig?.gameName) {
          gameName = data.gameConfig.gameName;
        }
      } catch { /* use default */ }
      return {
        gameId: f.replace('.replay.json', ''),
        gameName,
        filePath,
        createdAt: stat.mtime.toISOString(),
      };
    })
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}
