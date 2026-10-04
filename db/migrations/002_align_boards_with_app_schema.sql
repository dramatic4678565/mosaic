-- 002: align `boards` with the fields the dashboard actually persists.
--
-- `001` created the columns the Part 3A brief listed, but the app's real data
-- model (`mosaic-dashboard/src/db/schema.ts`) writes four things that were not in
-- that list. Without this migration the API would silently drop them, because
-- `db/operations.ts` writes them on every save/open.
--
-- 1. last_opened_at — written by `touchOpened` (operations.ts:265) and indexed in
--    the Dexie store. `selectors.ts:47` sorts "recent" on
--    `lastOpenedAt ?? updatedAt`, so without it every board falls back to
--    updatedAt and "recent" silently means "last edited".
-- 2. scene_bytes — written on every scene save (operations.ts:256) and asserted
--    by `db.test.ts:125`. It drives the "size" sort
--    (`selectors.ts:41`) without loading scenes.
-- 3. scene: jsonb -> text. The app stores the scene as an opaque *string*
--    (`Board["scene"]?: string`, produced by `exportToBlob`), not as parsed JSON.
--    A jsonb column would parse and re-normalise that string, so
--    `getBoardWithScene` would return a re-serialised blob with different
--    whitespace and key order — the scene would change on every round trip. Text
--    keeps the bytes the editor produced, which is what a scene file is.
--
-- Forward-only by design: `001` is already recorded in `_migrations`, so editing
-- it would not re-run. `IF NOT EXISTS` keeps this safe to re-apply by hand.

ALTER TABLE boards
  ADD COLUMN IF NOT EXISTS last_opened_at TIMESTAMPTZ;

ALTER TABLE boards
  ADD COLUMN IF NOT EXISTS scene_bytes INTEGER;

-- The table is empty at the time this runs, so the USING cast moves no data; it
-- is written to be correct if a row ever did exist.
ALTER TABLE boards
  ALTER COLUMN scene TYPE TEXT USING scene::TEXT;

-- Backs the "recent" sort's fallback path and the recency ordering used by
-- `GET /api/boards`. `boards_owner_updated` already covers the common case, but a
-- partial index on live rows only is what the grid actually reads.
CREATE INDEX IF NOT EXISTS boards_owner_last_opened
  ON boards (owner_uid, last_opened_at DESC NULLS LAST);