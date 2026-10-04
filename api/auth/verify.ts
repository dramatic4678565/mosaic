import { query } from "../_db.js";

import {
  consumeMagicLink,
  createSession,
  setSessionCookie,
  upsertUser,
} from "./_shared.js";

import type { ApiRequest, ApiResponse } from "../_db.js";

/**
 * `GET /api/auth/verify?token=…` — redeems a magic link.
 *
 * On success it establishes the session and redirects to `/dashboard`. On failure
 * it redirects to `/login?error=…` rather than rendering JSON, because the only way
 * to arrive here is by clicking a link in an email.
 *
 * The `error` code is deliberately coarse. It says whether the link was already
 * used, expired or unknown, because each of those needs a different action from the
 * user, and none of them reveals anything about an account — the token is the
 * capability, and the caller already has it.
 */
export default async function handler(
  req: ApiRequest,
  res: ApiResponse,
): Promise<void> {
  const params = new URL(req.url ?? "/", "http://localhost").searchParams;
  const token = params.get("token") ?? "";
  const tokenParam = /^[\w-]{1,2048}$/.test(token) ? token : "";

  try {
    const result = await consumeMagicLink(tokenParam);

    if (result.ok === false) {
      // 303 so the browser follows with GET even though the token was in a query
      // string, and so a refresh does not re-POST.
      res.setHeader("Location", `/login?error=${result.reason}`);
      res.status(303).end();
      return;
    }

    const user = await upsertUser(result.email);
    const sessionToken = await createSession(user.id);
    setSessionCookie(res, sessionToken);

    // Opportunistic cleanup, best-effort: a failed sweep must not fail a login.
    // Only rows that can no longer be redeemed or resumed are touched.
    try {
      await query(
        "DELETE FROM magic_links WHERE expires_at < now() - interval '1 day'",
      );
      await query(
        "DELETE FROM sessions WHERE expires_at < now() - interval '1 day'",
      );
    } catch (error) {
      console.warn("[api/auth/verify] cleanup skipped:", error);
    }

    res.setHeader("Location", "/dashboard");
    res.status(303).end();
  } catch (error) {
    // Log the cause; the redirect must not leak it. Driver errors can embed the
    // connection URL.
    console.error("[api/auth/verify]", error);
    res.setHeader("Location", "/login?error=server");
    res.status(303).end();
  }
}
