import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { FastifyBaseLogger } from 'fastify';
import { config } from '../config.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

let db: Database.Database;

export function getDb(): Database.Database {
  if (!db) {
    throw new Error('Database not initialized. Call initDb() first.');
  }
  return db;
}

export function initDb(logger: FastifyBaseLogger): Database.Database {
  db = new Database(config.DB_PATH);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  const schemaPath = path.join(__dirname, 'schema.sql');
  const schemaSql = fs.readFileSync(schemaPath, 'utf-8');
  db.exec(schemaSql);

  // Migrate: add spectator_visibility column to existing databases
  const cols = db.pragma('table_info(games)') as Array<{ name: string }>;
  if (!cols.some(c => c.name === 'spectator_visibility')) {
    db.exec(`ALTER TABLE games ADD COLUMN spectator_visibility TEXT NOT NULL DEFAULT 'showdown'`);
    logger.info('Migrated: added spectator_visibility column to games');
  }

  logger.info({ dbPath: config.DB_PATH }, 'Database initialized');
  return db;
}

export function closeDb(logger: FastifyBaseLogger): void {
  if (db) {
    db.close();
    logger.info('Database closed');
  }
}
