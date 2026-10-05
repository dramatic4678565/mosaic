import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Tests for the guest-claim routes and the ownership scoping they depend on.
 *
 * The database is mocked through the same `query` seam as the auth tests, and
 * `getSessionUser` is mocked so a request can be made to look signed in or signed
 * out. What is asserted is the part that would be dangerous to get wrong: which
 * column a query scopes by, and whether the claim is guarded so it cannot run twice.
 */

const state = {
  handlers: [] as { match: RegExp; rows: unknown[] }[],
  calls: [] as { sql: string; params: unknown[] }[],
  session: null as {
    id: string;
    email: string;
    displayName: string | null;
  } | null,
  /**
   * What the signed guest cookie resolves to.
   *
   * Mocked rather than forged: the real `readGuestUid` verifies an HMAC, so a test
   * would otherwise have to generate a valid signature merely to say "this request
   * carries a guest identity", which is not the thing under test.
   */
  guestUid: "guest-1" as string | null,
};

vi.mock("../_db.js", async () => {
  const actual = await vi.importActual<typeof import("../_db.js")>("../_db.js");
  return {
    ...actual,
    readGuestUid: vi.fn(() => state.guestUid),
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

vi.mock("../auth/_shared.js", async () => {
  const actual = await vi.importActual<typeof import("../auth/_shared.js")>(
    "../auth/_shared.js",
  );
  return {
    ...actual,
    getSessionUser: vi.fn(async () => state.session),
  };
});

const guestData = (await import("../auth/guest-data.js")).default;
const claim = (await import("../auth/claim-guest-data.js")).default;
const { ownerScope, ownerColumn, claimGuestRows, countGuestRows } =
  await import("../_owner.js");

const makeRes = () => {
  const headers: Record<string, string> = {};
  return {
    headers,
    statusCode: 200,
    body: undefined as unknown,
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
      return this;
    },
  };
};

const req = (
  over: {
    method?: string;
    url?: string;
    headers?: Record<string, string>;
  } = {},
) => ({
  method: over.method ?? "GET",
  url: over.url ?? "/api/auth/guest-data",
  headers: over.headers ?? {},
});

const on = (match: RegExp, rows: unknown[]) => {
  state.handlers.push({ match, rows });
};
const sqls = (fragment: string) =>
  state.calls.filter((c) => c.sql.includes(fragment));

const USER = { id: "user-1", email: "someone@example.com", displayName: null };

beforeEach(() => {
  state.handlers = [];
  state.calls = [];
  state.session = null;
  state.guestUid = "guest-1";
});

/* -------------------------------------------------------------------------- */
/* Ownership scoping                                                            */
/* -------------------------------------------------------------------------- */

describe("ownerScope", () => {
  it("scopes by user_id when signed in", () => {
    const s = ownerScope({ userId: "u1", ownerUid: "" });
    expect(s.sql).toBe("b.user_id = $1");
    expect(s.params).toEqual(["u1"]);
  });

  it("scopes by owner_uid when anonymous, but only unclaimed rows", () => {
    const s = ownerScope({ userId: null, ownerUid: "guest-1" });
    // The `user_id IS NULL` guard is what makes a claim final: `owner_uid` is NOT
    // NULL and cannot be cleared, so without this a captured guest cookie would keep
    // reading rows that now belong to an account.
    expect(s.sql).toBe("b.owner_uid = $1 AND b.user_id IS NULL");
    expect(s.params).toEqual(["guest-1"]);
  });

  it("honours the table alias, so folders get f.user_id", () => {
    expect(ownerScope({ userId: "u1", ownerUid: "" }, "f").sql).toBe(
      "f.user_id = $1",
    );
  });
});

describe("ownerColumn", () => {
  it("writes user_id for a signed-in create and owner_uid otherwise", () => {
    expect(ownerColumn({ userId: "u1", ownerUid: "" })).toEqual({
      column: "user_id",
      value: "u1",
    });
    expect(ownerColumn({ userId: null, ownerUid: "g1" })).toEqual({
      column: "owner_uid",
      value: "g1",
    });
  });
});

/* -------------------------------------------------------------------------- */
/* GET /api/auth/guest-data                                                     */
/* -------------------------------------------------------------------------- */

describe("GET /api/auth/guest-data", () => {
  it("reports what is waiting to be imported", async () => {
    state.session = USER;
    on(/count\(\*\)/i, [{ boards: 3, folders: 1 }]);
    const res = makeRes();
    await guestData(req(), res);
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ boards: 3, folders: 1 });
  });

  it("reports zeroes for an anonymous caller without querying", async () => {
    state.session = null;
    const res = makeRes();
    await guestData(req(), res);
    // There is no account to import into, so there is nothing to ask about.
    expect(res.body).toEqual({ boards: 0, folders: 0 });
    expect(state.calls).toHaveLength(0);
  });

  it("reports zeroes for a signed-in user with no guest cookie", async () => {
    // The case that actually happens when someone signs in on a fresh browser: a
    // session, but never an anonymous identity to import from. Without this the
    // client would prompt about zero boards on every visit.
    state.session = USER;
    state.guestUid = null;
    const res = makeRes();
    await guestData(req(), res);
    expect(res.body).toEqual({ boards: 0, folders: 0 });
    expect(state.calls).toHaveLength(0);
  });
});

/* -------------------------------------------------------------------------- */
/* POST /api/auth/claim-guest-data                                             */
/* -------------------------------------------------------------------------- */

describe("POST /api/auth/claim-guest-data", () => {
  it("moves rows, clears the guest cookie and reports the counts", async () => {
    state.session = USER;
    on(/count\(\*\)/i, [{ boards: 4, folders: 2 }]);
    on(/UPDATE boards SET user_id/i, []);
    on(/UPDATE folders SET user_id/i, []);

    const res = makeRes();
    await claim(req({ method: "POST" }), res);

    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ claimed: { boards: 4, folders: 2 }, ok: true });

    const boardUpdate = sqls("UPDATE boards SET user_id")[0];
    expect(boardUpdate.params).toEqual(["user-1", "guest-1"]);
    // Guarded, so a second click cannot double-claim.
    expect(boardUpdate.sql).toContain("user_id IS NULL");

    // The cookie is what made those rows reachable; dropping it is what finalises
    // the move.
    expect(res.headers["set-cookie"]).toContain("mosaic_uid=");
    expect(res.headers["set-cookie"]).toContain("Max-Age=0");
  });

  it("refuses an anonymous caller with 401", async () => {
    state.session = null;
    const res = makeRes();
    await claim(req({ method: "POST" }), res);
    expect(res.statusCode).toBe(401);
    // A no-op would leave the client unable to tell "nothing to do" from "not
    // signed in", which need different reactions.
    expect(sqls("UPDATE boards")).toHaveLength(0);
  });

  it("does not touch the cookie when there was nothing to import", async () => {
    state.session = USER;
    on(/count\(\*\)/i, [{ boards: 0, folders: 0 }]);
    const res = makeRes();
    await claim(req({ method: "POST" }), res);
    expect(res.body).toEqual({ claimed: { boards: 0, folders: 0 }, ok: true });
    // Otherwise a stray import would silently log the user out of their guest
    // session for nothing.
    expect(res.headers["set-cookie"]).toBeUndefined();
    expect(sqls("UPDATE boards")).toHaveLength(0);
  });

  it("rejects a non-POST method", async () => {
    state.session = USER;
    const res = makeRes();
    await claim(req({ method: "GET" }), res);
    expect(res.statusCode).toBe(405);
  });
});

/* -------------------------------------------------------------------------- */
/* claimGuestRows / countGuestRows                                             */
/* -------------------------------------------------------------------------- */

describe("claimGuestRows", () => {
  it("is a no-op without an account", async () => {
    expect(await claimGuestRows("", "g1")).toEqual({
      boards: 0,
      folders: 0,
    });
    expect(state.calls).toHaveLength(0);
  });

  it("returns early rather than issuing two pointless UPDATEs", async () => {
    state.session = USER;
    on(/count\(\*\)/i, [{ boards: 0, folders: 0 }]);
    await claimGuestRows("user-1", "guest-1");
    expect(sqls("UPDATE boards SET user_id")).toHaveLength(0);
    expect(sqls("UPDATE folders SET user_id")).toHaveLength(0);
  });

  it("preserves folder ids so board.folder_id keeps resolving", async () => {
    state.session = USER;
    on(/count\(\*\)/i, [{ boards: 1, folders: 1 }]);
    on(/UPDATE/i, []);
    await claimGuestRows("user-1", "guest-1");
    // An UPDATE, never an INSERT: regenerating ids would orphan every filed board.
    for (const call of sqls("UPDATE")) {
      expect(call.sql).not.toMatch(/INSERT/i);
    }
  });
});

describe("countGuestRows", () => {
  it("only counts rows that are still unclaimed", async () => {
    state.session = USER;
    on(/count\(\*\)/i, [{ boards: 2, folders: 0 }]);
    await countGuestRows("user-1", "guest-1");
    const q = state.calls[0].sql;
    expect(q).toContain("user_id IS NULL");
    expect(state.calls[0].params).toEqual(["guest-1"]);
  });
});
