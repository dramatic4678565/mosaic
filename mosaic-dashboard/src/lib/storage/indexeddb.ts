import Dexie, { type Table } from "dexie";

import type {
  Activity,
  ActivityType,
  Board,
  Folder,
  FolderColor,
} from "@/db/schema";

import type {
  BoardStats,
  ListBoardsOptions,
  SaveScenePayload,
  StorageAdapter,
} from "./types";

import { TRASH_RETENTION_DAYS } from "@/db/schema";

/**
 * The local, IndexedDB-backed {@link StorageAdapter}.
 *
 * **This is the only module in the app that imports `dexie`.** That is the whole
 * point of the storage seam: everything else talks to the `StorageAdapter`
 * interface, so the dependency can be dropped wholesale later without touching a
 * single component.
 *
 * The bodies below are the code that already shipped in `db/operations.ts`,
 * unchanged in behaviour. They were moved rather than rewritten on purpose:
 * `db.test.ts` asserts on this exact logic (soft delete, the `sceneVersion`
 * compare-and-set, the unfile-don't-delete rule), and a refactor that changed
 * behaviour while relocating it would make a green suite meaningless.
 */

/* -------------------------------------------------------------------------- */
/* Schema                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * IndexedDB schema, version 1.
 *
 * Notes on the indexes:
 *
 * - `boards.folderId` is indexed because the folder view and the "boards in
 *   folder N" query run on every sidebar navigation.
 * - `boards.trashedAt` is indexed for the same reason: the trash page filters on
 *   it, and so does the 30-day purge sweep.
 * - `boards.updatedAt` backs the default "recent" sort.
 * - `boards.favorite` is intentionally NOT indexed. At the scale a single
 *   browser can hold (hundreds of boards) a full scan is cheaper than paying
 *   the index maintenance cost on every favourite toggle, which is far more
 *   frequent than the query.
 * - `activity.boardId` is indexed so the per-board stats chip can count edits
 *   without loading the whole timeline.
 *
 * The mirror of this schema in Postgres is `db/migrations/001_init.sql` plus
 * `002_align_boards_with_app_schema.sql`; `lastOpenedAt` and `sceneBytes` were
 * the two fields the initial Postgres schema was missing.
 */
export class MosaicDB extends Dexie {
  boards!: Table<Board, string>;
  folders!: Table<Folder, string>;
  activity!: Table<Activity, string>;

  constructor(name = DEFAULT_DB_NAME) {
    super(name);
    this.version(1).stores({
      boards:
        "id, name, folderId, trashedAt, updatedAt, createdAt, lastOpenedAt",
      folders: "id, name, parentId, createdAt",
      activity: "id, type, boardId, ts",
    });
  }
}

export const DEFAULT_DB_NAME = "mosaic-dashboard";

/**
 * Collision-resistant enough for client-generated ids while staying short.
 * `crypto.randomUUID` is used when available because it is the standard, with a
 * manual fallback for non-secure contexts (http on a LAN IP, some webviews).
 */
export const newId = (): string => {
  const c = globalThis.crypto;
  if (c && typeof c.randomUUID === "function") {
    return c.randomUUID();
  }
  if (c && typeof c.getRandomValues === "function") {
    const bytes = c.getRandomValues(new Uint8Array(16));
    return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  }
  return `${Date.now().toString(36)}-${Math.random()
    .toString(36)
    .slice(2, 12)}`;
};

const now = () => Date.now();

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

/* -------------------------------------------------------------------------- */
/* Adapter                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Builds an adapter over a specific database.
 *
 * A factory rather than a hard-coded singleton so tests can point it at a
 * throwaway database name and get full isolation; the app uses the
 * {@link indexedDbAdapter} singleton below.
 */
export const createIndexedDbAdapter = (db: MosaicDB): StorageAdapter => {
  /** Appends one audit row. Called by every mutation below. */
  const logActivity = async (
    type: ActivityType,
    boardId: string,
    detail?: string,
  ): Promise<void> => {
    await db.activity.add({
      id: newId(),
      type,
      boardId,
      ts: now(),
      ...(detail !== undefined ? { detail } : {}),
    });
  };

  /* ---- boards: read ---- */

  /**
   * Creates a board. `name` defaults to "Untitled board" so the caller (the
   * "New board" button, or the smoke test) does not have to invent one.
   */
  const createBoard = async (partial: Partial<Board> = {}): Promise<Board> => {
    const ts = now();
    const board: Board = {
      id: partial.id ?? newId(),
      name: partial.name ?? "Untitled board",
      folderId: partial.folderId ?? null,
      favorite: false,
      trashedAt: null,
      thumbnail: null,
      sceneVersion: 0,
      createdAt: ts,
      updatedAt: ts,
      lastOpenedAt: null,
      ...(partial.scene !== undefined ? { scene: partial.scene } : {}),
      ...(partial.thumbnail !== undefined
        ? { thumbnail: partial.thumbnail }
        : {}),
    };
    await db.boards.add(board);
    await logActivity("create", board.id);
    return board;
  };

  /**
   * Boards that are not trashed. `thumbnail` is included (it is cheap and the grid
   * needs it) but `scene` is stripped: scenes can be megabytes and the grid never
   * renders them, so loading every scene on boot would be wasteful. Use
   * `getBoardWithScene` when you actually need the scene.
   */
  const listBoards = async (
    options: ListBoardsOptions = {},
  ): Promise<Board[]> => {
    const { folderId, includeTrashed = false } = options;

    const withoutScene = (rows: Board[]): Board[] =>
      rows.map(({ scene: _scene, ...rest }) => rest);

    if (typeof folderId === "string") {
      const rows = await db.boards.where("folderId").equals(folderId).toArray();
      const scoped = includeTrashed
        ? rows
        : rows.filter((b) => b.trashedAt === null);
      return withoutScene(scoped);
    }

    if (folderId === null) {
      const rows = await db.boards.toArray();
      const scoped = includeTrashed
        ? rows
        : rows.filter((b) => b.trashedAt === null);
      return withoutScene(scoped.filter((b) => b.folderId === null));
    }

    const rows = await db.boards.toArray();
    const scoped = includeTrashed
      ? rows
      : rows.filter((b) => b.trashedAt === null);
    return withoutScene(scoped);
  };

  /** Full row including `scene`. Used when opening a board in the editor. */
  const getBoardWithScene = async (id: string): Promise<Board | undefined> => {
    const board = await db.boards.get(id);
    if (!board) {
      return undefined;
    }
    const { scene, ...rest } = board;
    return { ...rest, ...(scene !== undefined ? { scene } : {}) };
  };

  const getBoard = async (id: string): Promise<Board | undefined> =>
    db.boards.get(id);

  /* ---- boards: mutate ---- */

  const renameBoard = async (
    id: string,
    name: string,
  ): Promise<Board | undefined> => {
    const trimmed = name.trim();
    if (!trimmed) {
      return undefined;
    }
    const board = await db.boards.update(id, {
      name: trimmed,
      updatedAt: now(),
    });
    if (board > 0) {
      await logActivity("rename", id, trimmed);
    }
    return db.boards.get(id);
  };

  /**
   * Toggles the star. Pass an explicit value so the activity row can describe the
   * resulting state rather than the toggle direction.
   */
  const setFavorite = async (
    id: string,
    favorite: boolean,
  ): Promise<Board | undefined> => {
    const result = await db.boards.update(id, {
      favorite,
      updatedAt: now(),
    });
    if (result > 0) {
      await logActivity("favorite", id, favorite ? "on" : "off");
    }
    return db.boards.get(id);
  };

  const toggleFavorite = async (id: string): Promise<Board | undefined> => {
    const board = await db.boards.get(id);
    if (!board) {
      return undefined;
    }
    return setFavorite(id, !board.favorite);
  };

  /** Moves a board into a folder (`null` = unfiled). */
  const moveBoardToFolder = async (
    id: string,
    folderId: string | null,
  ): Promise<Board | undefined> => {
    const result = await db.boards.update(id, {
      folderId,
      updatedAt: now(),
    });
    if (result > 0) {
      await logActivity("move", id, folderId ?? "");
    }
    return db.boards.get(id);
  };

  /**
   * Copies a board, including its scene so the duplicate is immediately usable.
   * The copy is always created unfiled and unfavourited — duplicating should not
   * silently clone organisation decisions.
   */
  const duplicateBoard = async (id: string): Promise<Board | undefined> => {
    const source = await db.boards.get(id);
    if (!source) {
      return undefined;
    }
    return createBoard({
      name: `${source.name} (copy)`,
      scene: source.scene,
      thumbnail: source.thumbnail,
    });
  };

  /**
   * Persists scene + thumbnail and bumps `sceneVersion`.
   *
   * `sceneVersion` is a compare-and-set guard: the caller passes the version it
   * loaded, and the write is skipped if the stored version has moved on. Without
   * it, a slow autosave firing after the user has already saved from another tab
   * would silently revert their newer work.
   */
  const saveBoardScene = async (
    id: string,
    payload: SaveScenePayload,
  ): Promise<Board | undefined> => {
    const board = await db.boards.get(id);
    if (!board) {
      return undefined;
    }

    if (
      payload.baseVersion !== undefined &&
      payload.baseVersion !== board.sceneVersion
    ) {
      // Stale writer — do not clobber. Caller re-reads if it still wants to save.
      return undefined;
    }

    await db.boards.update(id, {
      scene: payload.scene,
      thumbnail: payload.thumbnail,
      sceneBytes: payload.scene.length,
      sceneVersion: board.sceneVersion + 1,
      updatedAt: now(),
    });
    return db.boards.get(id);
  };

  /** Records that a board was opened (drives the "recent" sort and activity). */
  const markBoardOpened = async (id: string): Promise<void> => {
    await db.boards.update(id, { lastOpenedAt: now(), updatedAt: now() });
    await logActivity("open", id);
  };

  /* ---- trash ---- */

  /** Soft-deletes. Sets `trashedAt`, keeps the row and its activity history. */
  const trashBoard = async (id: string): Promise<void> => {
    await db.boards.update(id, { trashedAt: now(), updatedAt: now() });
    await logActivity("delete", id, "trash");
  };

  /** Restores a soft-deleted board. */
  const restoreBoard = async (id: string): Promise<void> => {
    await db.boards.update(id, { trashedAt: null, updatedAt: now() });
    await logActivity("delete", id, "restore");
  };

  /**
   * Hard-deletes a board and its activity rows. Activity rows are removed too:
   * the per-board stats chip looks activities up by `boardId`, so orphans would
   * accumulate forever otherwise.
   */
  const deleteBoardForever = async (id: string): Promise<void> => {
    await db.transaction("rw", db.boards, db.activity, async () => {
      await db.boards.delete(id);
      await db.activity.where("boardId").equals(id).delete();
    });
  };

  const listTrashedBoards = async (): Promise<Board[]> => {
    const rows = await db.boards.where("trashedAt").above(0).toArray();
    return rows.sort((a, b) => (b.trashedAt ?? 0) - (a.trashedAt ?? 0));
  };

  /** Trashed boards only, without `scene` — the trash grid never renders them. */
  const listTrashedBoardsLite = async (): Promise<Board[]> => {
    const rows = await listTrashedBoards();
    return rows.map(({ scene: _scene, ...rest }) => rest);
  };

  const emptyTrash = async (): Promise<void> => {
    const rows = await listTrashedBoards();
    await Promise.all(rows.map((b) => deleteBoardForever(b.id)));
  };

  /**
   * Purges boards trashed longer than `retentionDays`.
   *
   * Called once on app boot. Runs in a transaction so a failure part-way through
   * cannot leave the trash half-deleted.
   */
  const purgeExpiredTrash = async (
    retentionDays: number = TRASH_RETENTION_DAYS,
  ): Promise<string[]> => {
    const cutoff = Date.now() - retentionDays * 24 * 60 * 60 * 1000;
    const rows = await db.boards.where("trashedAt").below(cutoff).toArray();
    if (!rows.length) {
      return [];
    }
    await db.transaction("rw", db.boards, db.activity, async () => {
      for (const row of rows) {
        await db.boards.delete(row.id);
        await db.activity.where("boardId").equals(row.id).delete();
      }
    });
    return rows.map((r) => r.id);
  };

  /* ---- folders ---- */

  const createFolder = async (
    partial: Partial<Folder> = {},
  ): Promise<Folder> => {
    const folder: Folder = {
      id: partial.id ?? newId(),
      name: partial.name ?? "New folder",
      color: partial.color ?? "blue",
      parentId: partial.parentId ?? null,
      createdAt: now(),
    };
    await db.folders.add(folder);
    return folder;
  };

  const listFolders = async (): Promise<Folder[]> => db.folders.toArray();

  const getFolder = async (id: string): Promise<Folder | undefined> =>
    db.folders.get(id);

  const renameFolder = async (
    id: string,
    name: string,
  ): Promise<Folder | undefined> => {
    const trimmed = name.trim();
    if (!trimmed) {
      return undefined;
    }
    await db.folders.update(id, { name: trimmed });
    return db.folders.get(id);
  };

  const recolorFolder = async (
    id: string,
    color: FolderColor,
  ): Promise<Folder | undefined> => {
    await db.folders.update(id, { color });
    return db.folders.get(id);
  };

  /**
   * Deletes a folder. Boards inside it are **not** deleted — they are unfiled
   * (`folderId = null`) so the user never loses work by tidying up the sidebar.
   */
  const deleteFolder = async (id: string): Promise<void> => {
    const childFolders = await db.folders
      .where("parentId")
      .equals(id)
      .toArray();
    await db.transaction("rw", db.folders, db.boards, async () => {
      await db.boards.where("folderId").equals(id).modify({ folderId: null });
      for (const child of childFolders) {
        await db.folders.update(child.id, { parentId: null });
      }
      await db.folders.delete(id);
    });
  };

  /* ---- activity ---- */

  const listActivity = async (limit = 200): Promise<Activity[]> => {
    const rows = await db.activity
      .orderBy("ts")
      .reverse()
      .limit(limit)
      .toArray();
    return rows;
  };

  const listBoardActivity = async (
    boardId: string,
    limit = 100,
  ): Promise<Activity[]> => {
    const rows = await db.activity
      .where("boardId")
      .equals(boardId)
      .reverse()
      .sortBy("ts");
    return rows.slice(-limit).reverse();
  };

  /**
   * Aggregates a board's activity into the stats shown on the card chip.
   *
   * Derived from the existing rows rather than stored as counters: the numbers are
   * only ever read one board at a time, and counters would need to be kept in sync
   * across three different code paths (create/rename/delete/favorite/move) with
   * no transactional benefit.
   */
  const getBoardStats = async (boardId: string): Promise<BoardStats> => {
    const rows = await db.activity.where("boardId").equals(boardId).toArray();
    if (!rows.length) {
      return { total: 0, last7Days: 0, lastActivityAt: null };
    }
    const cutoff = Date.now() - SEVEN_DAYS_MS;
    let last7Days = 0;
    let lastActivityAt: number | null = null;
    for (const row of rows) {
      if (row.ts >= cutoff) {
        last7Days += 1;
      }
      if (lastActivityAt === null || row.ts > lastActivityAt) {
        lastActivityAt = row.ts;
      }
    }
    return { total: rows.length, last7Days, lastActivityAt };
  };

  /** Bulk stats for many boards in one pass, keyed by board id. */
  const getBoardStatsMap = async (): Promise<Record<string, BoardStats>> => {
    const rows = await db.activity.toArray();
    const cutoff = Date.now() - SEVEN_DAYS_MS;
    const map: Record<string, BoardStats> = {};
    for (const row of rows) {
      const entry = (map[row.boardId] ??= {
        total: 0,
        last7Days: 0,
        lastActivityAt: null,
      });
      entry.total += 1;
      if (row.ts >= cutoff) {
        entry.last7Days += 1;
      }
      if (entry.lastActivityAt === null || row.ts > entry.lastActivityAt) {
        entry.lastActivityAt = row.ts;
      }
    }
    return map;
  };

  return {
    createBoard,
    listBoards,
    getBoardWithScene,
    getBoard,
    renameBoard,
    setFavorite,
    toggleFavorite,
    moveBoardToFolder,
    duplicateBoard,
    saveBoardScene,
    markBoardOpened,
    trashBoard,
    restoreBoard,
    deleteBoardForever,
    listTrashedBoards,
    listTrashedBoardsLite,
    emptyTrash,
    purgeExpiredTrash,
    createFolder,
    listFolders,
    getFolder,
    renameFolder,
    recolorFolder,
    deleteFolder,
    listActivity,
    listBoardActivity,
    getBoardStats,
    getBoardStatsMap,
  };
};

/**
 * Singleton used by the running app. Tests construct their own `MosaicDB` with a
 * throwaway name instead of sharing this one.
 */
export const db = new MosaicDB();

export const indexedDbAdapter = createIndexedDbAdapter(db);

/**
 * Drops every table. Used by tests between cases and by the "reset local data"
 * action on the Settings page.
 */
export const resetDatabase = async () => {
  await Promise.all([
    db.boards.clear(),
    db.folders.clear(),
    db.activity.clear(),
  ]);
};

/**
 * Closes the connection. Required by Dexie before deleting/reopening a database
 * under the same name in the same page session (which tests do constantly).
 */
export const closeDatabase = async () => db.close();
