import { json } from "../_db.js";

import { countGuestRows, guestUidFor } from "../_owner.js";

import { getSessionUser } from "./_shared.js";

import type { ApiRequest, ApiResponse } from "../_db.js";

/**
 * `GET /api/auth/guest-data` — what could I import?
 *
 * Powers the one-time "we found N boards from your guest session" prompt. It is a
 * count rather than the rows themselves: the dashboard already knows what its guest
 * data looks like from its own copy, so shipping every scene over the wire just to
 * decide whether to show a modal would be wasteful.
 *
 * Both a session and a guest cookie are required. An anonymous caller always gets
 * zeroes: there is nothing to claim without an account to claim it into, and
 * answering zero lets the client skip the prompt entirely instead of
 * special-casing a signed-out visitor.
 */
export default async function handler(
  req: ApiRequest,
  res: ApiResponse,
): Promise<void> {
  try {
    const user = await getSessionUser(req);
    const guestUid = guestUidFor(req);

    json(
      res,
      user && guestUid
        ? await countGuestRows(user.id, guestUid)
        : { boards: 0, folders: 0 },
    );
  } catch (error) {
    console.error("[api/auth/guest-data]", error);
    json(res, { error: "internal error" }, 500);
  }
}
