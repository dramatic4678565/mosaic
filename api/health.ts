import { sql } from "./_db.js";

/**
 * Liveness + database reachability probe.
 *
 * Exists mainly for STEP 6's deploy check (`curl .../api/health`) and for anyone
 * debugging a cold Vercel instance later, so it must never require auth: it
 * touches no user data and reveals nothing beyond "is the DB answering".
 *
 * `export const config` opts this route into the Node.js runtime. `@neondatabase
 * /serverless` is a fetch-based driver, but pinning the runtime keeps the
 * behaviour identical between `vercel dev` and production.
 */
export const config = { runtime: "nodejs" };

/**
 * `SELECT 1` is the cheapest possible query that still proves the whole path
 * works: TCP to the endpoint, TLS, auth, and a real round trip through the pool.
 * `SELECT now()` alone would be equivalent; the literal 1 keeps the intent
 * obvious.
 *
 * A failure is reported as `{ok: false, db: "error"}` with a 503 rather than an
 * unhandled rejection, so monitoring can distinguish "process is up but the
 * database is not" from "the function itself is broken". The underlying message
 * is deliberately not forwarded — driver errors can embed connection details.
 */
export default async function handler(): Promise<Response> {
  try {
    await sql()`SELECT 1`;
    return Response.json({ ok: true, db: "ok", ts: new Date().toISOString() });
  } catch (error) {
    console.error("[api/health] database check failed:", error);
    return Response.json(
      { ok: false, db: "error", ts: new Date().toISOString() },
      { status: 503 },
    );
  }
}
