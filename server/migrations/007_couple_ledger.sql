-- SPDX-License-Identifier: MIT
-- Couple binding plus a shared, auditable inventory ledger. Balances are
-- derived from immutable transaction rows so every acquisition/use remains
-- explainable and both partners always see the same result.

CREATE TABLE couples (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  invite_code TEXT NOT NULL UNIQUE COLLATE NOCASE,
  created_by  INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE couple_members (
  couple_id INTEGER NOT NULL REFERENCES couples(id) ON DELETE CASCADE,
  user_id   INTEGER NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  joined_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (couple_id, user_id)
);
CREATE INDEX idx_couple_members_couple ON couple_members(couple_id);

CREATE TABLE inventory_items (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  couple_id   INTEGER NOT NULL REFERENCES couples(id) ON DELETE CASCADE,
  name        TEXT NOT NULL COLLATE NOCASE CHECK (length(name) BETWEEN 1 AND 50),
  unit        TEXT NOT NULL DEFAULT '张' CHECK (length(unit) BETWEEN 1 AND 12),
  emoji       TEXT CHECK (emoji IS NULL OR length(emoji) <= 16),
  description TEXT CHECK (description IS NULL OR length(description) <= 200),
  archived    INTEGER NOT NULL DEFAULT 0 CHECK (archived IN (0, 1)),
  created_by  INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_inventory_items_couple ON inventory_items(couple_id, archived, created_at);
CREATE UNIQUE INDEX idx_inventory_items_active_name
  ON inventory_items(couple_id, name COLLATE NOCASE) WHERE archived = 0;

CREATE TABLE inventory_transactions (
  id                     INTEGER PRIMARY KEY AUTOINCREMENT,
  couple_id              INTEGER NOT NULL REFERENCES couples(id) ON DELETE CASCADE,
  item_id                INTEGER NOT NULL REFERENCES inventory_items(id) ON DELETE RESTRICT,
  member_user_id         INTEGER REFERENCES users(id) ON DELETE SET NULL,
  member_name            TEXT NOT NULL,
  actor_user_id          INTEGER REFERENCES users(id) ON DELETE SET NULL,
  actor_name             TEXT NOT NULL,
  delta                  INTEGER NOT NULL CHECK (delta != 0 AND delta BETWEEN -100000 AND 100000),
  note                   TEXT CHECK (note IS NULL OR length(note) <= 200),
  created_at             TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_inventory_tx_couple_time ON inventory_transactions(couple_id, created_at DESC, id DESC);
CREATE INDEX idx_inventory_tx_item_member ON inventory_transactions(item_id, member_user_id);
