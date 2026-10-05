import { UID_COOKIE, json } from "../_db.js";

import { claimGuestRows, guestUidFor } from "../_owner.js";

import { getSessionUser } from "./_shared.js";

import type { ApiRequest, ApiResponse } from "../_db.js";

/**
 * `POST /api/auth/claim-guest-data` — move guest rows onto the account.
 *
 * This is the "Import" button. It reassigns every row still owned by the anonymous
 * cookie to the signed-in user, then clears that cookie.
 *
 * Clearing the cookie afterwards is not housekeeping, it is what makes the move
 * final. The rows now answer to `user_id`, so the `owner_uid` that used to reach
 * them is dead weight — and leaving a live guest cookie around would let a stale tab
 * keep creating rows under an identity the user has already moved past. Skip does
 * not clear it, so skipping stays genuinely reversible.
 *
 * Idempotent: every statement is guarded by `user_id IS NULL`, so a double-click
 * imports once and reports the same counts. No transaction is used because each
 * statement is independently idempotent and the tables are tiny; wrapping them would
 * buy nothing here.
 *
 * Requires a session. An anonymous caller gets 401 rather than a silent no-op,
 * because "nothing to import" and "you are not signed in" need different reactions
 * from the client.
 */
export default async function handler(
  req: ApiRequest,
  res: ApiResponse,
): Promise<void> {
  try {
    if (req.method !== "POST") {
      res.setHeader("Allow", "POST");
      json(res, { error: "method not allowed" }, 405);
      return;
    }

    const user = await getSessionUser(req);
    if (!user) {
      json(res, { error: "not signed in" }, 401);
      return;
    }

    const guestUid = guestUidFor(req);
    const claimed = await claimGuestRows(user.id, guestUid ?? "");

    // Only drop the cookie if there was something to move, so a no-op import cannot
    // log someone out of their guest session as a side effect.
    if (claimed.boards > 0 || claimed.folders > 0) {
      res.setHeader(
        "Set-Cookie",
        `${UID_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`,
      );
    }

    json(res, { claimed, ok: true });
  } catch (error) {
    console.error("[api/auth/claim-guest-data]", error);
    json(res, { error: "internal error" }, 500);
  }
}
