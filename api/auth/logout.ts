import { json } from "../_db.js";

import {
  clearSessionCookie,
  destroySession,
  readSessionToken,
} from "./_shared.js";

import type { ApiRequest, ApiResponse } from "../_db.js";

/**
 * `POST /api/auth/logout` — ends the session.
 *
 * The row is deleted, not just the cookie: a stolen cookie is only useless once
 * the row it names is gone. The cookie is cleared either way, so signing out works
 * even if the row was already gone.
 *
 * Answers `{ok:true}` whether or not a session existed. Reporting "you were not
 * signed in" would leak whether a given cookie was valid.
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

    const token = readSessionToken(req);
    if (token) {
      await destroySession(token);
    }
    clearSessionCookie(res);

    json(res, { ok: true });
  } catch (error) {
    console.error("[api/auth/logout]", error);
    json(res, { error: "internal error" }, 500);
  }
}
