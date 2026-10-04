import { json, sql } from "./_db.js";

import type { ApiRequest, ApiResponse } from "./_db.js";

/**
 * Liveness + database reachability probe.
 *
 * Exists mainly for the deploy check (`curl .../api/health`) and for anyone
 * debugging a cold Vercel instance later, so it must never require auth: it
 * touches no user data and reveals nothing beyond "is the DB answering".
 *
 * `SELECT 1` is the cheapest possible query that still proves the whole path
 * works: TCP to the endpoint, TLS, auth, and a real round trip through the pool.
 * A `SELECT now()` would be equivalent; the literal 1 keeps the intent obvious.
 *
 * A failure is reported as `503 {ok:false}` rather than an unhandled rejection,
 * so monitoring can tell "the process is up but the database is not" from "the
 * function itself is broken". The underlying message is deliberately not
 * forwarded: driver errors can embed the connection URL.
 */
export default async function handler(
  _req: ApiRequest,
  res: ApiResponse,
): Promise<void> {
  try {
    await sql()`SELECT 1`;
    json(res, { ok: true, db: "ok", ts: new Date().toISOString() });
  } catch (error) {
    console.error("[api/health] database check failed:", error);
    json(res, { ok: false, db: "error", ts: new Date().toISOString() }, 503);
  }
}
