import { randomUUID } from "node:crypto";

/**
 * In-memory stand-in for the serverless API, for the auth e2e suite.
 *
 * ## Why this exists
 *
 * The dashboard only talks to a server when `VITE_API_URL` is defined, and the main
 * e2e suite deliberately leaves it undefined so it stays hermetic and IndexedDB-only.
 * That is right for CRUD coverage and wrong for accounts: the magic-link journey,
 * the guest hand-off and sharing cannot be exercised at all without a server.
 *
 * So this provides one, in memory, for a suite that needs it.
 *
 * ## What it is faithful to
 *
 * The behaviours that the specs actually assert, taken from the real handlers rather
 * than invented here:
 *
 * - `request-link` answers `{ok:true}` for every accepted address, always.
 * - A magic link is single-use and expires; a second click lands on `?error=used`.
 * - `me` answers `{user:null}` rather than 401 when signed out.
 * - A signed-in request is scoped by user, an anonymous one by cookie uid.
 * - `claim-guest-data` moves unclaimed rows and is idempotent.
 * - The public share route needs no session, serves only live boards, and answers
 *   the same 404 for unknown and revoked tokens.
 *
 * ## What it is not
 *
 * It is not a second implementation to keep in step with production. It exists so a
 * browser can be driven through the flows; the real handlers are verified against
 * Postgres directly, and their logic is unit tested. If the two disagree, the unit
 * tests are the ones that should change.
 *
 * ## Reaching a magic link
 *
 * There is no mailbox. `GET /__test__/last-magic-link` returns the most recently
 * issued token and its email, which is what lets a spec follow the link the way a
 * person would after clicking it in their inbox. It is namespaced under `/__test__`
 * so it cannot collide with a real route, and the whole module is only mounted when
 * `MOCK_API=1`.
 */

/** uid -> { boards: Map, folders: Map } for anonymous visitors. */
const guests = new Map();
/** userId -> { id, email } */
const users = new Map();
/** email -> userId */
const usersByEmail = new Map();
/** token -> { userId, expiresAt } */
const sessions = new Map();
/** token -> { email, expiresAt, usedAt } */
const magicLinks = new Map();
/** email -> timestamps, for the hourly cap. */
const linkRequests = new Map();

const RATE_LIMIT_PER_HOUR = 3;
const MAGIC_LINK_TTL_MS = 15 * 60 * 1000;
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

let lastMagicLink = null;
/** Count of emails the mock "sent", so a spec can assert one was attempted. */
let sendAttempts = 0;

const now = () => Date.now();
const token = () =>
  randomUUID().replace(/-/g, "") + randomUUID().replace(/-/g, "");

/* -------------------------------------------------------------------------- */
/* Cookies                                                                     */
/* -------------------------------------------------------------------------- */

const parseCookies = (header) => {
  const out = {};
  for (const part of (header ?? "").split(";")) {
    const eq = part.indexOf("=");
    if (eq > 0) {
      out[part.slice(0, eq).trim()] = decodeURIComponent(
        part.slice(eq + 1).trim(),
      );
    }
  }
  return out;
};

const setCookie = (res, name, value, maxAgeSeconds) => {
  const headers = res.getHeader("Set-Cookie");
  const cookie = `${name}=${encodeURIComponent(
    value,
  )}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAgeSeconds}`;
  res.setHeader("Set-Cookie", headers ? [].concat(headers, cookie) : cookie);
};

/**
 * Who the request is acting as.
 *
 * `guestUid` is read from the cookie **regardless of the session**, which is what the
 * real `guestUidFor` does and what the claim flow depends on: a signed-in visitor
 * still carries the cookie from when they were anonymous, and that is precisely the
 * identity whose rows are waiting to be claimed.
 *
 * A cookie is only minted when there is no session *and* the caller asks for one,
 * mirroring `getOwnerUid`. That condition is load-bearing: calling this with
 * `mint: true` on `/api/auth/verify` would set a *fresh* `mosaic_uid` and overwrite
 * the cookie the visitor arrived with, making the guest boards they were about to
 * claim unreachable. The real `verify` never touches `getOwnerUid`, and a mock that
 * did would break the claim flow in a way that looks like a product bug.
 */
const actorFor = (req, res, { mint = true } = {}) => {
  const cookies = parseCookies(req.headers.cookie);
  const sessionToken = cookies.mosaic_session;
  if (sessionToken) {
    const session = sessions.get(sessionToken);
    if (session && session.expiresAt > now()) {
      const user = users.get(session.userId);
      if (user) {
        if (cookies.mosaic_uid && !guests.has(cookies.mosaic_uid)) {
          guests.set(cookies.mosaic_uid, {
            boards: new Map(),
            folders: new Map(),
          });
        }
        return { userId: user.id, user, guestUid: cookies.mosaic_uid ?? null };
      }
    }
  }

  if (!mint) {
    return { userId: null, user: null, guestUid: cookies.mosaic_uid ?? null };
  }

  let guestUid = cookies.mosaic_uid;
  if (!guestUid) {
    guestUid = randomUUID();
    setCookie(res, "mosaic_uid", guestUid, SESSION_TTL_MS / 1000);
  }
  if (!guests.has(guestUid)) {
    guests.set(guestUid, { boards: new Map(), folders: new Map() });
  }
  return { userId: null, user: null, guestUid };
};

/** The store a request reads and writes, chosen the same way production does. */
const storeFor = (actor) => {
  if (actor.userId) {
    const user = users.get(actor.userId);
    let store = user.store;
    if (!store) {
      store = { boards: new Map(), folders: new Map() };
      user.store = store;
    }
    return store;
  }
  return guests.get(actor.guestUid);
};

const newBoard = (name) => ({
  id: randomUUID(),
  name,
  folderId: null,
  favorite: false,
  trashedAt: null,
  thumbnail: null,
  scene: null,
  sceneVersion: 0,
  createdAt: now(),
  updatedAt: now(),
  lastOpenedAt: null,
});

/* -------------------------------------------------------------------------- */
/* Handlers                                                                    */
/* -------------------------------------------------------------------------- */

const readBody = async (req) => {
  const chunks = [];
  for await (const chunk of req) {
    chunks.push(chunk);
  }
  if (chunks.length === 0) {
    return {};
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8")) ?? {};
  } catch {
    return {};
  }
};

/**
 * Builds the set-cookie header the editor's share mode and the browser both need,
 * for a session that has just been established.
 */
const establishSession = (res, userId) => {
  const sessionToken = token();
  sessions.set(sessionToken, {
    userId,
    expiresAt: now() + SESSION_TTL_MS,
  });
  setCookie(res, "mosaic_session", sessionToken, SESSION_TTL_MS / 1000);
};

/**
 * Routes one request. Returns true when it handled it.
 *
 * Everything is under a single function rather than a table of handlers because the
 * routes share almost all of their state, and splitting them would mean passing the
 * same four maps around.
 */
export const handleMockApi = async (req, res, url) => {
  const path = url.pathname;

  if (!path.startsWith("/api/") && !path.startsWith("/__test__/")) {
    return false;
  }

  const send = (status, body, headers = {}) => {
    res.writeHead(status, {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      ...headers,
    });
    res.end(JSON.stringify(body));
  };

  /* ---- test-only hooks ---- */

  if (path === "/__test__/last-magic-link") {
    send(200, { link: lastMagicLink, sendAttempts });
    return true;
  }
  if (path === "/__test__/reset" && req.method === "POST") {
    guests.clear();
    users.clear();
    usersByEmail.clear();
    sessions.clear();
    magicLinks.clear();
    linkRequests.clear();
    lastMagicLink = null;
    sendAttempts = 0;
    send(200, { ok: true });
    return true;
  }

  /**
   * Resolved per route rather than once up front.
   *
   * The auth routes must not mint a guest cookie: `request-link`, `verify`, `logout`
   * and `me` do not call `getOwnerUid` in production, and minting on `verify` in
   * particular would replace the cookie a visitor arrived with. The board routes do
   * need one, because an anonymous create has to be attributable.
   */
  const actor = () => actorFor(req, res);

  /* ---- auth ---- */

  if (path === "/api/auth/request-link" && req.method === "POST") {
    actorFor(req, res, { mint: false });
    const body = await readBody(req);
    const email =
      typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) {
      send(400, { error: "a valid email is required" });
      return true;
    }

    const cutoff = now() - 60 * 60 * 1000;
    const recent = (linkRequests.get(email) ?? []).filter((t) => t > cutoff);
    if (recent.length < RATE_LIMIT_PER_HOUR) {
      recent.push(now());
      linkRequests.set(email, recent);

      const magicToken = token();
      magicLinks.set(magicToken, {
        email,
        expiresAt: now() + MAGIC_LINK_TTL_MS,
        usedAt: null,
      });
      lastMagicLink = {
        token: magicToken,
        email,
        url: `/api/auth/verify?token=${magicToken}`,
      };
      sendAttempts += 1;
    }

    // Always the same body: an existence oracle is not a thing this mock has.
    send(200, { ok: true });
    return true;
  }

  if (path === "/api/auth/verify") {
    const magicToken = url.searchParams.get("token") ?? "";
    const link = magicLinks.get(magicToken);

    let error = "invalid";
    if (link) {
      if (link.usedAt) {
        error = "used";
      } else if (link.expiresAt <= now()) {
        error = "expired";
      } else {
        link.usedAt = now();
        let user = usersByEmail.get(link.email);
        if (!user) {
          const created = {
            id: randomUUID(),
            email: link.email,
            displayName: null,
            store: { boards: new Map(), folders: new Map() },
          };
          users.set(created.id, created);
          usersByEmail.set(link.email, created.id);
          user = created.id;
        }
        establishSession(res, user);
        res.writeHead(303, { location: "/dashboard" });
        res.end();
        return true;
      }
    }

    res.writeHead(303, { location: `/login?error=${error}` });
    res.end();
    return true;
  }

  if (path === "/api/auth/logout" && req.method === "POST") {
    const cookies = parseCookies(req.headers.cookie);
    if (cookies.mosaic_session) {
      sessions.delete(cookies.mosaic_session);
    }
    setCookie(res, "mosaic_session", "", 0);
    send(200, { ok: true });
    return true;
  }

  if (path === "/api/auth/me") {
    const who = actorFor(req, res, { mint: false });
    send(200, {
      user: who.user
        ? { id: who.user.id, email: who.user.email, displayName: null }
        : null,
    });
    return true;
  }

  /* ---- guest claim ---- */

  if (path === "/api/auth/guest-data") {
    const g = actorFor(req, res, { mint: false });
    if (!g.userId) {
      send(200, { boards: 0, folders: 0 });
      return true;
    }
    const guest = g.guestUid ? guests.get(g.guestUid) : null;
    send(200, {
      boards: guest ? guest.boards.size : 0,
      folders: guest ? guest.folders.size : 0,
    });
    return true;
  }

  if (path === "/api/auth/claim-guest-data" && req.method === "POST") {
    const c = actorFor(req, res, { mint: false });
    if (!c.userId) {
      send(401, { error: "not signed in" });
      return true;
    }
    const guest = c.guestUid ? guests.get(c.guestUid) : null;
    const claimed = {
      boards: guest?.boards.size ?? 0,
      folders: guest?.folders.size ?? 0,
    };
    if (guest) {
      const target = storeFor(c);
      for (const [id, board] of guest.boards) {
        target.boards.set(id, board);
      }
      for (const [id, folder] of guest.folders) {
        target.folders.set(id, folder);
      }
      guest.boards.clear();
      guest.folders.clear();
      setCookie(res, "mosaic_uid", "", 0);
    }
    send(200, { claimed, ok: true });
    return true;
  }

  /* ---- public share read (no session required) ---- */

  const sharedMatch = path.match(/^\/api\/boards\/shared\/([0-9a-f]{64})$/);
  if (sharedMatch) {
    let found = null;
    for (const store of guests.values()) {
      for (const board of store.boards.values()) {
        if (board.shareToken === sharedMatch[1] && board.trashedAt === null) {
          found = board;
        }
      }
    }
    for (const user of users.values()) {
      for (const board of user.store.boards.values()) {
        if (board.shareToken === sharedMatch[1] && board.trashedAt === null) {
          found = board;
        }
      }
    }
    if (!found) {
      send(404, { error: "not found" });
      return true;
    }
    send(200, {
      board: {
        id: found.id,
        name: found.name,
        thumbnail: found.thumbnail,
        scene: found.scene,
        createdAt: found.createdAt,
        updatedAt: found.updatedAt,
        favorite: false,
        folderId: null,
        trashedAt: null,
        sceneVersion: 0,
        lastOpenedAt: null,
      },
    });
    return true;
  }

  /* ---- boards ---- */

  if (path === "/api/boards") {
    const store = storeFor(actor());

    if (req.method === "GET") {
      const trashedParam = url.searchParams.get("trashed");
      const boards = [...store.boards.values()]
        // Three states, matching the real route: only trashed, only live, or both.
        // Collapsing them is how a live board reaches the trash view, where
        // `purgeExpiredTrash` — which trusts this endpoint and only checks the
        // timestamp — deletes it while the user is looking at it.
        .filter((b) =>
          trashedParam === "1"
            ? b.trashedAt !== null
            : trashedParam === "all"
            ? true
            : b.trashedAt === null,
        )
        .sort(
          (a, b) =>
            (b.lastOpenedAt ?? b.updatedAt) - (a.lastOpenedAt ?? a.updatedAt),
        )
        .map((b) => ({
          // Listed explicitly rather than by omitting `scene` from a spread, so it
          // is obvious which fields a listing carries. `listBoards` strips the scene
          // for the same reason: scenes can be megabytes and the grid never uses them.
          id: b.id,
          name: b.name,
          folderId: b.folderId,
          favorite: b.favorite,
          trashedAt: b.trashedAt,
          thumbnail: b.thumbnail,
          sceneVersion: b.sceneVersion,
          createdAt: b.createdAt,
          updatedAt: b.updatedAt,
          lastOpenedAt: b.lastOpenedAt,
        }));
      send(200, { boards });
      return true;
    }

    if (req.method === "POST") {
      const body = await readBody(req);
      const board = newBoard(
        typeof body.name === "string" && body.name.trim()
          ? body.name.trim()
          : "Untitled board",
      );
      if (typeof body.scene === "string") {
        board.scene = body.scene;
        board.sceneBytes = body.scene.length;
      }
      store.boards.set(board.id, board);
      send(201, { board: { ...board, scene: undefined } });
      return true;
    }

    send(405, { error: "method not allowed" });
    return true;
  }

  const boardMatch = path.match(/^\/api\/boards\/([^/]+)$/);
  if (boardMatch) {
    const store = storeFor(actor());
    const board = store.boards.get(boardMatch[1]);

    if (req.method === "GET") {
      if (!board) {
        send(404, { error: "not found" });
        return true;
      }
      board.lastOpenedAt = now();
      send(200, { board });
      return true;
    }

    if (req.method === "PATCH") {
      if (!board) {
        send(404, { error: "not found" });
        return true;
      }
      const body = await readBody(req);
      if (typeof body.name === "string") {
        if (!body.name.trim()) {
          send(400, { error: "name cannot be empty" });
          return true;
        }
        board.name = body.name.trim();
      }
      if (typeof body.favorite === "boolean") {
        board.favorite = body.favorite;
      }
      if ("folderId" in body) {
        board.folderId = body.folderId ?? null;
      }
      if ("trashedAt" in body) {
        board.trashedAt = body.trashedAt ?? null;
      }
      if (typeof body.thumbnail === "string") {
        board.thumbnail = body.thumbnail;
      }
      if (typeof body.scene === "string") {
        board.scene = body.scene;
        board.sceneBytes = body.scene.length;
        board.sceneVersion += 1;
      }
      board.updatedAt = now();
      send(200, { board });
      return true;
    }

    if (req.method === "DELETE") {
      if (!board) {
        send(404, { error: "not found" });
        return true;
      }
      store.boards.delete(board.id);
      send(200, { ok: true });
      return true;
    }

    send(405, { error: "method not allowed" });
    return true;
  }

  const shareMatch = path.match(/^\/api\/boards\/([^/]+)\/share$/);
  if (shareMatch) {
    const store = storeFor(actor());
    const board = store.boards.get(shareMatch[1]);

    if (req.method === "POST") {
      if (!board) {
        send(404, { error: "not found" });
        return true;
      }
      const body = await readBody(req);
      if (body.mode !== undefined && body.mode !== "view") {
        send(400, { error: "mode must be 'view'" });
        return true;
      }
      if (!board.shareToken) {
        board.shareToken = token();
        board.shareMode = "view";
        send(201, {
          share: { token: board.shareToken, mode: "view" },
          created: true,
        });
        return true;
      }
      send(200, {
        share: { token: board.shareToken, mode: board.shareMode },
        created: false,
      });
      return true;
    }

    if (req.method === "DELETE") {
      if (!board) {
        send(404, { error: "not found" });
        return true;
      }
      board.shareToken = null;
      board.shareMode = null;
      send(200, { ok: true, wasShared: true });
      return true;
    }

    send(405, { error: "method not allowed" });
    return true;
  }

  send(404, { error: "not found" });
  return true;
};
