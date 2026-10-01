# Security Policy

## Reporting a vulnerability

Please report privately rather than opening a public issue.

Use GitHub's "Report a vulnerability" button on the Security tab of this repository, which opens a private advisory. If that is unavailable, open an issue with the title `[SECURITY] do not publish` and describe the problem without a working exploit.

Please include:

- what the issue is and what an attacker gains
- steps to reproduce, or a proof of concept
- the affected version, browser and platform

We aim to acknowledge within 3 working days and to ship a fix or a mitigation within 30 days. We will tell you when the fix lands and credit you unless you would rather stay anonymous.

## Threat model

Mosaic is a **local-first** application. That shapes what the security boundary actually is.

### What this app does and does not have

|  |  |
| --- | --- |
| **Authentication** | none. There are no accounts and no server. |
| **Where data lives** | the browser's IndexedDB (`mosaic-dashboard`), on the user's device. |
| **What leaves the device** | nothing, except the telemetry upstream Excalidraw still emits — see "Third parties" below. |
| **Trust boundary** | the browser. Anything with script access to the origin can read every board. |

Consequences worth stating plainly:

- **There is no server-side protection to bypass.** Boards are not encrypted at rest by Mosaic; anyone with access to the browser profile or the machine can read them. Treat the device as the security boundary.
- **XSS in this app is a full data compromise**, because XSS in this app can read every board in IndexedDB. The same-origin header on the nginx config and the editor's own same-origin embed guard both exist to limit this; do not weaken either.
- **Serving over plain HTTP on a non-localhost host breaks the app's security model**, not just its features. IndexedDB, service workers and the editor's workers all require a secure context. Use HTTPS.
- **Deletion is honest but not secure.** Removing a board deletes it from IndexedDB; it is not a cryptographic erase.

## What we consider a vulnerability

- Cross-site scripting that lets a third party read or modify board data
- A board-mode or embed path that lets an untrusted origin frame the editor and script it
- A path that leaks board contents to a third-party host
- Authentication or authorization bypass (not applicable today; relevant if a sync backend is added)
- Dependency vulnerabilities with a known working exploit

## What we do not consider a vulnerability

- Board data being readable by anyone with access to the browser or the OS — that is the documented local-first model, not a bug
- The editor being usable when framed by Mosaic itself
- Losing data by clearing site data, using private browsing, or the 30-day trash purge — all expected behaviour
- Reports against `excalidraw.com`, `plus.excalidraw.com` or any other upstream Excalidraw property. Report those to the Excalidraw project.

## Upstream surface

Mosaic inherits parts of upstream Excalidraw, including outbound calls to Excalidraw-operated services — font CDN, library URLs, collaboration endpoints and analytics. Those are outside Mosaic's control. If an issue concerns one of them, report it upstream.

## Hard rules for contributors

- Never remove the MIT attribution. See [`LICENSE`](LICENSE) and [`NOTICE`](NOTICE).
- Never introduce a third-party script without reviewing it and documenting it here.
- Keep `X-Frame-Options: SAMEORIGIN` / `frame-ancestors` in the nginx config unless you also update the editor's same-origin guard in `App.tsx`. The editor blocks same-origin framing by default for a reason: a _user-authored scene_ embedding the editor is a clickjacking vector. Board mode is a deliberate, hash-scoped exception — do not widen it.
