import { json } from "../_db.js";

import { getSessionUser } from "./_shared.js";

import type { ApiRequest, ApiResponse } from "../_db.js";

/**
 * `GET /api/auth/me` — who am I?
 *
 * Always 200 with `{user:null}` when signed out, never 401. The dashboard treats
 * "signed out" as its normal state rather than an error, so a 401 here would force
 * every caller to treat the common case as exceptional.
 *
 * Safe to call on every page load and safe to cache nothing: it exposes only the
 * address the browser already belongs to.
 */
export default async function handler(
  _req: ApiRequest,
  res: ApiResponse,
): Promise<void> {
  try {
    const user = await getSessionUser(_req);
    json(res, { user });
  } catch (error) {
    console.error("[api/auth/me]", error);
    json(res, { error: "internal error" }, 500);
  }
}
