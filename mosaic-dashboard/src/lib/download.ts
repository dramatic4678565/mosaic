import type { Board } from "@/db/schema";

import { getBoardWithScene } from "@/db/operations";

/**
 * Board export (STEP 3).
 *
 * Three formats, and why:
 *
 *  - `.mosaic`    - our own container. Wraps the scene in a small envelope with
 *                   the board metadata (name, folder, created/updated) so a
 *                   re-import restores the organisation, not just the drawing.
 *  - `.excalidraw` - the upstream scene format. Kept so boards remain portable
 *                   to/from the original app. NOTE: the MIME type and extension
 *                   are unchanged on purpose (see REBRAND.md — these are file
 *                   format identifiers, not branding).
 *  - `.png` / `.svg` - raster/vector snapshot. Rendered from the stored
 *                   thumbnail when one exists; otherwise we fall back to a
 *                   placeholder rather than silently producing an empty image.
 *
 * PNG/SVG re-render from the live editor rather than the cached thumbnail in a
 * future iteration; for Part 2 the cached data URL is what we have, and it is
 * exactly what the editor produced on save, so it is faithful.
 */

/** Triggers a browser download for a Blob. */
const saveBlob = (blob: Blob, filename: string) => {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  // Revoke on the next tick: revoking synchronously can cancel the download in
  // Firefox when the blob is still being read.
  setTimeout(() => URL.revokeObjectURL(url), 0);
};

/** Makes a filename safe on Windows/macOS/Linux without changing its meaning. */
export const safeFilename = (name: string): string => {
  const cleaned = name
    .replace(/[\\/:*?"<>|]+/g, "-")
    .replace(/\s+/g, " ")
    .trim();
  return cleaned.length ? cleaned.slice(0, 120) : "Untitled board";
};

/** `.mosaic` envelope. Kept additive so old importers ignore unknown fields. */
const buildMosaicEnvelope = (board: Board, scene: string) =>
  JSON.stringify(
    {
      type: "mosaic/board",
      version: 1,
      board: {
        id: board.id,
        name: board.name,
        folderId: board.folderId,
        createdAt: board.createdAt,
        updatedAt: board.updatedAt,
      },
      scene,
    },
    null,
    2,
  );

/**
 * Renders the scene JSON to a `.excalidraw` payload.
 *
 * The dashboard stores the scene exactly as the editor exported it, so this is
 * usually a straight pass-through. If the scene happens to be wrapped in a
 * `.mosaic` envelope (e.g. a file was imported and stored verbatim), unwrap it
 * first so the output is a valid upstream scene.
 */
const toExcalidrawJson = (rawScene: string | undefined): string => {
  if (!rawScene) {
    return JSON.stringify({ type: "excalidraw", version: 2, source: "mosaic" });
  }
  try {
    const parsed = JSON.parse(rawScene);
    if (parsed && parsed.type === "mosaic/board") {
      return typeof parsed.scene === "string"
        ? parsed.scene
        : JSON.stringify(parsed.scene ?? {});
    }
    // Already a plain scene — emit it verbatim.
    return JSON.stringify(parsed);
  } catch {
    // Not JSON; hand it back untouched rather than corrupting the file.
    return rawScene;
  }
};

export const downloadBoard = async (
  board: Board,
  format: "mosaic" | "excalidraw" | "png" | "svg",
) => {
  const base = safeFilename(board.name);

  if (format === "mosaic") {
    const full = await getBoardWithScene(board.id);
    const blob = new Blob(
      [buildMosaicEnvelope(full ?? board, full?.scene ?? "")],
      {
        type: "application/json",
      },
    );
    saveBlob(blob, `${base}.mosaic`);
    return;
  }

  if (format === "excalidraw") {
    const full = await getBoardWithScene(board.id);
    const blob = new Blob([toExcalidrawJson(full?.scene)], {
      // Unchanged upstream MIME type — this is a format identifier.
      type: "application/vnd.excalidraw+json",
    });
    saveBlob(blob, `${base}.excalidraw`);
    return;
  }

  if (!board.thumbnail) {
    // Nothing was ever captured for this board. Silently downloading an empty
    // image would be confusing, so surface it and stop.
    // eslint-disable-next-line no-alert -- a transient user action, not a crash
    alert("This board has no preview yet. Open it once to generate one.");
    return;
  }

  if (format === "svg") {
    // The thumbnail is a PNG data URL. Re-emitting it inside an <svg> wrapper
    // gives a valid, openable .svg file without pulling in an encoder.
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="1200" height="750" viewBox="0 0 1200 750"><image width="1200" height="750" xlink:href="${board.thumbnail}"/></svg>`;
    saveBlob(new Blob([svg], { type: "image/svg+xml" }), `${base}.svg`);
    return;
  }

  // PNG: convert the data URL to a Blob so the download has the right MIME.
  const response = await fetch(board.thumbnail);
  saveBlob(await response.blob(), `${base}.png`);
};
