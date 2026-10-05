/**
 * Browser-side auth client.
 *
 * Deliberately hand-rolled rather than pulled from a library: there are four calls,
 * all same-origin, and the whole surface is `fetch` plus one cookie the browser
 * already manages. A dependency here would be larger than the code it replaced.
 *
 * `credentials: "include"` is essential on every call. The session lives in an
 * HttpOnly cookie, so it is not visible to this module — without it the browser
 * would omit the cookie and `/api/auth/me` would always answer signed out.
 *
 * In IndexedDB mode (`VITE_API_URL` absent) there is no server to ask, so
 * {@link getSession} reports "signed out" without a request. That is what keeps
 * local development and the e2e suite offline: the anonymous flow is the only one
 * that exists there, and nothing tries to reach an API that is not running.
 */

export type AuthUser = {
  id: string;
  email: string;
  displayName: string | null;
};

/**
 * True when a server-backed API is configured.
 *
 * Presence, not truthiness: production sets `VITE_API_URL=` (empty) because the
 * functions are same-origin, exactly as `lib/storage/index.ts` decides.
 */
const apiUrl = import.meta.env.VITE_API_URL as string | undefined;
export const authEnabled = apiUrl !== undefined;

const base = apiUrl ?? "";

class AuthError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "AuthError";
    this.status = status;
  }
}

const post = async <T>(path: string, body?: unknown): Promise<T> => {
  const res = await fetch(`${base}${path}`, {
    method: "POST",
    credentials: "include",
    ...(body !== undefined
      ? {
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        }
      : {}),
  });
  if (!res.ok) {
    throw new AuthError(res.status, `HTTP ${res.status}`);
  }
  return (await res.json()) as T;
};

/**
 * Asks for a sign-in email.
 *
 * The server answers `{ok:true}` for every accepted address, so a resolved promise
 * genuinely means "the request was accepted" and nothing more. The caller shows
 * "check your email" either way, which is the same message the server's
 * non-disclosure guarantee implies.
 */
export const requestMagicLink = async (email: string): Promise<void> => {
  await post("/api/auth/request-link", { email });
};

/** Signs out. Resolves even if the session was already gone. */
export const signOut = async (): Promise<void> => {
  await post("/api/auth/logout");
};

/** The signed-in user, or null. Never throws for "not signed in". */
export const getSession = async (): Promise<AuthUser | null> => {
  if (!authEnabled) {
    return null;
  }
  const res = await fetch(`${base}/api/auth/me`, { credentials: "include" });
  if (!res.ok) {
    // A 500 must not be reported as "signed out"; that would silently show a Sign
    // in button when the real problem is the server.
    throw new AuthError(res.status, `HTTP ${res.status}`);
  }
  const body = (await res.json()) as { user: AuthUser | null };
  return body.user;
};

/** How much a signed-in user could import from their guest session. */
export type GuestData = { boards: number; folders: number };

/**
 * How many guest rows are waiting to be claimed.
 *
 * Any failure resolves to zeroes rather than rejecting. The caller uses this to
 * decide whether to show a one-time prompt, and a prompt about "we found some
 * boards" is not worth interrupting anyone for when the count could not be
 * determined.
 */
export const getGuestData = async (): Promise<GuestData> => {
  if (!authEnabled) {
    return { boards: 0, folders: 0 };
  }
  try {
    const res = await fetch(`${base}/api/auth/guest-data`, {
      credentials: "include",
    });
    if (!res.ok) {
      return { boards: 0, folders: 0 };
    }
    const body = (await res.json()) as Partial<GuestData>;
    return {
      boards: typeof body.boards === "number" ? body.boards : 0,
      folders: typeof body.folders === "number" ? body.folders : 0,
    };
  } catch {
    return { boards: 0, folders: 0 };
  }
};

/**
 * Moves guest rows onto the signed-in account.
 *
 * Returns what actually moved, read from the response rather than assumed, so the
 * UI can say something truthful if it wants to.
 */
export const claimGuestData = async (): Promise<GuestData> => {
  const body = await post<{ claimed?: Partial<GuestData> }>(
    "/api/auth/claim-guest-data",
  );
  return {
    boards: typeof body.claimed?.boards === "number" ? body.claimed.boards : 0,
    folders:
      typeof body.claimed?.folders === "number" ? body.claimed.folders : 0,
  };
};
