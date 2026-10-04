-- Mosaic initial schema (Neon Postgres).
--
-- Applies to BOTH storage backends conceptually: the browser's IndexedDB and
-- this Postgres schema describe the same Board/Folder shapes, so a future sync
-- or migration between them is a shape comparison rather than a redesign.
--
-- `owner_uid` is the anonymous cookie identity minted by `api/_db.ts`
-- (`mosaic_uid`). Part 3A has no accounts - a uid is not a login - which is why
-- it is TEXT rather than a users table foreign key. Part 3B adds real auth and
-- can backfill without changing this column's type.

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TABLE IF NOT EXISTS boards (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_uid     TEXT NOT NULL,
  name          TEXT NOT NULL DEFAULT 'Untitled',
  folder_id     UUID,
  favorite      BOOLEAN NOT NULL DEFAULT false,
  trashed_at    TIMESTAMPTZ,
  thumbnail     TEXT,
  scene         JSONB,
  scene_version INTEGER NOT NULL DEFAULT 0,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- The board grid's default query is "my boards, most recently updated first",
-- so owner_uid and updated_at are indexed together rather than separately:
-- a composite index answers that query in one scan, and updated_at DESC matches
-- the ordering the UI already sorts by.
CREATE INDEX IF NOT EXISTS boards_owner_updated
  ON boards (owner_uid, updated_at DESC);

-- Soft-delete queries filter on trashed_at within the same owner scope.
CREATE INDEX IF NOT EXISTS boards_owner_trashed
  ON boards (owner_uid, trashed_at)
  WHERE trashed_at IS NOT NULL;

CREATE TABLE IF NOT EXISTS folders (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_uid  TEXT NOT NULL,
  name       TEXT NOT NULL,
  color      TEXT NOT NULL DEFAULT 'blue',
  parent_id  UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- The sidebar lists folders by creation order within one owner.
CREATE INDEX IF NOT EXISTS folders_owner
  ON folders (owner_uid, created_at DESC);

-- Activity is append-heavy and only ever read newest-first, per board or per
-- owner. Kept in Postgres rather than derived from boards so the timeline
-- survives an undo: a rename that is reverted is still a real event that
-- happened. The client-side IndexedDB store records the same events.
CREATE TABLE IF NOT EXISTS activity (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_uid  TEXT NOT NULL,
  board_id   UUID NOT NULL,
  type       TEXT NOT NULL,
  detail     TEXT,
  ts         TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS activity_owner_ts
  ON activity (owner_uid, ts DESC);

CREATE INDEX IF NOT EXISTS activity_board_ts
  ON activity (board_id, ts DESC);