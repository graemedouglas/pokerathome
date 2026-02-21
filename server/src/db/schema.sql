-- Players who have connected at least once
CREATE TABLE IF NOT EXISTS players (
  id TEXT PRIMARY KEY,
  display_name TEXT NOT NULL,
  reconnect_token TEXT UNIQUE NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Game rooms (admin-created)
CREATE TABLE IF NOT EXISTS games (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  game_type TEXT NOT NULL DEFAULT 'cash',
  status TEXT NOT NULL DEFAULT 'waiting',
  small_blind INTEGER NOT NULL,
  big_blind INTEGER NOT NULL,
  max_players INTEGER NOT NULL DEFAULT 9,
  starting_stack INTEGER NOT NULL DEFAULT 1000,
  spectator_visibility TEXT NOT NULL DEFAULT 'showdown',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Players assigned to games
CREATE TABLE IF NOT EXISTS game_players (
  game_id TEXT NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  player_id TEXT NOT NULL REFERENCES players(id),
  seat_index INTEGER NOT NULL,
  role TEXT NOT NULL DEFAULT 'player',
  buy_in INTEGER NOT NULL,
  PRIMARY KEY (game_id, player_id)
);

-- Hand history (one row per completed hand)
CREATE TABLE IF NOT EXISTS hand_history (
  id TEXT PRIMARY KEY,
  game_id TEXT NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  hand_number INTEGER NOT NULL,
  events_json TEXT NOT NULL,
  winners_json TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(game_id, hand_number)
);

-- Crash recovery: latest serialized game state per active game
CREATE TABLE IF NOT EXISTS game_snapshots (
  game_id TEXT PRIMARY KEY REFERENCES games(id) ON DELETE CASCADE,
  state_json TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
