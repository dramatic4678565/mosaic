/**
 * Mosaic dashboard data model.
 *
 * These types are the contract between the IndexedDB layer (`db/index.ts`), the
 * Zustand stores (`state/`) and every component. They are deliberately plain
 * structural types with no methods so they serialise cleanly to JSON — the whole
 * point of the local-first design is that a row can be shipped to a future
 * backend adapter without translation.
 *
 * Naming note: this is a brand-new app, so nothing here needs to keep an
 * upstream `excalidraw` spelling. See REBRAND.md for the Part 1 rules that still
 * apply to `excalidraw-app` and `packages/*`.
 */

/**
 * A whiteboard, conceptually what upstream Excalidraw calls a "scene".
 * `.mosaic` and `.excalidraw` files both hydrate into this shape.
 */
export type Board = {
  id: string;
  name: string;
  /** Null means "not filed" — shown under All boards but in no folder. */
  folderId: string | null;
  favorite: boolean;
  /**
   * Soft-delete marker. `null` means the board is live; a number is the epoch ms
   * at which it was trashed. We never hard-delete except via explicit
   * "delete forever" or the 30-day auto-purge, so a mis-click is recoverable.
   */
  trashedAt: number | null;
  /** PNG data URL captured on save; null until the board has been opened. */
  thumbnail: string | null;
  /**
   * Monotonic counter bumped on every scene write. Used as an optimistic
   * concurrency token so a stale autosave cannot clobber a newer scene.
   */
  sceneVersion: number;
  createdAt: number;
  updatedAt: number;
  lastOpenedAt: number | null;
  /**
   * Serialised scene (element/appState/files JSON as produced by
   * `exportToBlob` in the editor). Kept out of `Board` listings in the UI
   * because it can be large — selectors fetch it only when opening a board.
   */
  scene?: string;
  /** Approximate scene byte size, cached to drive the "size" sort without loading scenes. */
  sceneBytes?: number;
};

/** A project grouping boards. `parentId` supports one level of nesting for v1. */
export type Folder = {
  id: string;
  name: string;
  /** Palette key, not a raw hex, so themes can re-map it. See FOLDER_COLORS. */
  color: FolderColor;
  parentId: string | null;
  createdAt: number;
};

/**
 * The subset of `Folder["color"]` the UI offers. Kept as a union (not `string`)
 * so a typo is a compile error rather than a silent invisible folder.
 */
export type FolderColor =
  | "blue"
  | "green"
  | "purple"
  | "orange"
  | "pink"
  | "teal"
  | "grey";

/**
 * Audit trail. Every mutating operation appends exactly one row so the Activity
 * page can render a timeline and the per-board stats chip can count edits.
 */
export type ActivityType =
  | "create"
  | "open"
  | "rename"
  | "delete"
  | "favorite"
  | "move";

export type Activity = {
  id: string;
  type: ActivityType;
  boardId: string;
  ts: number;
  /** Human-readable extra, e.g. the old/new name for a rename. */
  detail?: string;
};

/** Sort options for the board grid (STEP 3). */
export type BoardSort = "recent" | "name" | "created" | "size";

export const BOARD_SORTS: readonly BoardSort[] = [
  "recent",
  "name",
  "created",
  "size",
] as const;

/**
 * Trash retention. After this many days a trashed board is purged for good on
 * the next app boot (STEP 7).
 */
export const TRASH_RETENTION_DAYS = 30;

/** Autosave cadence in the editor (STEP 6). */
export const AUTOSAVE_INTERVAL_MS = 10_000;

export const FOLDER_COLORS: readonly FolderColor[] = [
  "blue",
  "green",
  "purple",
  "orange",
  "pink",
  "teal",
  "grey",
] as const;
