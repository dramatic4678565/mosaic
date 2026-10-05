import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Tests for the four auth routes.
 *
 * The database layer is mocked rather than hit. `api/_db.ts` exposes a single
 * `query` seam, so replacing it lets these tests exercise the real token,
 * expiry, single-use and rate-limit logic against a scripted fake while staying
 * hermetic — no Neon database, no network, no Resend.
 *
 * What is asserted here is the behaviour the routes are responsible for. What they
 * are *not* responsible for — that Postgres really enforces uniqueness or really
 * expires a row — was verified directly against Neon in STEP 1.
 */

const state = {
  /** Rows the fake `query` will match, keyed by a fragment of the SQL. */
  handlers: [] as { match: RegExp; rows: unknown[] }[],
  calls: [] as { sql: string; params: unknown[] }[],
};

vi.mock("../_db.js", async () => {
  const actual = await vi.importActual<typeof import("../_db.js")>("../_db.js");
  return {
    ...actual,
    query: vi.fn(async (sql: string, params: unknown[] = []) => {
      state.calls.push({ sql, params });
      for (const h of state.handlers) {
        if (h.match.test(sql)) {
          return h.rows as never;
        }
      }
      return [] as never;
    }),
  };
});

const requestLink = (await import("../auth/request-link.js")).default;
const verify = (await import("../auth/verify.js")).default;
const logout = (await import("../auth/logout.js")).default;
const me = (await import("../auth/me.js")).default;
const { RATE_LIMIT_PER_HOUR } = await import("../auth/_shared.js");

/* -------------------------------------------------------------------------- */
/* Harness                                                                     */
/* -------------------------------------------------------------------------- */

const makeRes = () => {
  const headers: Record<string, string> = {};
  return {
    headers,
    statusCode: 200,
    body: undefined as unknown,
    ended: false,
    setHeader(k: string, v: string) {
      headers[k.toLowerCase()] = v;
    },
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(b: unknown) {
      this.body = b;
    },
    end() {
      this.ended = true;
    },
  };
};

const req = (
  opts: {
    method?: string;
    url?: string;
    headers?: Record<string, string>;
    body?: unknown;
  } = {},
) => ({
  method: opts.method ?? "GET",
  url: opts.url ?? "/api/auth/me",
  headers: opts.headers ?? {},
  body: opts.body,
});

/** A syntactically valid 32-byte hex token, as the helpers generate. */
const TOKEN = "a".repeat(64);

const on = (match: RegExp, rows: unknown[]) => {
  state.handlers.push({ match, rows });
};

const sqlMatching = (fragment: string) =>
  state.calls.filter((c) => c.sql.includes(fragment));

beforeEach(() => {
  state.handlers = [];
  state.calls = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(
      async () =>
        new Response(JSON.stringify({ id: "email-1" }), { status: 200 }),
    ),
  );
  process.env.RESEND_API_KEY = "test-key";
  process.env.NODE_ENV = "test";
});

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.RESEND_API_KEY;
});

/* -------------------------------------------------------------------------- */
/* POST /api/auth/request-link                                                  */
/* -------------------------------------------------------------------------- */

describe("POST /api/auth/request-link", () => {
  it("accepts a valid address and sends a link", async () => {
    on(/count\(\*\)/i, [{ n: 0 }]);
    on(/INSERT INTO magic_links/i, []);

    const res = makeRes();
    await requestLink(
      req({ method: "POST", body: { email: "Someone@Example.COM" } }),
      res,
    );

    expect(res.statusCode).toBe(200);
    // Normalised, so the same person cannot bypass the limit by changing case.
    const insert = sqlMatching("INSERT INTO magic_links");
    expect(insert[0].params[1]).toBe("someone@example.com");
    expect(String(insert[0].params[0])).toMatch(/^[0-9a-f]{64}$/);

    const mail = vi.mocked(fetch).mock.calls[0];
    expect(mail[0]).toBe("https://api.resend.com/emails");
    const sent = JSON.parse(String((mail[1] as RequestInit).body));
    expect(sent.to).toEqual(["someone@example.com"]);
    expect(sent.text).toContain("/api/auth/verify?token=");
    expect(sent.html).toContain("/api/auth/verify?token=");
  });

  it("does not create a user at request time", async () => {
    on(/count\(\*\)/i, [{ n: 0 }]);
    on(/INSERT INTO magic_links/i, []);
    await requestLink(
      req({ method: "POST", body: { email: "a@b.com" } }),
      makeRes(),
    );
    expect(sqlMatching("INSERT INTO users")).toHaveLength(0);
  });

  it("rate limits at 3 per email per hour", async () => {
    on(/count\(\*\)/i, [{ n: RATE_LIMIT_PER_HOUR }]);
    const res = makeRes();
    await requestLink(
      req({ method: "POST", body: { email: "hot@b.com" } }),
      res,
    );

    // No insert and no send, but still a success: reporting the limit would turn
    // this endpoint into an existence oracle.
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ ok: true });
    expect(sqlMatching("INSERT INTO magic_links")).toHaveLength(0);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("returns the same body for an unknown and a known address", async () => {
    on(/count\(\*\)/i, [{ n: 0 }]);
    on(/INSERT INTO magic_links/i, []);
    const a = makeRes();
    await requestLink(
      req({ method: "POST", body: { email: "nobody@example.com" } }),
      a,
    );
    const b = makeRes();
    await requestLink(
      req({ method: "POST", body: { email: "somebody@example.com" } }),
      b,
    );
    expect(a.body).toEqual({ ok: true });
    expect(b.body).toEqual({ ok: true });
  });

  it("rejects a malformed address with 400", async () => {
    for (const email of ["", "nope", "a@b", "a b@c.com", 42, null]) {
      const res = makeRes();
      await requestLink(req({ method: "POST", body: { email } }), res);
      expect(res.statusCode).toBe(400);
    }
    expect(fetch).not.toHaveBeenCalled();
  });

  it("still answers ok:true when Resend fails", async () => {
    on(/count\(\*\)/i, [{ n: 0 }]);
    on(/INSERT INTO magic_links/i, []);
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(JSON.stringify({ message: "boom" }), { status: 500 }),
      ),
    );
    const res = makeRes();
    await requestLink(req({ method: "POST", body: { email: "a@b.com" } }), res);
    // A provider outage must not become an oracle or a 500.
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ ok: true });
  });

  it("rejects a non-POST method", async () => {
    const res = makeRes();
    await requestLink(req({ method: "GET" }), res);
    expect(res.statusCode).toBe(405);
  });
});

/* -------------------------------------------------------------------------- */
/* GET /api/auth/verify                                                         */
/* -------------------------------------------------------------------------- */

describe("GET /api/auth/verify", () => {
  it("redeems a valid token, creates the user and session", async () => {
    on(/UPDATE magic_links SET used_at/i, [{ email: "someone@example.com" }]);
    on(/INSERT INTO users/i, [{ id: "user-1", email: "someone@example.com" }]);
    on(/INSERT INTO sessions/i, []);
    on(/DELETE FROM magic_links/i, []);
    on(/DELETE FROM sessions/i, []);

    const res = makeRes();
    await verify(req({ url: `/api/auth/verify?token=${TOKEN}` }), res);

    expect(res.statusCode).toBe(303);
    expect(res.headers.location).toBe("/dashboard");

    const cookie = res.headers["set-cookie"];
    expect(cookie).toMatch(/^mosaic_session=/);
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("SameSite=Lax");
    // 30 days.
    expect(cookie).toContain(`Max-Age=${30 * 24 * 60 * 60}`);
  });

  it("refuses a token that was already used", async () => {
    // Claim returns nothing (already claimed), then the lookup says used.
    on(/UPDATE magic_links SET used_at/i, []);
    on(/SELECT used_at, expires_at/i, [
      {
        used_at: new Date().toISOString(),
        expires_at: new Date(Date.now() + 60_000).toISOString(),
      },
    ]);

    const res = makeRes();
    await verify(req({ url: `/api/auth/verify?token=${TOKEN}` }), res);

    expect(res.headers.location).toBe("/login?error=used");
    // Critically, no session is minted for a spent token.
    expect(sqlMatching("INSERT INTO sessions")).toHaveLength(0);
  });

  it("refuses an expired token", async () => {
    on(/UPDATE magic_links SET used_at/i, []);
    on(/SELECT used_at, expires_at/i, [
      {
        used_at: null,
        expires_at: new Date(Date.now() - 60_000).toISOString(),
      },
    ]);
    const res = makeRes();
    await verify(req({ url: `/api/auth/verify?token=${TOKEN}` }), res);
    expect(res.headers.location).toBe("/login?error=expired");
    expect(sqlMatching("INSERT INTO sessions")).toHaveLength(0);
  });

  it("refuses an unknown token without querying for it", async () => {
    const res = makeRes();
    await verify(req({ url: "/api/auth/verify?token=not-a-token" }), res);
    expect(res.headers.location).toBe("/login?error=invalid");
    // A malformed token never reaches the database.
    expect(sqlMatching("magic_links")).toHaveLength(0);
  });

  it("marks the token used in the same statement that validates it", async () => {
    on(/UPDATE magic_links SET used_at/i, [{ email: "x@example.com" }]);
    on(/INSERT INTO users/i, [{ id: "u", email: "x@example.com" }]);
    on(/INSERT INTO sessions/i, []);
    on(/DELETE FROM/i, []);
    await verify(req({ url: `/api/auth/verify?token=${TOKEN}` }), makeRes());
    // A read-then-write would let two simultaneous clicks both succeed.
    expect(sqlMatching("UPDATE magic_links")[0].sql).toContain(
      "used_at IS NULL",
    );
  });
});

/* -------------------------------------------------------------------------- */
/* POST /api/auth/logout                                                        */
/* -------------------------------------------------------------------------- */

describe("POST /api/auth/logout", () => {
  it("deletes the session row and clears the cookie", async () => {
    on(/DELETE FROM sessions/i, []);
    const res = makeRes();
    await logout(
      req({ method: "POST", headers: { cookie: `mosaic_session=${TOKEN}` } }),
      res,
    );
    expect(res.statusCode).toBe(200);
    expect(sqlMatching("DELETE FROM sessions")[0].params).toEqual([TOKEN]);
    expect(res.headers["set-cookie"]).toContain("Max-Age=0");
  });

  it("succeeds with no cookie and touches nothing", async () => {
    on(/DELETE FROM sessions/i, []);
    const res = makeRes();
    await logout(req({ method: "POST" }), res);
    expect(res.body).toEqual({ ok: true });
    expect(sqlMatching("DELETE FROM sessions")).toHaveLength(0);
    expect(res.headers["set-cookie"]).toContain("Max-Age=0");
  });

  it("rejects a non-POST method", async () => {
    const res = makeRes();
    await logout(req({ method: "GET" }), res);
    expect(res.statusCode).toBe(405);
  });
});

/* -------------------------------------------------------------------------- */
/* GET /api/auth/me                                                             */
/* -------------------------------------------------------------------------- */

describe("GET /api/auth/me", () => {
  it("returns the signed-in user", async () => {
    on(/FROM sessions s JOIN users u/i, [
      { id: "user-1", email: "someone@example.com", display_name: null },
    ]);
    const res = makeRes();
    await me(req({ headers: { cookie: `mosaic_session=${TOKEN}` } }), res);
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({
      user: { id: "user-1", email: "someone@example.com", displayName: null },
    });
  });

  it("returns user:null with no cookie, without querying", async () => {
    const res = makeRes();
    await me(req(), res);
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ user: null });
    expect(sqlMatching("FROM sessions")).toHaveLength(0);
  });

  it("returns user:null for a garbage cookie", async () => {
    const res = makeRes();
    await me(req({ headers: { cookie: "mosaic_session=nonsense" } }), res);
    expect(res.body).toEqual({ user: null });
  });

  it("lets the database reject an expired session", async () => {
    // Expiry lives in the WHERE clause, so an expired row simply is not returned.
    on(/FROM sessions s JOIN users u/i, []);
    const res = makeRes();
    await me(req({ headers: { cookie: `mosaic_session=${TOKEN}` } }), res);
    expect(res.body).toEqual({ user: null });
    expect(sqlMatching("FROM sessions")[0].sql).toContain("expires_at > now()");
  });

  it("ignores other cookies", async () => {
    on(/FROM sessions s JOIN users u/i, []);
    const res = makeRes();
    await me(req({ headers: { cookie: "mosaic_uid=abc; theme=dark" } }), res);
    expect(res.body).toEqual({ user: null });
  });
});
