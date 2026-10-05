import { json, readJson } from "../_db.js";

import {
  appOrigin,
  normalizeEmail,
  requestMagicLink,
  sendMagicLinkEmail,
} from "./_shared.js";

import type { ApiRequest, ApiResponse } from "../_db.js";

/**
 * `POST /api/auth/request-link` — asks for a sign-in email.
 *
 * Always answers `{ok:true}` for a well-formed address, and always with the same
 * body. Any other shape would be an account-existence oracle: an attacker could
 * walk a list of addresses and learn who has an account here.
 *
 * The consequences of that choice, stated plainly:
 *
 * - A rate-limited or un-deliverable request also answers `{ok:true}`, so the user
 *   is told "check your email" and nothing arrives. Telling them otherwise would
 *   leak the same fact the constant response is there to hide.
 * - A malformed address is a 400, because that is a client bug rather than a
 *   statement about any account.
 *
 * The account is *not* created here. It is created at verify time, once the
 * requester has proved they can read the email — otherwise this public endpoint
 * could be used to mint rows for arbitrary addresses.
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

    const body = readJson(req);
    const email = normalizeEmail(body?.email);
    if (email === null) {
      json(res, { error: "a valid email is required" }, 400);
      return;
    }

    const token = await requestMagicLink(email);

    if (token !== null) {
      const url = `${appOrigin(req)}/api/auth/verify?token=${token}`;
      try {
        await sendMagicLinkEmail(email, url);
      } catch (error) {
        // Logged, not surfaced. The caller still gets `{ok:true}` so a provider
        // outage cannot be used to probe which addresses exist.
        console.error("[api/auth/request-link] send failed:", error);
      }
    } else {
      console.warn(`[api/auth/request-link] rate limited for ${email}`);
    }

    json(res, { ok: true });
  } catch (error) {
    console.error("[api/auth/request-link]", error);
    json(res, { error: "internal error" }, 500);
  }
}
