-- Real user accounts: magic-link login, sessions, and the ownership bridge from
-- Part 3A's anonymous cookie.
--
-- Part 3A identified people by a signed `mosaic_uid` cookie and scoped every row
-- by `owner_uid TEXT`. That stays: it is what anonymous visitors still use, and
-- forcing them to log in would break the local-first design. `user_id` is added
-- alongside it and is nullable, so a board can be anonymous, claimed, or owned
-- by a user, and the two schemes never have to be migrated wholesale.
--
-- gen_random_uuid() comes from pgcrypto, enabled in 001_init.sql.

CREATE TABLE IF NOT EXISTS users (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email         TEXT UNIQUE NOT NULL,
  display_name  TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_login_at TIMESTAMPTZ
);

-- One row per issued magic link.
--
-- `token` is the primary key so a lookup is a single index hit, and it holds the
-- raw token: this table is only ever reached by an exact-match lookup on a value
-- the holder already possesses, so there is no enumeration surface to rate-limit
-- away. `used_at` is what makes a link single-use — a second click finds it set
-- and fails, which is the whole point of a magic link.
CREATE TABLE IF NOT EXISTS magic_links (
  token       TEXT PRIMARY KEY,
  email       TEXT NOT NULL,
  expires_at  TIMESTAMPTZ NOT NULL,
  used_at     TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Backs the "3 requests per email per hour" rate limit and the cleanup sweep that
-- deletes expired rows.
CREATE INDEX IF NOT EXISTS magic_links_email ON magic_links (email);

CREATE TABLE IF NOT EXISTS sessions (
  token      TEXT PRIMARY KEY,
  user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Backs "load my session" on every authenticated request. Without this,
-- validating a cookie would scan every live session.
CREATE INDEX IF NOT EXISTS sessions_user_id ON sessions (user_id);

-- Ownership bridge.
--
-- Nullable on purpose, and deliberately not NOT NULL: an anonymous board keeps a
-- null user_id and is reachable only through its cookie's owner_uid. Backfilling
-- every existing row would be wrong anyway, since a cookie uid cannot be mapped
-- to a user who has never logged in.
--
-- ON DELETE SET NULL is implied by the default (NO ACTION) and would be wrong:
-- deleting a user must not cascade a delete into their boards. The account is
-- removed; the content is left for an explicit purge.
ALTER TABLE boards ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE folders ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES users(id) ON DELETE SET NULL;

-- The authenticated read path filters on user_id, so it needs its own index; the
-- existing indexes are all owner_uid-based and cannot serve it.
CREATE INDEX IF NOT EXISTS boards_user_id ON boards (user_id);
CREATE INDEX IF NOT EXISTS folders_user_id ON folders (user_id);