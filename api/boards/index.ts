import {
  getOwnerUid,
  json,
  query,
  rateLimitOk,
  readJson,
  searchParams,
  toBoard,
} from "../_db.js";

import type { ApiRequest, ApiResponse, BoardRow } from "../_db.js";

/**
 * Collection endpoint: list and create boards.
 */

/**
 * Columns safe to send to a listing.
 *
 * `scene` is deliberately absent: `listBoards` strips it in the Dexie version
 * too, because scenes can be megabytes and the grid never renders them. Use
 * `GET /api/boards/[id]` when you need it. `scene_bytes` *is* included, because
 * it is what lets the "size" sort work without loading scenes
 * (`selectors.ts:41`).
 */
const LIST_COLUMNS = `id, name, folder_id, favorite, trashed_at, thumbnail,
  scene_version, created_at, updated_at, last_opened_at, scene_bytes`;

/**
 * `GET /api/boards`
 *
 * Query parameters mirror `listBoards` in `db/operations.ts` so the API adapter
 * in STEP 4 can be a drop-in replacement for the Dexie one:
 *
 * - `trashed=1` -> only soft-deleted boards (the trash page). The default is
 *   live boards only, which is what `listBoards` does with `includeTrashed:
 *   false`.
 * - `folderId=<uuid>` -> boards in that folder. `folderId=unfiled` selects boards
 *   with no folder, matching `selectors.ts`'s "null means unfiled".
 *
 * Ordering is `COALESCE(last_opened_at, updated_at) DESC`, which is the app's
 * real "recent" sort (`selectors.ts:47`) rather than plain `updated_at` — a board
 * that was opened but not edited should still sort as recently used.
 *
 * Every query is scoped by `owner_uid`, so one owner can never read another's
 * rows regardless of the id they pass.
 */
const handleGet = async (req: ApiRequest, res: ApiResponse, uid: string) => {
  const params = searchParams(req);
  const trashed = params.get("trashed") === "1";
  const folderParam = params.get("folderId");

  const trashFilter = trashed
    ? "AND trashed_at IS NOT NULL"
    : "AND trashed_at IS NULL";
  const order = "ORDER BY COALESCE(last_opened_at, updated_at) DESC";

  const rows =
    folderParam === null
      ? await query<BoardRow>(
          `SELECT ${LIST_COLUMNS} FROM boards
           WHERE owner_uid = $1 ${trashFilter} ${order}`,
          [uid],
        )
      : folderParam === "unfiled"
      ? await query<BoardRow>(
          `SELECT ${LIST_COLUMNS} FROM boards
             WHERE owner_uid = $1 AND folder_id IS NULL ${trashFilter} ${order}`,
          [uid],
        )
      : await query<BoardRow>(
          `SELECT ${LIST_COLUMNS} FROM boards
             WHERE owner_uid = $1 AND folder_id = $2 ${trashFilter} ${order}`,
          [uid, folderParam],
        );

  json(res, { boards: rows.map(toBoard) });
};

/**
 * `POST /api/boards`
 *
 * Creates a board and returns it with its server-assigned `id`, mirroring
 * `createBoard` in `db/operations.ts`: `favorite`, `trashedAt` and
 * `lastOpenedAt` start false/null, `sceneVersion` starts at 0, and `name`
 * defaults to "Untitled board" so the "New board" button does not have to invent
 * one.
 *
 * The `activity` insert is why that table exists: `getBoardStatsMap`
 * (`db/operations.ts:415`) counts those rows for the card chip, and the Activity
 * page renders them as a timeline.
 *
 * `folderId` is checked against the caller's own folders rather than left to the
 * foreign key. The FK would happily accept another owner's folder uuid, which
 * would leak that folder's name into the sidebar.
 */
const handlePost = async (req: ApiRequest, res: ApiResponse, uid: string) => {
  const body = readJson(req);
  if (body === null) {
    json(res, { error: "invalid JSON body" }, 400);
    return;
  }

  const name =
    typeof body.name === "string" && body.name.trim()
      ? body.name.trim()
      : "Untitled board";
  const folderId =
    typeof body.folderId === "string" && body.folderId ? body.folderId : null;
  const thumbnail = typeof body.thumbnail === "string" ? body.thumbnail : null;
  const scene = typeof body.scene === "string" ? body.scene : null;
  const sceneBytes = scene === null ? null : scene.length;

  if (folderId !== null) {
    const owned = await query(
      "SELECT 1 FROM folders WHERE id = $1 AND owner_uid = $2",
      [folderId, uid],
    );
    if (owned.length === 0) {
      json(res, { error: "folder not found" }, 404);
      return;
    }
  }

  // The id comes from Postgres (gen_random_uuid()) so the client never has to
  // invent one.
  const inserted = await query<BoardRow>(
    `INSERT INTO boards (owner_uid, name, folder_id, thumbnail, scene, scene_bytes)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING ${LIST_COLUMNS}, scene`,
    [uid, name, folderId, thumbnail, scene, sceneBytes],
  );

  const board = toBoard(inserted[0]);
  await query(
    "INSERT INTO activity (owner_uid, board_id, type) VALUES ($1, $2, 'create')",
    [uid, board.id as string],
  );

  json(res, { board }, 201);
};

export default async function handler(
  req: ApiRequest,
  res: ApiResponse,
): Promise<void> {
  try {
    const uid = getOwnerUid(req, res);

    if (!rateLimitOk(uid)) {
      json(res, { error: "rate limit exceeded" }, 429);
      return;
    }

    const method = req.method ?? "GET";

    if (method === "GET") {
      await handleGet(req, res, uid);
      return;
    }
    if (method === "POST") {
      await handlePost(req, res, uid);
      return;
    }

    // Allow a browser client to discover the methods this route supports.
    if (method === "OPTIONS") {
      res.setHeader("Allow", "GET, POST, OPTIONS");
      res.status(204).end();
      return;
    }

    res.setHeader("Allow", "GET, POST, OPTIONS");
    json(res, { error: "method not allowed" }, 405);
  } catch (error) {
    // Log the real cause server-side; return an opaque 500. Driver errors can
    // contain the connection URL, which must never reach a client.
    console.error("[api/boards]", error);
    json(res, { error: "internal error" }, 500);
  }
}
