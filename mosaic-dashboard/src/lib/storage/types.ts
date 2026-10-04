import type { Activity, Board, Folder, FolderColor } from "@/db/schema";

/**
 * The storage contract the dashboard programs against.
 *
 * This is the seam that lets the same UI run against IndexedDB (local dev, tests,
 * offline) and against the Neon-backed API (production). Components never import a
 * backend; they import `{ storage }` from `storage/index.ts` and call these
 * methods.
 *
 * ## What "drop-in" means here
 *
 * The signatures deliberately mirror the Dexie implementations in
 * `storage/indexeddb.ts` one-for-one, including the awkward parts:
 *
 * - Mutations that cannot find their row return `undefined` rather than throwing.
 *   `renameBoard` returns `undefined` for a blank name *and* for a missing id, so
 *   callers already handle both.
 * - `deleteBoardForever`, `trashBoard` and friends return `void`, not a boolean.
 * - `listTrashedBoardsLite` exists alongside `listTrashedBoards` because the trash
 *   grid never renders scenes and loading them would be wasted work.
 *
 * Preserving those shapes is what lets `storage/indexeddb.ts` be the *same code
 * that already shipped* rather than a rewrite, and it keeps every existing test
 * meaningful.
 *
 * ## Deliberate exceptions
 *
 * `StorageAdapter` covers boards, folders, activity and stats. In production
 * (`VITE_API_URL` set) the boards operations go to the API and the rest are
 * served by the local IndexedDB adapter — see `storage/api.ts`, which takes the
 * local adapter as a fallback. That is a real gap in PART 3A, not an oversight:
 * STEP 3 only specified `api/health.ts` and `api/boards/*`, so there are no
 * server endpoints for folders or activity to call.
 */

/** Per-board activity counts rendered on the card chip. */
export type BoardStats = {
  /** Total number of audited events for the board. */
  total: number;
  /** Events within the last 7 days — what the card chip renders. */
  last7Days: number;
  /** Timestamp of the most recent event, or null if never touched. */
  lastActivityAt: number | null;
};

/** Options accepted by {@link listBoards}. */
export type ListBoardsOptions = {
  /** `undefined` = no folder filtering; `null` = unfiled only. */
  folderId?: string | null;
  /** Include soft-deleted boards. Only the trash page sets this. */
  includeTrashed?: boolean;
};

/** Payload for a scene write. */
export type SaveScenePayload = {
  scene: string;
  thumbnail: string | null;
  /**
   * Optimistic-concurrency token. When set, the write is skipped if the stored
   * version has moved on, so a slow autosave cannot clobber a newer scene.
   */
  baseVersion?: number;
};

export interface StorageAdapter {
  /* ---- boards: read ---- */

  /** Creates a board. `name` defaults to "Untitled board". */
  createBoard(partial?: Partial<Board>): Promise<Board>;

  /** Live boards by default; pass `includeTrashed` for the trash page. */
  listBoards(options?: ListBoardsOptions): Promise<Board[]>;

  /** Full row *including* `scene`. Used when opening a board in the editor. */
  getBoardWithScene(id: string): Promise<Board | undefined>;

  getBoard(id: string): Promise<Board | undefined>;

  /* ---- boards: mutate ---- */

  /** Returns `undefined` for a blank name or a missing board. */
  renameBoard(id: string, name: string): Promise<Board | undefined>;

  setFavorite(id: string, favorite: boolean): Promise<Board | undefined>;

  toggleFavorite(id: string): Promise<Board | undefined>;

  /** `null` moves the board to unfiled. */
  moveBoardToFolder(
    id: string,
    folderId: string | null,
  ): Promise<Board | undefined>;

  /** Copies scene + thumbnail; always created unfiled and unfavourited. */
  duplicateBoard(id: string): Promise<Board | undefined>;

  /** Honours `baseVersion`; returns `undefined` if the write was skipped. */
  saveBoardScene(
    id: string,
    payload: SaveScenePayload,
  ): Promise<Board | undefined>;

  /** Records an open, which drives the "recent" sort and the activity feed. */
  markBoardOpened(id: string): Promise<void>;

  /* ---- boards: trash ---- */

  trashBoard(id: string): Promise<void>;

  restoreBoard(id: string): Promise<void>;

  /** Hard delete, including the board's activity rows. */
  deleteBoardForever(id: string): Promise<void>;

  listTrashedBoards(): Promise<Board[]>;

  /** Trashed boards without `scene` — the trash grid never renders them. */
  listTrashedBoardsLite(): Promise<Board[]>;

  emptyTrash(): Promise<void>;

  /** Purges boards trashed longer than `retentionDays`; returns the ids. */
  purgeExpiredTrash(retentionDays?: number): Promise<string[]>;

  /* ---- folders ---- */

  createFolder(partial?: Partial<Folder>): Promise<Folder>;

  listFolders(): Promise<Folder[]>;

  getFolder(id: string): Promise<Folder | undefined>;

  renameFolder(id: string, name: string): Promise<Folder | undefined>;

  recolorFolder(id: string, color: FolderColor): Promise<Folder | undefined>;

  /**
   * Deletes a folder and unfiles its boards rather than deleting them, so tidying
   * the sidebar never loses work.
   */
  deleteFolder(id: string): Promise<void>;

  /* ---- activity ---- */

  listActivity(limit?: number): Promise<Activity[]>;

  listBoardActivity(boardId: string, limit?: number): Promise<Activity[]>;

  /* ---- derived ---- */

  getBoardStats(boardId: string): Promise<BoardStats>;

  /** Bulk stats for many boards in one pass, keyed by board id. */
  getBoardStatsMap(): Promise<Record<string, BoardStats>>;
}

/**
 * Extra, non-`StorageAdapter` helpers that only exist for the local backend.
 *
 * Tests and the Settings page need to reach the underlying IndexedDB — to build a
 * throwaway database, close it, or wipe it — and those concepts do not exist for
 * an HTTP backend. They are kept off the main interface so no component is ever
 * tempted to call them.
 */
export type LocalStorageExtras = {
  /** Drops every table. Settings page "reset local data" and test setup. */
  resetDatabase(): Promise<void>;
  /** Required by Dexie before deleting/reopening a database in one session. */
  closeDatabase(): Promise<void>;
};
