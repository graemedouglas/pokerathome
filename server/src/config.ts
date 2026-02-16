import 'dotenv/config';
import { z } from 'zod';

const envSchema = z.object({
  PORT: z.coerce.number().int().default(3000),
  HOST: z.string().default('0.0.0.0'),
  DB_PATH: z.string().default('./pokerathome.db'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),

  /** Milliseconds a player has to act before timeout */
  ACTION_TIMEOUT_MS: z.coerce.number().int().min(5000).default(30000),

  /** Delay between hands in ms (lets clients render results) */
  HAND_DELAY_MS: z.coerce.number().int().min(0).default(3000),

  /** Minimum number of ready players to start a game */
  MIN_PLAYERS_TO_START: z.coerce.number().int().min(2).default(2),

  /** Spectator card visibility mode */
  SPECTATOR_CARD_VISIBILITY: z.enum(['immediate', 'delayed', 'showdown']).default('delayed'),
});

export type Config = z.infer<typeof envSchema>;

export const config: Config = envSchema.parse(process.env);
