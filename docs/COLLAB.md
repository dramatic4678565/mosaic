# Live collaboration

Mosaic's real-time sync runs on a self-hosted [excalidraw-room][room] server.

- **Production:** <https://excalidraw-room-5yet.onrender.com> (Render free tier)
- **Local (optional):** `http://localhost:8081` via Docker

---

## Why this is self-hosted

Until recently the client pointed at upstream's public instance, `https://oss-collab.excalidraw.com`. That instance is rate-limited for external use, and the symptom was a remote edit taking **tens of seconds** to appear.

Two separate things were slow, and only fixing one would have been a half-fix:

1. **The wrong server.** Rate-limited and shared with every fork and embed of upstream. Fixed by pointing `VITE_APP_WS_SERVER_URL` at our own instance.
2. **A 20-second client-side throttle.** `Collab.queueBroadcastAllElements` is a `throttle(fn, SYNC_FULL_SCENE_INTERVAL_MS)` and upstream ships that constant as `20000`. Even against a perfect server, a collaborator only ever saw your drawing once every 20 seconds. Lowered to **50 ms** — see `excalidraw-app/app_constants.ts`.

The second one is invisible to every other check in the repo: lint passes, typecheck passes, the build passes, and collaboration is just quietly slow. That is why `packages/excalidraw/tests/collabLatency.test.ts` asserts the budget.

---

## Run it locally

The room server is optional and lives behind a compose profile, so the common case (`docker compose up` to look at the app) does not pay for a second build.

```bash
docker compose --profile collab up --build collab
```

Expected: `listening on port: 80` in the logs, and `ws://localhost:8081` reachable. Then point the client at it by editing `.env.development`:

```dotenv
VITE_APP_WS_SERVER_URL=http://localhost:8081
```

Restart `yarn start` — Vite only reads `.env` at startup.

---

## The environment variable

| File | Value |
| --- | --- |
| `.env.development` | `https://excalidraw-room-5yet.onrender.com` |
| `.env.production` | `https://excalidraw-room-5yet.onrender.com` |
| `mosaic-dashboard/.env.e2e` | same, so a test never reaches the internet by accident |

Read in `excalidraw-app/collab/Collab.tsx` via `getCollabServerUrl()`, which falls back to `DEFAULT_COLLAB_SERVER_URL` and `console.warn`s if the variable is missing — so a forgotten value is loud rather than silent.

Use `https://`, not `ws://`. socket.io accepts an http(s) origin and negotiates the WebSocket upgrade itself; hardcoding a `ws://` scheme breaks TLS in production and trips browser mixed-content rules.

---

## Hosting it yourself

Any host that runs a long-lived Node process with WebSocket support works. The free tier of each is enough for a handful of concurrent editors.

| Host | Notes |
| --- | --- |
| **Render** | Current home. Free instances **sleep after ~15 min idle** and take ~30–60 s to wake. First join of a cold room is slow; everything after is real-time. Keep-alive pings defeat this if latency matters more than cost. |
| **Railway** | Free credit tier, no forced sleep. Best free choice for always-warm. |
| **Fly.io** | Free allowance, always-on. Needs a `fly.toml`. |

Deploy from `infra/collab.Dockerfile` (build context = repo root, so the `infra/excalidraw-room` submodule is available without being modified). Set:

- `NODE_ENV=production`
- `PORT=80` (or let it default)
- `CORS_ORIGIN` — set it to your origin in production rather than `*`

---

## Debugging latency that comes back

Work outside in:

1. **Is it the socket?** DevTools → Network → **WS** tab. You want a persistent `101 Switching Protocols` frame. If it sits `pending`, the room server is asleep, unreachable, or blocking the WebSocket upgrade.
2. **Is it the server?** `curl -i https://your-host/` — it should answer 200. If it hangs for ~30 s you have a cold instance.
3. **Is it the client?** Check `SYNC_FULL_SCENE_INTERVAL_MS` in `excalidraw-app/app_constants.ts`. If it is above 100, you have the original bug back; `yarn test:app packages/excalidraw/tests/collabLatency.test.ts` will tell you.
4. **Is it the transport?** The client requests `["websocket", "polling"]`. A corporate proxy that strips `Upgrade` silently forces polling, which is slower. Confirm the WS tab shows a real websocket, not an XHR fallback.

---

## Measuring it

`yarn test:e2e:collab` opens two independent browser contexts, has the first start a session, opens the generated room link in the second, and times how long the rectangle takes to appear.

It needs outbound access to the room server, which is why it is a **separate** config rather than part of `yarn e2e`: a Render cold start or an outage must never turn the hermetic suite red.

```bash
yarn build:e2e          # required: the e2e build sets the editor base to /editor/
yarn test:e2e:collab
```

Expect a Render cold start to add up to ~60 s on the _first_ run of an idle instance. That is the host waking up, not sync latency.

[room]: https://github.com/excalidraw/excalidraw-room
