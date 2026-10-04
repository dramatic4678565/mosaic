import { randomBytes } from "node:crypto";

import { json, query } from "../_db.js";

import type { ApiRequest, ApiResponse } from "../_db.js";

/**
 * Magic-link authentication: shared helpers only.
 *
 * The leading underscore keeps this out of Vercel's routing, same as `api/_db.ts`.
 *
 * ## Why a magic link and not a password
 *
 * There is no credential to store, reset or leak. Possession of the emailed token
 * *is* the proof, which removes password hashing, breach handling and reset flows
 * from the codebase entirely. The cost is one round trip through the user's inbox
 * on every login, which is the right trade for a whiteboard app.
 *
 * ## Token storage
 *
 * Tokens are stored raw. That is deliberate and not a shortcut: the only way to
 * reach a row is an exact-match lookup with a value the caller already holds, so
 * there is no enumeration surface that hashing would defend against. Hashing would
 * only mean the emailed link could not be looked up directly. The table is not
 * exposed by any route, and rows are short-lived.
 *
 * ## What the user cannot learn
 *
 * `POST /api/auth/request-link` answers `{ok:true}` for every input. A different
 * answer for a known address would turn it into an account-existence oracle, which
 * is why the rate limit is also silent (see {@link requestMagicLink}).
 */

/** Cookie holding the session token. */
export const SESSION_COOKIE = "mosaic_session";

/** How long a magic link stays usable. */
export const MAGIC_LINK_TTL_MIN = 15;

/** Session lifetime, matching the cookie's Max-Age. */
export const SESSION_TTL_DAYS = 30;

/** Magic links allowed per email per hour. */
export const RATE_LIMIT_PER_HOUR = 3;

/** The Resend sender. Overridable so a verified domain can replace the test one. */
const sender = (): string => process.env.RESEND_FROM ?? "onboarding@resend.dev";

/**
 * Rejects addresses that could never be delivered to.
 *
 * This is shape validation only — it exists to catch typos that would otherwise
 * cost a real user a login, not to decide who is allowed an account. The
 * `onboarding@resend.dev` test sender is a much stronger filter, and the
 * {ok:true} response is the same either way.
 */
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/** Lower-cases and trims so `A@B.com` and `a@b.com` are one account. */
export const normalizeEmail = (value: unknown): string | null => {
  if (typeof value !== "string") {
    return null;
  }
  const email = value.trim().toLowerCase();
  return EMAIL_RE.test(email) ? email : null;
};

/** 256 bits of entropy, hex-encoded. */
export const randomToken = (): string => randomBytes(32).toString("hex");

/**
 * Absolute origin to build links against.
 *
 * Prefers `APP_ORIGIN` so a preview deployment emails its own URL rather than
 * whatever host the request happened to arrive on — otherwise a magic link sent
 * from a preview would bounce the user off production, or the reverse. Falls back
 * to the forwarded headers Vercel sets, and finally to a localhost default.
 */
export const appOrigin = (req: ApiRequest): string => {
  const configured = process.env.APP_ORIGIN;
  if (configured) {
    return configured.replace(/\/+$/, "");
  }
  const headers = req.headers;
  const host =
    (Array.isArray(headers.host) ? headers.host[0] : headers.host) ?? "";
  const proto =
    (Array.isArray(headers["x-forwarded-proto"])
      ? headers["x-forwarded-proto"][0]
      : headers["x-forwarded-proto"]) ?? "https";
  return host ? `${proto}://${host}` : "http://localhost:3002";
};

/* -------------------------------------------------------------------------- */
/* Magic links                                                                 */
/* -------------------------------------------------------------------------- */

/** True when this email already hit the hourly cap. */
export const isRateLimited = async (email: string): Promise<boolean> => {
  const rows = await query<{ n: number }>(
    `SELECT count(*)::int AS n FROM magic_links
     WHERE email = $1 AND created_at > now() - interval '1 hour'`,
    [email],
  );
  return (rows[0]?.n ?? 0) >= RATE_LIMIT_PER_HOUR;
};

/** Issues a magic link and returns its token, or null if the caller is capped. */
export const requestMagicLink = async (
  email: string,
): Promise<string | null> => {
  if (await isRateLimited(email)) {
    return null;
  }
  const token = randomToken();
  await query(
    `INSERT INTO magic_links (token, email, expires_at)
     VALUES ($1, $2, now() + ($3 || ' minutes')::interval)`,
    [token, email, String(MAGIC_LINK_TTL_MIN)],
  );
  return token;
};

export type ConsumeResult =
  | { ok: true; email: string }
  | { ok: false; reason: "invalid" | "used" | "expired" };

/**
 * Validates a magic link and marks it used, in one statement.
 *
 * The `used_at IS NULL` predicate is inside the UPDATE rather than checked in JS
 * on a prior read, so two simultaneous clicks cannot both succeed: the second
 * finds no row to update and is reported as `used`. A read-then-write would race.
 */
export const consumeMagicLink = async (
  token: string,
): Promise<ConsumeResult> => {
  if (!/^[0-9a-f]{64}$/.test(token)) {
    // Not even a token we could have issued; skip the query entirely.
    return { ok: false, reason: "invalid" };
  }

  const claimed = await query<{ email: string }>(
    `UPDATE magic_links SET used_at = now()
     WHERE token = $1 AND used_at IS NULL AND expires_at > now()
     RETURNING email`,
    [token],
  );

  if (claimed.length > 0) {
    return { ok: true, email: claimed[0].email };
  }

  // Nothing was claimed, so it is either already used or expired. Distinguishing
  // matters for the message the user sees.
  const existing = await query<{ used_at: string | null; expires_at: string }>(
    "SELECT used_at, expires_at FROM magic_links WHERE token = $1",
    [token],
  );
  if (existing.length === 0) {
    return { ok: false, reason: "invalid" };
  }
  return {
    ok: false,
    reason: new Date(existing[0].expires_at) <= new Date() ? "expired" : "used",
  };
};

/* -------------------------------------------------------------------------- */
/* Users and sessions                                                          */
/* -------------------------------------------------------------------------- */

/**
 * Returns the user for an email, creating one on first verified login.
 *
 * Creation happens here rather than at request-link time so that requesting a link
 * never creates an account: an attacker could otherwise mint rows for arbitrary
 * addresses by hitting the public endpoint.
 *
 * The upsert also refreshes `last_login_at`, which is why it is a single statement.
 */
export const upsertUser = async (
  email: string,
): Promise<{ id: string; email: string }> => {
  const rows = await query<{ id: string; email: string }>(
    `INSERT INTO users (email, last_login_at) VALUES ($1, now())
     ON CONFLICT (email) DO UPDATE SET last_login_at = now()
     RETURNING id, email`,
    [email],
  );
  return rows[0];
};

export const createSession = async (userId: string): Promise<string> => {
  const token = randomToken();
  await query(
    `INSERT INTO sessions (token, user_id, expires_at)
     VALUES ($1, $2, now() + ($3 || ' days')::interval)`,
    [token, userId, String(SESSION_TTL_DAYS)],
  );
  return token;
};

export type SessionUser = {
  id: string;
  email: string;
  displayName: string | null;
};

/**
 * Resolves the signed-in user from the session cookie, or null.
 *
 * Expiry is checked in SQL rather than in JS so an expired session is never
 * handed back even if the cookie is still being sent.
 */
export const getSessionUser = async (
  req: ApiRequest,
): Promise<SessionUser | null> => {
  const raw = req.headers.cookie;
  const header = Array.isArray(raw) ? raw.join("; ") : raw;
  if (!header) {
    return null;
  }
  let token: string | undefined;
  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq !== -1 && part.slice(0, eq).trim() === SESSION_COOKIE) {
      token = decodeURIComponent(part.slice(eq + 1).trim());
    }
  }
  if (!token || !/^[0-9a-f]{64}$/.test(token)) {
    return null;
  }

  const rows = await query<{
    id: string;
    email: string;
    display_name: string | null;
  }>(
    `SELECT u.id, u.email, u.display_name
     FROM sessions s JOIN users u ON u.id = s.user_id
     WHERE s.token = $1 AND s.expires_at > now()`,
    [token],
  );
  if (rows.length === 0) {
    return null;
  }
  return {
    id: rows[0].id,
    email: rows[0].email,
    displayName: rows[0].display_name,
  };
};

export const destroySession = async (token: string): Promise<void> => {
  await query("DELETE FROM sessions WHERE token = $1", [token]);
};

/* -------------------------------------------------------------------------- */
/* Cookies                                                                     */
/* -------------------------------------------------------------------------- */

/** Reads the raw session token out of a request, without touching the database. */
export const readSessionToken = (req: ApiRequest): string | null => {
  const raw = req.headers.cookie;
  const header = Array.isArray(raw) ? raw.join("; ") : raw;
  if (!header) {
    return null;
  }
  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq !== -1 && part.slice(0, eq).trim() === SESSION_COOKIE) {
      return decodeURIComponent(part.slice(eq + 1).trim());
    }
  }
  return null;
};

/**
 * Sets the session cookie.
 *
 * HttpOnly so script cannot read it, SameSite=Lax so it is not attached to
 * cross-site POSTs, and Secure in production because a session bearer over plain
 * http would be trivially interceptable.
 */
export const setSessionCookie = (res: ApiResponse, token: string): void => {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  res.setHeader(
    "Set-Cookie",
    `${SESSION_COOKIE}=${encodeURIComponent(
      token,
    )}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${
      SESSION_TTL_DAYS * 24 * 60 * 60
    }${secure}`,
  );
};

/** Clears the session cookie. The Max-Age is what makes it a deletion. */
export const clearSessionCookie = (res: ApiResponse): void => {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  res.setHeader(
    "Set-Cookie",
    `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure}`,
  );
};

/* -------------------------------------------------------------------------- */
/* Email                                                                       */
/* -------------------------------------------------------------------------- */

const escapeHtml = (value: string): string =>
  value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

/**
 * Sends the magic link.
 *
 * Throws on failure. Callers must decide what to tell the user, and `request-link`
 * deliberately swallows the error: a Resend outage should not turn into a 500 that
 * reveals which infrastructure is behind the endpoint.
 */
export const sendMagicLinkEmail = async (
  to: string,
  url: string,
): Promise<void> => {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    throw new Error("RESEND_API_KEY is not set");
  }

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: `Mosaic <${sender()}>`,
      to: [to],
      subject: "Your Mosaic sign-in link",
      text: [
        "Sign in to Mosaic:",
        "",
        url,
        "",
        `This link works once and expires in ${MAGIC_LINK_TTL_MIN} minutes.`,
        "If you did not ask for it, you can ignore this email.",
      ].join("\n"),
      html: [
        "<p>Sign in to Mosaic:</p>",
        `<p><a href="${escapeHtml(url)}">Sign in</a></p>`,
        `<p style="color:#666;font-size:13px">This link works once and expires in ${MAGIC_LINK_TTL_MIN} minutes. If you did not ask for it, you can ignore this email.</p>`,
      ].join(""),
    }),
  });

  if (!res.ok) {
    const detail = await res.json().catch(() => ({}));
    throw new Error(
      `Resend rejected the send (${res.status}): ${
        (detail as { message?: string })?.message ?? "unknown"
      }`,
    );
  }
};

export { json };
