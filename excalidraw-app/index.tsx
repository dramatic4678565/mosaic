import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { registerSW } from "virtual:pwa-register";

import "../excalidraw-app/sentry";

import ExcalidrawApp from "./App";
import { getBoardIdFromHash } from "./boardMode";

window.__EXCALIDRAW_SHA__ = import.meta.env.VITE_APP_GIT_SHA;
const rootElement = document.getElementById("root")!;
const root = createRoot(rootElement);

/**
 * Register the PWA service worker only when the editor is the top-level page.
 *
 * When the editor is embedded — i.e. inside the Mosaic dashboard's iframe, which
 * is board mode — it must not install a service worker. Two reasons, both
 * observed rather than theorised:
 *
 * 1. A service worker registered by an embedded document still gets its own
 *    scope, and once it activates it starts intercepting fetches for that scope.
 *    In dev/e2e the editor is served under a sub-path, so the worker's precache
 *    manifest (generated with root-relative URLs) began answering requests for a
 *    *subsequent* load, and the editor failed to render at all after a page
 *    reload — a blank canvas with no error. Not registering avoids the whole
 *    class of problem.
 * 2. The dashboard and the editor share one origin. An embedded editor claiming
 *    the origin's storage and network layer is at best surprising and at worst
 *    fights the dashboard's own caching.
 *
 * Offline support is a property of "the editor as an app"; an embedded editor
 * inherits whatever the host page already caches. Skipping registration loses
 * nothing there.
 */
const isEmbedded = window.self !== window.top;
const isBoardMode = getBoardIdFromHash() !== null;

if (!isEmbedded && !isBoardMode) {
  registerSW();
}

root.render(
  <StrictMode>
    <ExcalidrawApp />
  </StrictMode>,
);
