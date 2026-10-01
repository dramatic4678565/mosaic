import Dexie, { type Table } from "dexie";

import type { Activity, Board, Folder } from "./schema";

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
 */
export class MosaicDB extends Dexie {
  boards!: Table<Board, string>;
  folders!: Table<Folder, string>;
  activity!: Table<Activity, string>;

  constructor(name = DEFAULT_DB_NAME) {
    super(name);
    this.version(1).stores({
      boards: "id, name, folderId, trashedAt, updatedAt, createdAt, lastOpenedAt",
      folders: "id, name, parentId, createdAt",
      activity: "id, type, boardId, ts",
    });
  }
}

export const DEFAULT_DB_NAME = "mosaic-dashboard";

/**
 * Singleton used by the running app. Tests construct their own `MosaicDB` with
 * a throwaway name instead of sharing this one.
 */
export const db = new MosaicDB();

/**
 * Drops every table. Used by tests between cases and by the "reset local data"
 * action on the Settings page.
 */
export const resetDatabase = async () => {
  await Promise.all([db.boards.clear(), db.folders.clear(), db.activity.clear()]);
};

/**
 * Closes the connection. Required by Dexie before deleting/reopening a database
 * under the same name in the same page session (which tests do constantly).
 */
export const closeDatabase = () => db.close();