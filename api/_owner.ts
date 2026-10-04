/**
 * Who a request is acting as, and the one rule that follows from it.
 *
 * Mosaic has two identity schemes at once, and this module is where they meet:
 *
 * - **Anonymous** — a signed `mosaic_uid` cookie, scoping rows by `owner_uid`.
 *   This is the original local-first behaviour and it still works with no account.
 * - **Authenticated** — a `mosaic_session` cookie resolving to `users.id`,
 *   scoping rows by `user_id`.
 *
 * A signed-in request is scoped by `user_id` only, never by `owner_uid`. That is
 * deliberate and is the reason the claim flow in STEP 4 works: after an import, the
 * rows carry a `user_id` and the anonymous cookie is dropped, so reads have to be
 * able to find them. It also means two browsers signed into one account see the
 * same boards — which is the entire point of having an account.
 *
 * The corollary, and the reason `mosaic_uid` is still read at all: a signed-in user
 * who has *not* claimed their guest data sees an empty grid, because their guest
 * rows are still owned by the cookie. That is what the "we found N boards from
 * your guest session" prompt is for.
 */

import { getOwnerUid, query, readGuestUid } from "./_db.js";

import { getSessionUser } from "./auth/_shared.js";

import type { ApiRequest, ApiResponse } from "./_db.js";

export type Actor = {
  /** Set when signed in. Rows are then scoped by this, not by `ownerUid`. */
  userId: string | null;
  /** Always set. Scopes rows for an anonymous request. */
  ownerUid: string;
};

/**
 * Resolves the actor for a request, minting an anonymous cookie if needed.
 *
 * A session that exists but has expired is treated as *not signed in* rather than
 * as an error: the visitor should fall back to the anonymous flow and see their
 * local boards, not hit a wall.
 */
export const resolveActor = async (
  req: ApiRequest,
  res: ApiResponse,
): Promise<Actor> => {
  const user = await getSessionUser(req);
  if (user) {
    return { userId: user.id, ownerUid: "" };
  }
  return { userId: null, ownerUid: getOwnerUid(req, res) };
};

/**
 * The WHERE fragment and parameter that scope a `boards` or `folders` query.
 *
 * Returned rather than inlined so no query can forget the branch: a missed scope
 * is a cross-account data leak, and the failure mode would be invisible in review.
 *
 * The anonymous branch carries `AND user_id IS NULL`, and that clause is the whole
 * reason a claim is final. Claiming sets `user_id` but cannot clear `owner_uid`,
 * which is `NOT NULL`; without this guard a guest cookie that had been captured
 * before the claim would keep granting read access to rows that now belong to an
 * account. The same predicate is what makes the claim idempotent, so the invariant
 * is stated once and used everywhere.
 */
export const ownerScope = (actor: Actor, column: "b" | "f" = "b") => ({
  sql: actor.userId
    ? `${column}.user_id = $1`
    : `${column}.owner_uid = $1 AND ${column}.user_id IS NULL`,
  params: [actor.userId ?? actor.ownerUid] as unknown[],
});

/** Column an insert must set so the row is reachable by its creator. */
export const ownerColumn = (actor: Actor): { column: string; value: string } =>
  actor.userId
    ? { column: "user_id", value: actor.userId }
    : { column: "owner_uid", value: actor.ownerUid };

/**
 * The guest uid a claim would move rows from.
 *
 * Note this is *not* `actor.ownerUid`: for a signed-in request that is deliberately
 * empty, because reads scope by `user_id`. The guest identity has to be read from
 * the cookie itself, which is also why {@link readGuestUid} never mints a new one.
 */
export const guestUidFor = (req: ApiRequest): string | null =>
  readGuestUid(req);

/** Counts what a signed-in user could import from their guest session. */
export const countGuestRows = async (
  userId: string,
  guestUid: string,
): Promise<{ boards: number; folders: number }> => {
  if (!userId || !guestUid) {
    return { boards: 0, folders: 0 };
  }
  const rows = await query<{ boards: number; folders: number }>(
    `SELECT
       (SELECT count(*)::int FROM boards
         WHERE owner_uid = $1 AND user_id IS NULL) AS boards,
       (SELECT count(*)::int FROM folders
         WHERE owner_uid = $1 AND user_id IS NULL) AS folders`,
    [guestUid],
  );
  return rows[0] ?? { boards: 0, folders: 0 };
};

/**
 * Moves guest rows onto the signed-in account.
 *
 * Every statement is guarded by `user_id IS NULL`, which makes the whole thing
 * idempotent: pressing Import twice moves nothing the second time rather than
 * erroring or duplicating. That also means a concurrent double-click cannot
 * double-claim.
 *
 * `activity` is deliberately left alone. Its rows are written by whichever uid
 * performed the action and are read by `board_id`, so once the boards move the
 * history follows them automatically.
 *
 * Folder ids are preserved rather than regenerated, so a board's `folder_id` keeps
 * pointing at the right folder after the move.
 */
export const claimGuestRows = async (
  userId: string,
  guestUid: string,
): Promise<{ boards: number; folders: number }> => {
  if (!userId || !guestUid) {
    return { boards: 0, folders: 0 };
  }

  const before = await countGuestRows(userId, guestUid);
  if (before.boards === 0 && before.folders === 0) {
    return before;
  }

  await query(
    "UPDATE boards SET user_id = $1 WHERE owner_uid = $2 AND user_id IS NULL",
    [userId, guestUid],
  );
  await query(
    "UPDATE folders SET user_id = $1 WHERE owner_uid = $2 AND user_id IS NULL",
    [userId, guestUid],
  );

  return before;
};
