/**
 * Shared-board mode for the editor (Part 3B, STEP 5).
 *
 * The editor is embedded by the dashboard at `#board=<id>` for normal editing. This
 * is the other half: `#share=<token>` renders someone else's board, read-only, with
 * no account and no database access.
 *
 * ## Why it lives here rather than in the dashboard
 *
 * The dashboard deliberately embeds the editor in an iframe rather than importing
 * Excalidraw — see the architecture note in `App.tsx`. Loading it twice would mean
 * two copies of a very large bundle, two font sets, and two sets of asset-path
 * configuration. Rendering the canvas is the editor's job; this module is the
 * editor's way of being told which canvas.
 *
 * ## What it will not do
 *
 * There is no autosave, no `markBoardOpened`, and no write of any kind. A shared
 * viewer is not the owner: their edits have nowhere to go, and silently discarding
 * them would be worse than refusing to accept them. Read-only is enforced by the API
 * as well — this is convenience, not the security boundary.
 */

/** Reads `share` from the location hash, or null. */
export const getShareTokenFromHash = (): string | null => {
  const hash = window.location.hash.replace(/^#/, "");
  if (!hash) {
    return null;
  }
  const value = new URLSearchParams(hash).get("share");
  // The server mints 64 lowercase hex characters; anything else is not a token we
  // could have issued, so it is rejected before any request goes out.
  return value && /^[0-9a-f]{64}$/.test(value) ? value : null;
};

/**
 * Where the API lives for share reads.
 *
 * Empty string means same-origin, which is correct for production where the
 * dashboard and functions share an origin. Overridable because in local development
 * the dashboard runs on its own port while this editor bundle may not.
 */
const apiBase = (): string =>
  (import.meta.env.VITE_API_URL as string | undefined) ?? "";

/**
 * Fetches a shared board.
 *
 * `credentials: "omit"` on purpose. This request is authorised by the token alone;
 * sending the session cookie would hand the server a session for a viewer who has
 * not signed in and, more to the point, would make a public URL's response depend on
 * who happens to be logged in.
 */
export const fetchSharedBoard = async (
  token: string,
): Promise<{ name: string; scene: string } | null> => {
  const res = await fetch(`${apiBase()}/api/boards/shared/${token}`, {
    credentials: "omit",
    headers: { accept: "application/json" },
  });

  if (!res.ok) {
    // 404 covers unknown, revoked and trashed tokens alike, by design: the three are
    // indistinguishable to a holder of a link.
    return null;
  }

  const body = (await res.json()) as {
    board?: { name?: string; scene?: string | null };
  };
  if (!body.board) {
    return null;
  }
  return {
    name: body.board.name ?? "Untitled board",
    scene: body.board.scene ?? "",
  };
};
