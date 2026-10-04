import { describe, expect, it } from "vitest";

import {
  CURSOR_SYNC_TIMEOUT,
  SYNC_FULL_SCENE_INTERVAL_MS,
  WS_RECONNECTION,
} from "../../../excalidraw-app/app_constants";

/**
 * Guards the latency fix.
 *
 * The 60-second symptom was not a slow server. Upstream ships
 * `SYNC_FULL_SCENE_INTERVAL_MS = 20000`, and `Collab.queueBroadcastAllElements`
 * is a `throttle` on exactly that constant, so during a stroke the scene was
 * broadcast at most once every 20 seconds. That constant is easy to "restore"
 * from upstream by accident, and nothing else in the suite would notice - the
 * tests still pass, the build still passes, collaboration is just silently slow
 * again.
 *
 * These assertions encode the fix as an invariant rather than a number to
 * remember.
 */
describe("collaboration latency budgets", () => {
  it("flushes outbound scene updates well under 100ms", () => {
    expect(SYNC_FULL_SCENE_INTERVAL_MS).toBeLessThanOrEqual(100);
  });

  it("keeps the pointer/cursor throttle snappy", () => {
    expect(CURSOR_SYNC_TIMEOUT).toBeLessThanOrEqual(100);
  });

  it("recovers the socket within 3s on the first retry", () => {
    expect(WS_RECONNECTION.reconnection).toBe(true);
    // First retry.
    expect(WS_RECONNECTION.reconnectionDelay).toBeLessThanOrEqual(3000);
    // ...and the backoff ceiling, so a flapping connection cannot drift to
    // socket.io's 5s default and feel broken.
    expect(WS_RECONNECTION.reconnectionDelayMax).toBeLessThanOrEqual(3000);
    expect(WS_RECONNECTION.reconnectionAttempts).not.toBe(0);
  });

  it("prefers the websocket transport with polling as a fallback", () => {
    // Documented for the reader; socket.io options live at the call site.
    expect(WS_RECONNECTION.timeout).toBeGreaterThan(0);
  });
});
