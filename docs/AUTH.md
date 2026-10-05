# Accounts, guest migration and sharing

How Mosaic's authentication works, how to configure it, and how to move a guest user's boards onto an account.

Part 3A put the app on Vercel with Postgres storage and identified people by a signed cookie. This document covers Part 3B: real accounts, and what happens to the boards that cookie owned.

---

## Architecture

### Why a magic link and not a password

There is no password anywhere in this codebase. That is a design decision, not a simplification:

- Nothing to hash, so nothing to leak. A database dump contains no credentials.
- Nothing to reset, so there is no reset flow to abuse.
- No credential fields, so no password manager, no breach notification, no "someone tried to log in as you" email to interpret.
- Phishing resistance comes free: there is no credential to enter, so a fake login page has nothing to collect.

The cost is one round trip through an inbox on every login, which is the right trade for a whiteboard app.

### The two identity schemes

Both exist, deliberately, and they overlap:

|                | Anonymous                     | Account                 |
| -------------- | ----------------------------- | ----------------------- |
| Credential     | signed `mosaic_uid` cookie    | `mosaic_session` cookie |
| Rows scoped by | `owner_uid` (text)            | `user_id` (uuid)        |
| Set by         | `getOwnerUid` in `api/_db.ts` | `POST /api/auth/verify` |
| Needed         | no                            | no                      |

`api/_owner.ts` is where they meet. `resolveActor` decides which one applies, and `ownerScope` turns that into a WHERE fragment that every board and folder query uses.

**A signed-in request is scoped by `user_id` only, never by `owner_uid`.** That is what lets two browsers signed into one account see the same boards, and it is also why claiming works: once rows carry a `user_id`, reads have to be able to find them.

Nothing forces a login. There is no route that redirects to `/login`, and `/api/auth/*` failing degrades nothing. A visitor who never signs in never learns accounts exist.

### What the user cannot learn

`POST /api/auth/request-link` answers `{"ok": true}` for every accepted address.

Any other shape would be an account-existence oracle: an attacker could walk a list of addresses against this endpoint and learn who has an account here. Three consequences follow, and all three are deliberate:

- A rate-limited request answers the same thing. Saying "too many requests for this address" would leak that the address was requested before.
- A Resend outage answers the same thing. Reporting a provider failure would leak which addresses are in flight.
- A malformed address is a `400`, because that is a client bug rather than a statement about any account.

The trade is real: someone who hits the hourly cap is told "check your email" and nothing arrives. They will notice, and ask. That is the correct cost of not turning the endpoint into an oracle.

### Magic-link lifecycle

```
POST /api/auth/request-link { email }
   ├─ normalise: trim + lowercase        (so A@B.com and a@b.com are one account)
   ├─ rate limit: 3 per email per hour, counted from magic_links.created_at
   ├─ insert token, expires_at = now() + 15 minutes
   ├─ email the link via Resend
   └─ 200 {"ok": true}                    (always)

GET /api/auth/verify?token=…
   ├─ one UPDATE guarded by used_at IS NULL AND expires_at > now()
   ├─ no row claimed? distinguish invalid / used / expired for the message
   ├─ upsert users, create session (30 days)
   ├─ Set-Cookie: mosaic_session (HttpOnly, SameSite=Lax, Secure in prod)
   └─ 303 → /dashboard
```

**Redeeming is a single UPDATE, not a read followed by a write.** Two simultaneous clicks would both pass a read-then-write and both sign in; only one can win an `UPDATE ... WHERE used_at IS NULL`.

The account is created at **verify** time, not at request time. Creating it on request would let this public endpoint mint rows for arbitrary addresses.

### Sessions

`mosaic_session` holds a 256-bit random token; the row lives in `sessions` with a 30-day expiry. Expiry is enforced in the SQL `WHERE` clause, so a stale cookie is never honoured no matter what the browser sends.

Sign-out deletes the row, not just the cookie. A stolen cookie is only useless once the row it names is gone.

A session that exists but has expired is treated as _signed out_ rather than as an error — the visitor falls back to the anonymous flow and sees their local boards instead of hitting a wall.

### Token storage

Tokens are stored raw, and that is a decision rather than a shortcut.

The only way to reach a row is an exact-match lookup with a value the caller already possesses. There is no enumeration surface that hashing would defend against, and no route that lists tokens. Hashing would add cost and make the emailed link impossible to look up directly.

Both tables are short-lived: magic links expire in 15 minutes, sessions in 30 days, and both are swept.

---

## Configuring Resend

| Variable | Where | Required | Notes |
| --- | --- | --- | --- |
| `RESEND_API_KEY` | `.env.local` and Vercel | yes | Secret. Send-only is fine. |
| `RESEND_FROM` | `.env.local` and Vercel | no | Defaults to `onboarding@resend.dev`. Must be on a verified domain for real use. |
| `COOKIE_SECRET` | `.env.local` and Vercel | yes | HMAC key for the anonymous cookie. 32 random bytes. |

Set both on **Production and Preview**. Without them on Preview, every pull request has a dashboard that loads and an API that 503s.

Generate a cookie secret:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

### The sender domain matters

`onboarding@resend.dev` is Resend's test sender and **only delivers to the account owner's own inbox**. Any other address is rejected with:

> You can only send testing emails to your own email address

So until a domain is verified, only you can sign in. To fix that:

1. Resend → **Domains** → add a domain you control.
2. Add the DNS records Resend gives you (CNAME for sending, plus the verification TXT).
3. Set `RESEND_FROM` to an address on that domain, e.g. `noreply@yourdomain.com`.
4. Set `RESEND_API_KEY` on Vercel again so the rebuild picks it up.

No code change is needed. `sendMagicLinkEmail` reads `RESEND_FROM` at call time.

A **send-only** API key is sufficient and preferable — it cannot read your domain list or send from any other identity. It does mean the domain has to be told to you rather than looked up.

---

## Running auth locally

### The default: no accounts

`mosaic-dashboard/.env.development` has no `VITE_API_URL`, so `yarn start` gives you the IndexedDB backend with no sign-in link anywhere and `/login` explaining that this build has no server. That is the fast loop, and it is what the main e2e suite runs against.

### Against a real database

`.env.local` needs the **direct** Neon connection string — migrations are long statements and must not queue behind application traffic. Vercel's `DATABASE_URL` wants the **pooled** one, because serverless functions open a burst of short-lived connections.

```bash
yarn db:migrate      # apply db/migrations
vercel dev           # serve the functions
```

> On Windows, `vercel dev` currently fails to bind its internally-assigned port (`listen EACCES: permission denied $PORT`, then "Failed to detect a server running on port NNNNN") for a project with no detected framework. The handlers can be exercised without it — compile `api/` and call the default export with a Node-style `(req, res)` pair.

### Against a mock, in a browser

The auth e2e suite does exactly this:

```bash
yarn --cwd mosaic-dashboard build:e2e:auth   # mode with VITE_API_URL present
yarn --cwd mosaic-dashboard test:e2e:auth
```

`e2e/mock-api.mjs` is an in-memory stand-in mounted by `e2e/preview-server.mjs` when `MOCK_API=1`. It is not a second implementation to keep in step — it exists so a real journey can be walked. The real handlers are verified against Postgres directly and their logic is unit tested.

---

## Migrating a guest user

### What happens automatically

1. A visitor works anonymously. Boards land in Postgres under their cookie's `owner_uid`, because the browser has the API enabled but no session.
2. They sign in. The session cookie is set; `mosaic_uid` is deliberately left alone.
3. Their dashboard now scopes by `user_id`, so the guest rows are not shown — which is exactly why the prompt appears.
4. `GET /api/auth/guest-data` counts the rows still owned by that cookie.
5. If any exist, a one-time modal offers to import them.
6. **Import** → `POST /api/auth/claim-guest-data` moves the rows and clears the cookie. **Skip** leaves both alone.

### Why the guest cookie survives sign-in

This is the subtle part. `/api/auth/verify` does not call `getOwnerUid`, so nothing touches `mosaic_uid` during login. If the cookie were replaced at that moment the guest rows would become unreachable and the prompt would never know they existed.

An early version of the e2e mock resolved an actor for every request and therefore minted a fresh `mosaic_uid` on `verify`, overwriting the visitor's. The symptom was a claim prompt that never appeared — a divergence from production that looked like a product bug.

### Why the anonymous scope carries `user_id IS NULL`

Claiming sets `user_id` but cannot clear `owner_uid`, which is `NOT NULL`. So the row still matches `owner_uid = <the guest cookie>` afterwards.

Without `AND user_id IS NULL` on anonymous reads, a guest cookie captured **before** the claim would keep granting read access to boards that now belong to an account.

This was found by probing real Postgres after the mocked unit tests passed: with `query` mocked, no query ever reaches a type-checking database.

### Why the claim is idempotent

Every statement is guarded by `user_id IS NULL`, so pressing Import twice moves nothing the second time and reports the same counts. A concurrent double-click cannot double-claim.

No transaction wraps it: each statement is independently idempotent and the tables are tiny, so one would buy nothing.

### Recovering a skipped claim

Skip is genuinely reversible — the cookie is kept, so signing out brings the guest boards back. To import them later, sign in again from the **same browser**: the prompt will reappear, because it keys off the cookie still being present.

Once the cookie is gone the rows are unreachable through the UI. They are not deleted, so they can be recovered from Postgres directly if that ever happens.

---

## Sharing

### The token is the capability

`share_token` is 256 bits of entropy and `share_mode` is `'view'`. Anyone holding the link may read the board.

A short or sequential id would let anyone walk `/share/1`, `/share/2` and read every board anyone ever shared. The token is `randomBytes(32)`, hex — the same strength as a session token.

Only the owner can mint or revoke. A share link grants read and **never** re-share: the public route is `GET`-only, and the owner-only routes 404 for anyone else.

### What the public route withholds

`GET /api/boards/shared/[token]` is unauthenticated by design — the point is that the recipient has no Mosaic account. That makes it the most security-sensitive route in the codebase, so what it _does not_ return matters as much as what it does:

- No `owner_uid`, no `user_id`, no email. A link should not disclose whose it is.
- No `scene_version` or `scene_bytes`. Internal bookkeeping.
- `favorite`, `folderId` and `trashedAt` are flattened to empty values rather than omitted, so the client cannot be surprised by a missing field.

It also serves only **live** boards — trashing is how a user says this should not be reachable — and sets `Cache-Control: no-store`, so a cached copy cannot outlive a revoke.

Unknown, revoked and trashed all answer the identical `404 {"error":"not found"}`. Distinguishing them would let anyone probe whether a link once existed.

### Revoking

`DELETE /api/boards/[id]/share` clears `share_token` and `share_mode` in one statement. Two CHECK constraints make a half-shared row unrepresentable, so revoke is atomic in meaning and not just in SQL. Clearing the token also frees the UNIQUE slot for a different board.

The Share dialog is available only for live boards, and only from the board context menu — never from the trash view, where a link would not work anyway.

### `edit` mode is refused

The column accepts `'view' | 'edit'` and the API rejects `'edit'` with a `400`.

Creating a link that cannot do what it claims is worse than not offering the option, so the request is refused up front rather than stored and ignored. The column stays so a later step does not need a re-migration.

---

## Operational notes

### Rate limiting is per-instance

100 requests/minute per uid for the API, 3 magic links per email per hour, both in-memory.

Vercel instances are ephemeral and there is no shared store, so this stops a runaway client on a warm instance. It is not a security control and it does not survive a cold start. Anything that must hold across instances needs a real store.

### Account deletion

`boards.user_id` and `folders.user_id` are `ON DELETE SET NULL`.

The default would be `NO ACTION`, which fails outright: a user with boards cannot be deleted because their boards still reference them. `CASCADE` would be worse — it would destroy their work. Removing the account leaves the content for an explicit purge, and the boards keep their `owner_uid` so an anonymous owner can still reach them.

There is no delete-account endpoint in Part 3B. The schema is what makes it safe to add one later.

### Migration files

| File | Adds |
| --- | --- |
| `001_init.sql` | boards, folders, activity |
| `002_align_boards_with_app_schema.sql` | `last_opened_at`, `scene_bytes`, `scene` as text |
| `002_auth.sql` | users, magic_links, sessions, nullable `user_id` |
| `003_sharing.sql` | `share_token`, `share_mode`, two CHECK constraints |

> There are two `002_` files. They are applied in filename order and both run, so behaviour is correct — but the numbering is genuinely ambiguous, and a future `002_x` would be too. Renumbering is a migration-history change and should be a deliberate decision, not something to do quietly.

### Query-parameter reference

| Request                            | Meaning         |
| ---------------------------------- | --------------- |
| `GET /api/boards`                  | live boards     |
| `GET /api/boards?trashed=1`        | only trashed    |
| `GET /api/boards?trashed=all`      | no trash filter |
| `GET /api/boards?folderId=<uuid>`  | one folder      |
| `GET /api/boards?folderId=unfiled` | unfiled boards  |

`trashed=all` exists because `includeTrashed` in the storage interface means "give me everything, I will filter" — which is what the dashboard asks for on every page load. Mapping it onto `trashed=1` returned only the bin, so the main grid rendered empty while the rows sat in Postgres.

---

## Where the code is

| Concern | File |
| --- | --- |
| Magic link, sessions, cookies | `api/auth/_shared.ts` |
| Anonymous vs account scoping | `api/_owner.ts` |
| Claim flow | `api/auth/claim-guest-data.ts`, `api/auth/guest-data.ts` |
| Share mint/revoke | `api/boards/[id]/share.ts` |
| Public share read | `api/boards/shared/[token].ts` |
| Browser client | `mosaic-dashboard/src/lib/auth.ts` |
| Session state | `mosaic-dashboard/src/state/useAuthStore.ts` |
| Sign-in page | `mosaic-dashboard/src/pages/LoginPage.tsx` |
| Claim prompt | `mosaic-dashboard/src/components/auth/ClaimGuestDataPrompt.tsx` |
| Share dialog | `mosaic-dashboard/src/components/board/ShareModal.tsx` |
| Public viewer | `mosaic-dashboard/src/pages/SharedBoardPage.tsx` |
| Editor read-only mode | `excalidraw-app/shareMode.ts` |
| Route tests | `api/__tests__/` |
| Journey tests | `mosaic-dashboard/e2e/auth-flow.spec.ts` |
