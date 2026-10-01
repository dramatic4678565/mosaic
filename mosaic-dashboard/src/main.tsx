import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { App } from "./App";
import "./styles/global.scss";

/**
 * Dashboard entry point.
 *
 * Note this deliberately does *not* register a service worker or set up the PWA
 * manifest — those belong to `excalidraw-app`. Registering a second worker on the
 * same origin would make the two apps fight over the cache.
 */
const container = document.getElementById("root");
if (!container) {
  throw new Error("Missing #root element");
}

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
