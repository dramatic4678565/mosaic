import { useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";

import { BRAND } from "@mosaic/brand";

import type { Board } from "@/db/schema";

import { getBoardWithScene, markBoardOpened } from "@/db/operations";

import { t } from "@/lib/i18n";
import { useDashboardStore } from "@/state/useDashboardStore";

/**
 * Board editor route (STEP 2 `/board/:id`, STEP 6 editor integration).
 *
 * Architecture note — why an iframe instead of embedding Excalidraw directly:
 * the editor is a *separate Vite app* with its own PWA service worker, its own
 * `EXCALIDRAW_ASSET_PATH` and its own fonts. Loading it as an iframe keeps the
 * two apps fully isolated (this is also what preserves Part 1's guarantee that
 * the editor build is untouched) and mirrors how the editor's own embeddable
 * mode works. We talk to it over `postMessage` using a small, versioned
 * protocol defined in `lib/editorBridge.ts`.
 *
 * When the editor is served from the same host it reads the board id from the
 * `#board=<id>` hash (STEP 6), loads the scene from IndexedDB itself, and
 * autosaves. This page's job is to render that iframe, show a back link, and
 * mirror save status back into the dashboard store.
 */
export const BoardPage = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const reload = useDashboardStore((s) => s.reload);

  const [board, setBoard] = useState<Board | null>(null);
  const [missing, setMissing] = useState(false);
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved">(
    "idle",
  );
  const iframeRef = useRef<HTMLIFrameElement>(null);

  // Load the board and record the open in the activity log.
  useEffect(() => {
    if (!id) {
      return;
    }
    let cancelled = false;
    void (async () => {
      const found = await getBoardWithScene(id);
      if (cancelled) {
        return;
      }
      if (!found) {
        setMissing(true);
        return;
      }
      setBoard(found);
      await markBoardOpened(id);
      await reload();
    })();
    return () => {
      cancelled = true;
    };
  }, [id, reload]);

  /**
   * Listen for save-status messages from the editor iframe so the dashboard can
   * show "Saved". The editor posts `{ type: "mosaic:saved", boardId }` after each
   * autosave and on Ctrl+S.
   */
  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (event.data?.type === "mosaic:saved" && event.data.boardId === id) {
        setSaveState("saved");
        void reload();
        setTimeout(() => setSaveState("idle"), 1600);
      } else if (
        event.data?.type === "mosaic:saving" &&
        event.data.boardId === id
      ) {
        setSaveState("saving");
      }
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [id, reload]);

  if (missing) {
    return (
      <div
        data-testid="board-missing"
        style={{ padding: 40, textAlign: "center" }}
      >
        <h1 style={{ fontSize: 20 }}>Board not found</h1>
        <button type="button" onClick={() => navigate("/dashboard")}>
          {t("editor.back")}
        </button>
      </div>
    );
  }

  if (!id) {
    return null;
  }

  const editorUrl = buildEditorUrl(id);

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        // `height: 100%` alone chains through two flex ancestors and is
        // fragile: when it resolves to 0 the editor measures a zero-height
        // iframe, sizes its canvas to 0, and never recovers. The explicit
        // min-height guarantees the editor always has a viewport to lay out in.
        height: "100%",
        minHeight: 520,
      }}
      data-testid="board-page"
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "8px 4px",
        }}
      >
        <button
          type="button"
          onClick={() => navigate("/dashboard")}
          data-testid="back-to-dashboard"
          style={{
            padding: "8px 14px",
            border: "1px solid #e3e7ef",
            borderRadius: 8,
            background: "#fff",
          }}
        >
          ← {t("editor.back")}
        </button>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            fontSize: 13,
          }}
        >
          <span style={{ fontWeight: 600 }}>{board?.name ?? "…"}</span>
          {saveState === "saving" ? (
            <span data-testid="save-status" style={{ color: "#5b6676" }}>
              {t("editor.unsaved")}
            </span>
          ) : saveState === "saved" ? (
            <span data-testid="save-status" style={{ color: "#2f9e6f" }}>
              {t("editor.saved")}
            </span>
          ) : null}
        </div>
      </div>

      <iframe
        ref={iframeRef}
        // The editor app runs in its own document; give it all the space it needs.
        style={{
          flex: 1,
          width: "100%",
          // Same reasoning as the container above: never let the editor's
          // viewport resolve to 0, or its canvas is sized to 0 and stays that
          // way even after the layout settles.
          minHeight: 480,
          border: "1px solid #e3e7ef",
          borderRadius: 12,
        }}
        src={editorUrl}
        title={`${BRAND.name} editor`}
        data-testid="editor-frame"
      />
    </div>
  );
};

/**
 * Builds the editor URL.
 *
 * Dev: the editor dev server runs on VITE_EDITOR_URL (default http://localhost:3000)
 * and we pass the pre-loaded scene via the hash so the editor has something to
 * render before its first autosave. Prod: the editor is served from `/`, so a
 * relative `/#board=<id>` works under the same nginx.
 */
/**
 * Builds the editor URL.
 *
 * Always a same-origin relative path. That is load-bearing, not cosmetic:
 * IndexedDB is partitioned per origin and board mode reads scenes straight out
 * of the dashboard's database, so if the editor ended up on another origin it
 * would open an empty board every single time.
 *
 * The mount point comes from VITE_EDITOR_BASE:
 *  - production (Docker/nginx): the editor is served at `/app/`
 *  - dev / e2e: the static preview server mounts it at `/editor/`
 *
 * Reading it from one place rather than hard-coding it is what stops the two
 * deployments from drifting: a wrong path here is a blank iframe with no error.
 *
 * The scene is NOT passed in the URL. The editor hydrates from IndexedDB
 * itself; embedding a possibly multi-megabyte scene in the fragment bloats the
 * URL, leaks board content into browser history, and complicates hydration
 * precedence (which of URL vs DB wins?). One source.
 */
const EDITOR_BASE = (
  (import.meta.env.VITE_EDITOR_BASE as string | undefined) ?? "/app/"
).replace(/\/$/, "");

const buildEditorUrl = (boardId: string) => {
  const params = new URLSearchParams();
  params.set("board", boardId);
  return `${EDITOR_BASE}/#${params.toString()}`;
};
