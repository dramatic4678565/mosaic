-- Board sharing: an unguessable token plus what its holder is allowed to do.
--
-- The token is the capability. Anyone holding it may read the board, which is the
-- whole feature, so it has to be unguessable rather than sequential: a short
-- enumerable id would let anyone walk `mosaic.example/share/1`, `/share/2`, … and
-- read every board anyone ever shared. 256 bits of entropy removes the question.
--
-- `share_mode` is nullable so revoking is a single UPDATE that clears both columns,
-- rather than deleting the row or juggling a separate flag. A row with a token but
-- a null mode is not a valid state, and the CHECK below makes that unrepresentable.
--
-- Note there is no expiry column. A share link is meant to outlive a deploy; the
-- way to stop one existing is to revoke it, which clears the token and frees the
-- UNIQUE slot for reuse by a different board.

ALTER TABLE boards
  ADD COLUMN IF NOT EXISTS share_token TEXT UNIQUE,
  ADD COLUMN IF NOT EXISTS share_mode TEXT;

-- 'edit' is reserved for a future step. It is accepted now so the column does not
-- have to be re-migrated when it is implemented, but nothing grants it yet: the
-- public route refuses it. Storing a mode the server will not honour would be worse
-- than not having the column.
ALTER TABLE boards
  DROP CONSTRAINT IF EXISTS boards_share_mode_check;

ALTER TABLE boards
  ADD CONSTRAINT boards_share_mode_check
  CHECK (share_mode IS NULL OR share_mode IN ('view', 'edit'));

-- A board is only shared when both halves agree. Without this, a bug that cleared
-- one column without the other would produce either an unusable token or a mode
-- with no way to reach the board.
ALTER TABLE boards
  DROP CONSTRAINT IF EXISTS boards_share_pair_check;

ALTER TABLE boards
  ADD CONSTRAINT boards_share_pair_check
  CHECK (
    (share_token IS NULL AND share_mode IS NULL)
    OR (share_token IS NOT NULL AND share_mode IS NOT NULL)
  );

-- The public lookup is `WHERE share_token = $1`, which the UNIQUE constraint already
-- indexes. This partial index additionally excludes revoked rows so the planner can
-- skip them and, more importantly, so the intent is written down: a revoked board is
-- not findable.
CREATE INDEX IF NOT EXISTS boards_share_token_live
  ON boards (share_token)
  WHERE share_token IS NOT NULL AND share_mode IS NOT NULL;

-- The owner needs to list what they have shared, scoped by who they are.
CREATE INDEX IF NOT EXISTS boards_share_owner
  ON boards (owner_uid, user_id)
  WHERE share_token IS NOT NULL;