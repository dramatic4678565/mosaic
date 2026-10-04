import {
  getOwnerUid,
  json,
  query,
  rateLimitOk,
  toBoard,
  toIso,
  type BoardRow,
} from "../_db.js";

/**
 * Single-board endpoint: read, update, delete.
 *
 * Pins the Node.js runtime so `vercel dev` and production behave identically.
 */
export const config = { runtime: "nodejs" };

/** Full row including `scene`, for when a board is actually opened. */
const FULL_COLUMNS = `id, name, folder_id, favorite, trashed_at, thumbnail, scene,
  scene_version, created_at, updated_at, last_opened_at, scene_bytes`;

/**
 * Ownership is checked with one query that returns the row only if it belongs to
 * the caller, so there is no read-then-check window and no chance of a 403/404
 * mix-up: an id that exists but is not yours is indistinguishable from one that
 * does not exist. Returning 404 for both is deliberate — a 403 would confirm the
 * id is real, which is a small information leak about other users' data.
 */
const loadOwned = (id: string, uid: string) =>
  query<BoardRow>(
    `SELECT ${FULL_COLUMNS} FROM boards WHERE id = $1 AND owner_uid = $2`,
    [id, uid],
  );

const isUuid = (value: string) =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value,
  );

/**
 * `GET /api/boards/[id]`
 *
 * Returns the board *with* its scene — this is the `getBoardWithScene` path, the
 * one call that loads what the editor needs. Also bumps `last_opened_at`, which is
 * what makes the "recent" sort reflect actual usage rather than last edit
 * (`selectors.ts:47`), mirroring `touchOpened` in `db/operations.ts:265`.
 */
const handleGet = async (id: string, uid: string, cookie: Headers) => {
  const rows = await loadOwned(id, uid);
  const row = rows[0];
  if (!row) {
    return json({ error: "not found" }, 404, cookie);
  }

  await query(
    "UPDATE boards SET last_opened_at = now() WHERE id = $1 AND owner_uid = $2",
    [id, uid],
  );

  const board = toBoard({ ...row, last_opened_at: new Date() });
  return json({ board }, 200, cookie);
};

/**
 * `PATCH /api/boards/[id]`
 *
 * Applies a partial update. Only keys present in the body are touched, so a
 * rename cannot clobber `thumbnail` and a scene save cannot reset `favorite`.
 *
 * `scene_version` is bumped whenever the scene changes, never otherwise. It is
 * the app's optimistic-concurrency token (`schema.ts:35`), so an unrelated rename
 * must not invalidate an in-flight scene save.
 *
 * `trashedAt` is written as an absolute timestamptz from epoch ms, and `null`
 * restores a board. That is how trash and restore are expressed, mirroring
 * `trashBoard`/`restoreBoard`.
 */
const handlePatch = async (
  req: Request,
  id: string,
  uid: string,
  cookie: Headers,
) => {
  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return json({ error: "invalid JSON body" }, 400, cookie);
  }

  const owned = await loadOwned(id, uid);
  if (!owned[0]) {
    return json({ error: "not found" }, 404, cookie);
  }

  const sets: string[] = [];
  const params: unknown[] = [];

  const push = (column: string, value: unknown) => {
    params.push(value);
    sets.push(`${column} = $${params.length}`);
  };

  if (typeof body.name === "string") {
    const trimmed = body.name.trim();
    if (!trimmed) {
      // `renameBoard` refuses a blank name; keeping that here means the UI gets a
      // 400 instead of silently storing an unnamed board.
      return json({ error: "name cannot be empty" }, 400, cookie);
    }
    push("name", trimmed);
  }
  if (typeof body.favorite === "boolean") {
    push("favorite", body.favorite);
  }
  if ("folderId" in body) {
    const folderId =
      typeof body.folderId === "string" && body.folderId ? body.folderId : null;
    if (folderId !== null) {
      const owns = await query(
        "SELECT 1 FROM folders WHERE id = $1 AND owner_uid = $2",
        [folderId, uid],
      );
      if (owns.length === 0) {
        return json({ error: "folder not found" }, 404, cookie);
      }
    }
    push("folder_id", folderId);
  }
  if ("trashedAt" in body) {
    const trashedAt = body.trashedAt;
    // Guard the type: `toIso` maps anything non-numeric to null, which would turn a
    // malformed payload into a silent restore.
    if (trashedAt !== null && typeof trashedAt !== "number") {
      return json(
        { error: "trashedAt must be a timestamp or null" },
        400,
        cookie,
      );
    }
    push("trashed_at", toIso(trashedAt as number | null));
  }
  if (typeof body.thumbnail === "string") {
    push("thumbnail", body.thumbnail);
  }
  if (typeof body.scene === "string") {
    push("scene", body.scene);
    push("scene_bytes", body.scene.length);
    // Bump the concurrency token only for a scene write.
    push("scene_version", owned[0].scene_version + 1);
  }

  if (sets.length === 0) {
    return json({ error: "no updatable fields supplied" }, 400, cookie);
  }

  // updated_at always moves on a successful write, which is what the default
  // "recent" ordering and the card's timestamp render.
  sets.push("updated_at = now()");

  params.push(id, uid);
  const updated = await query<BoardRow>(
    `UPDATE boards SET ${sets.join(", ")}
     WHERE id = $${params.length - 1} AND owner_uid = $${params.length}
     RETURNING ${FULL_COLUMNS}`,
    params,
  );

  if (!updated[0]) {
    return json({ error: "not found" }, 404, cookie);
  }

  const board = toBoard(updated[0]);

  // Audit trail, mirroring `logActivity` in `db/operations.ts`. Written after the
  // update so a failed update cannot leave a phantom event.
  if (typeof body.name === "string") {
    await query(
      "INSERT INTO activity (owner_uid, board_id, type, detail) VALUES ($1, $2, 'rename', $3)",
      [uid, id, (body.name as string).trim()],
    );
  } else if (typeof body.favorite === "boolean") {
    await query(
      "INSERT INTO activity (owner_uid, board_id, type, detail) VALUES ($1, $2, 'favorite', $3)",
      [uid, id, body.favorite ? "on" : "off"],
    );
  } else if ("trashedAt" in body) {
    // Only trashing is audited. `ActivityType` (schema.ts:78) has no "restore"
    // member, and inventing one here would widen the client's union from the
    // server side — restore is already visible as the trashedAt going null.
    if (body.trashedAt !== null) {
      await query(
        "INSERT INTO activity (owner_uid, board_id, type) VALUES ($1, $2, 'delete')",
        [uid, id],
      );
    }
  }

  return json({ board }, 200, cookie);
};

/**
 * `DELETE /api/boards/[id]`
 *
 * Hard delete. Soft delete (trash) is `PATCH {trashedAt: <epoch ms>}`, matching
 * the app's "delete forever" action; this route is the one behind that action and
 * behind the 30-day purge.
 *
 * `activity` rows are removed too. The board's stats chip reads them, so leaving
 * them would show edit counts for a board that no longer exists.
 */
const handleDelete = async (id: string, uid: string, cookie: Headers) => {
  const removed = await query(
    "DELETE FROM boards WHERE id = $1 AND owner_uid = $2 RETURNING id",
    [id, uid],
  );
  if (removed.length === 0) {
    return json({ error: "not found" }, 404, cookie);
  }
  await query("DELETE FROM activity WHERE board_id = $1 AND owner_uid = $2", [
    id,
    uid,
  ]);
  return json({ ok: true }, 200, cookie);
};

export default async function handler(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
): Promise<Response> {
  // Placeholder response whose headers `getOwnerUid` appends the uid cookie to.
  const cookie = new Headers();

  try {
    const uid = getOwnerUid(req, cookie);

    if (!rateLimitOk(uid)) {
      return json({ error: "rate limit exceeded" }, 429, cookie);
    }

    // `params` is a plain object under @vercel/node but a Promise under other
    // runtimes, so it is awaited to cover both; the optional chain keeps a
    // missing param a 400 instead of an unhandled destructuring TypeError.
    const params = await ctx.params;
    const id = params?.id ?? "";

    // Reject a malformed id before it reaches Postgres. An invalid uuid would
    // otherwise raise a 22P02 driver error and surface as a 500, when the client
    // simply sent a bad request.
    if (!isUuid(id)) {
      return json({ error: "invalid board id" }, 400, cookie);
    }

    if (req.method === "GET") {
      return await handleGet(id, uid, cookie);
    }
    if (req.method === "PATCH") {
      return await handlePatch(req, id, uid, cookie);
    }
    if (req.method === "DELETE") {
      return await handleDelete(id, uid, cookie);
    }

    return json({ error: "method not allowed" }, 405, cookie);
  } catch (error) {
    // Log the real cause server-side; return an opaque 500 so driver errors —
    // which can embed the connection URL — never reach a client.
    console.error("[api/boards/[id]]", error);
    return json({ error: "internal error" }, 500, cookie);
  }
}
