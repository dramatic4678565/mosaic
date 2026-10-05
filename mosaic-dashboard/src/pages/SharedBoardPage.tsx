import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { BRAND } from "@mosaic/brand";

import styles from "./SharedBoardPage.module.scss";

import { MosaicMark } from "@/components/common/MosaicMark";

/**
 * Public viewer for a shared board (Part 3B, STEP 5) — route `/share/:token`.
 *
 * ## No editor chrome, and no dashboard chrome either
 *
 * This route is deliberately rendered outside `AppShell`. The sidebar, the account
 * block and the board grid all assume an owner with an editable store; showing them
 * to someone who only has a read-only token would be a set of controls that do
 * nothing. The only chrome here is the board name and a "read only" marker.
 *
 * ## Why an iframe
 *
 * The canvas is the editor, and the editor is a separate app that the dashboard
 * embeds rather than imports — see the architecture note in `excalidraw-app`. This
 * page therefore points an iframe at the editor's `#share=<token>` mode, which
 * fetches the scene from the API and opens it in view mode. There is no second copy
 * of Excalidraw in the dashboard bundle.
 *
 * ## Failure
 *
 * An unknown, revoked or trashed token all render the same "not available" panel.
 * Distinguishing them would let anyone probe whether a link once existed.
 */

type State =
  | { kind: "loading" }
  | { kind: "missing" }
  | { kind: "ready"; name: string };

const EDITOR_BASE = (
  (import.meta.env.VITE_EDITOR_BASE as string | undefined) ?? "/app/"
).replace(/\/$/, "");

export const SharedBoardPage = () => {
  const { token = "" } = useParams();
  const [state, setState] = useState<State>({ kind: "loading" });

  useEffect(() => {
    let cancelled = false;
    setState({ kind: "loading" });

    // The name is fetched only so the page can label itself. The iframe fetches the
    // scene itself, so a failure here must not block rendering the board.
    void fetch(`/api/boards/shared/${token}`, { credentials: "omit" })
      .then(async (res) => {
        if (cancelled) {
          return;
        }
        if (!res.ok) {
          setState({ kind: "missing" });
          return;
        }
        const body = (await res.json()) as { board?: { name?: string } };
        setState({ kind: "ready", name: body.board?.name ?? "Untitled board" });
      })
      .catch(() => {
        if (!cancelled) {
          setState({ kind: "missing" });
        }
      });

    return () => {
      cancelled = true;
    };
  }, [token]);

  if (state.kind === "missing") {
    return (
      <div data-testid="share-missing" className={styles.missing}>
        <h1>This board is not available</h1>
        <p>
          The link may have been revoked, or the board may have been moved to
          trash.
        </p>
        <a href="/dashboard">Go to Mosaic</a>
      </div>
    );
  }

  return (
    <div data-testid="share-page" className={styles.page}>
      <header className={styles.header}>
        <span className={styles.brand}>
          <MosaicMark title={BRAND.name} />
          {BRAND.name}
        </span>
        <span className={styles.title} data-testid="share-board-name">
          {state.kind === "ready" ? state.name : "Loading…"}
        </span>
        <span className={styles.badge}>Read only</span>
      </header>

      {/*
        The editor resolves the token from the fragment. `share` rather than `board`
        so this can never be mistaken for the owner-scoped board mode, which would
        look the row up in IndexedDB and find nothing.
      */}
      <iframe
        className={styles.frame}
        title="Shared board"
        data-testid="share-frame"
        src={`${EDITOR_BASE}/#share=${encodeURIComponent(token)}`}
      />
    </div>
  );
};
