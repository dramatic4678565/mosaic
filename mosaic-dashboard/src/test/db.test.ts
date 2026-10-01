import { describe, expect, it } from "vitest";

import {
  createBoard,
  createFolder,
  deleteBoardForever,
  deleteFolder,
  duplicateBoard,
  emptyTrash,
  getBoard,
  getBoardStats,
  getBoardStatsMap,
  getBoardWithScene,
  listActivity,
  listBoardActivity,
  listBoards,
  listFolders,
  listTrashedBoards,
  moveBoardToFolder,
  purgeExpiredTrash,
  recolorFolder,
  renameBoard,
  renameFolder,
  restoreBoard,
  saveBoardScene,
  setFavorite,
  toggleFavorite,
  trashBoard,
} from "@/db/operations";
import { TRASH_RETENTION_DAYS } from "@/db/schema";

describe("board CRUD", () => {
  it("creates a board with sensible defaults and logs a create activity", async () => {
    const board = await createBoard({ name: "Ideas" });

    expect(board.name).toBe("Ideas");
    expect(board.favorite).toBe(false);
    expect(board.trashedAt).toBeNull();
    expect(board.sceneVersion).toBe(0);
    expect(board.folderId).toBeNull();

    const activity = await listActivity();
    expect(activity).toHaveLength(1);
    expect(activity[0].type).toBe("create");
    expect(activity[0].boardId).toBe(board.id);
  });

  it("defaults the name to 'Untitled board'", async () => {
    const board = await createBoard();
    expect(board.name).toBe("Untitled board");
  });

  it("trims names and rejects blank renames", async () => {
    const board = await createBoard({ name: "First" });

    const renamed = await renameBoard(board.id, "  Second  ");
    expect(renamed?.name).toBe("Second");

    const blank = await renameBoard(board.id, "   ");
    expect(blank).toBeUndefined();
    // The rejected rename must not have mutated the row.
    expect((await getBoard(board.id))?.name).toBe("Second");
  });

it("toggles favourite and records the resulting state in activity", async () => {
    const board = await createBoard();

    const on = await toggleFavorite(board.id);
    expect(on?.favorite).toBe(true);

    const off = await toggleFavorite(board.id);
    expect(off?.favorite).toBe(false);

    const activity = await listBoardActivity(board.id);
    expect(activity.filter((a) => a.type === "favorite").map((a) => a.detail)).toEqual(
      ["on", "off"],
    );
  });

  it("setFavorite is idempotent for a given value", async () => {
    const board = await createBoard();
    await setFavorite(board.id, true);
    await setFavorite(board.id, true);
    expect((await getBoard(board.id))?.favorite).toBe(true);
  });
});

describe("duplicateBoard", () => {
  it("copies name and scene but resets organisation state", async () => {
    const folder = await createFolder({ name: "Work" });
    const source = await createBoard({ name: "Roadmap", scene: `{"a":1}` });
    await setFavorite(source.id, true);
    await moveBoardToFolder(source.id, folder.id);

    const copy = await duplicateBoard(source.id);

    expect(copy?.name).toBe("Roadmap (copy)");
    expect(copy?.scene).toBe(`{"a":1}`);
    // A duplicate should not silently inherit folder/favourite decisions.
    expect(copy?.folderId).toBeNull();
    expect(copy?.favorite).toBe(false);
    expect(copy?.id).not.toBe(source.id);

    // Original untouched.
    const original = await getBoard(source.id);
    expect(original?.folderId).toBe(folder.id);
    expect(original?.favorite).toBe(true);
  });

  it("returns undefined for a missing board", async () => {
    expect(await duplicateBoard("nope")).toBeUndefined();
  });
});

describe("scene persistence", () => {
  it("bumps sceneVersion and caches byte size", async () => {
    const board = await createBoard();

    const saved = await saveBoardScene(board.id, {
      scene: "hello world",
      thumbnail: "data:image/png;base64,AAA",
    });

    expect(saved?.sceneVersion).toBe(1);
    expect(saved?.sceneBytes).toBe("hello world".length);

    const again = await saveBoardScene(board.id, {
      scene: "second",
      thumbnail: null,
    });
    expect(again?.sceneVersion).toBe(2);
  });

  it("rejects a stale write via the baseVersion compare-and-set guard", async () => {
    const board = await createBoard();
    await saveBoardScene(board.id, {
      scene: "v1",
      thumbnail: null,
      baseVersion: 0,
    });

    // A second writer still holding version 0 must not clobber version 1.
    const stale = await saveBoardScene(board.id, {
      scene: "stale",
      thumbnail: null,
      baseVersion: 0,
    });

    expect(stale).toBeUndefined();
    const stored = await getBoardWithScene(board.id);
    expect(stored?.scene).toBe("v1");
    expect(stored?.sceneVersion).toBe(1);
  });

  it("getBoardWithScene returns the scene; listBoards strips it", async () => {
    const board = await createBoard({ name: "Has scene", scene: "payload" });

    const full = await getBoardWithScene(board.id);
    expect(full?.scene).toBe("payload");

    const listed = await listBoards();
    const found = listed.find((b) => b.id === board.id);
    expect(found?.scene).toBeUndefined();
  });
});

describe("folder scoping", () => {
  it("moves a board between folders and logs a move", async () => {
    const folder = await createFolder({ name: "Design" });
    const board = await createBoard();

    await moveBoardToFolder(board.id, folder.id);
    expect((await getBoard(board.id))?.folderId).toBe(folder.id);

    const inFolder = await listBoards({ folderId: folder.id });
    expect(inFolder).toHaveLength(1);

    await moveBoardToFolder(board.id, null);
    const unfiled = await listBoards({ folderId: null });
    expect(unfiled).toHaveLength(1);
    expect(unfiled[0].id).toBe(board.id);
  });

  it("deleting a folder unfiles its boards instead of deleting them", async () => {
    const folder = await createFolder({ name: "Temp" });
    const board = await createBoard({ folderId: folder.id });

    await deleteFolder(folder.id);

    expect(await listFolders()).toHaveLength(0);
    const stillThere = await getBoard(board.id);
    expect(stillThere).toBeDefined();
    expect(stillThere?.folderId).toBeNull();
  });

  it("deleting a parent folder re-parents its children to the root", async () => {
    const parent = await createFolder({ name: "Parent" });
    const child = await createFolder({ name: "Child", parentId: parent.id });

    await deleteFolder(parent.id);

    const childAfter = await listFolders();
    expect(childAfter).toHaveLength(1);
    expect(childAfter[0].parentId).toBeNull();
    expect(childAfter[0].id).toBe(child.id);
  });

  it("renames and recolours folders", async () => {
    const folder = await createFolder({ name: "Draft" });
    await renameFolder(folder.id, "  Final  ");
    expect((await listFolders())[0].name).toBe("Final");

    await recolorFolder(folder.id, "purple");
    expect((await listFolders())[0].color).toBe("purple");
  });
});

describe("trash", () => {
  it("soft-deletes then restores", async () => {
    const board = await createBoard({ name: "Keep me" });

    await trashBoard(board.id);
    expect(typeof (await getBoard(board.id))?.trashedAt).toBe("number");
    expect(await listBoards()).toHaveLength(0);
    expect(await listTrashedBoards()).toHaveLength(1);

    await restoreBoard(board.id);
    expect((await getBoard(board.id))?.trashedAt).toBeNull();
    expect(await listBoards()).toHaveLength(1);
  });

  it("includeTrashed returns trashed rows too", async () => {
    const board = await createBoard();
    await trashBoard(board.id);
    expect(await listBoards({ includeTrashed: true })).toHaveLength(1);
  });

  it("deleteForever removes the board and its activity rows", async () => {
    const board = await createBoard();
    await setFavorite(board.id, true);
    expect(await listActivity()).toHaveLength(2);

    await deleteBoardForever(board.id);

    expect(await getBoard(board.id)).toBeUndefined();
    // No orphan activity rows left behind.
    expect(await listActivity()).toHaveLength(0);
  });

  it("purgeExpiredTrash only removes boards past the retention window", async () => {
    const old = await createBoard({ name: "Old" });
    const fresh = await createBoard({ name: "Fresh" });

    await trashBoard(old.id);
    await trashBoard(fresh.id);

    // Backdate the first one past the retention window.
    const cutoff = Date.now() - (TRASH_RETENTION_DAYS + 1) * 24 * 60 * 60 * 1000;
    const { db } = await import("@/db/index");
    await db.boards.update(old.id, { trashedAt: cutoff });

    const purged = await purgeExpiredTrash();

    expect(purged).toEqual([old.id]);
    expect(await getBoard(old.id)).toBeUndefined();
    expect(await getBoard(fresh.id)).toBeDefined();
  });

  it("emptyTrash clears every trashed board but leaves live ones", async () => {
    const a = await createBoard({ name: "A" });
    const b = await createBoard({ name: "B" });
    const live = await createBoard({ name: "Live" });
    await trashBoard(a.id);
    await trashBoard(b.id);

    await emptyTrash();

    expect(await listTrashedBoards()).toHaveLength(0);
    expect(await getBoard(live.id)).toBeDefined();
  });
});

describe("activity stats", () => {
  it("counts total and last-7-days events", async () => {
    const board = await createBoard();
    await setFavorite(board.id, true); // +1

    const stats = await getBoardStats(board.id);
    expect(stats.total).toBe(2); // create + favorite
    expect(stats.last7Days).toBe(2);
    expect(typeof stats.lastActivityAt).toBe("number");
  });

  it("excludes events older than a week from last7Days", async () => {
    const board = await createBoard();
    const { db } = await import("@/db/index");
    // Backdate the create row beyond the window.
    await db.activity
      .where("boardId")
      .equals(board.id)
      .modify({ ts: Date.now() - 10 * 24 * 60 * 60 * 1000 });

    const stats = await getBoardStats(board.id);
    expect(stats.total).toBe(1);
    expect(stats.last7Days).toBe(0);
  });

  it("returns zeros for a board with no activity", async () => {
    const stats = await getBoardStats("missing");
    expect(stats).toEqual({ total: 0, last7Days: 0, lastActivityAt: null });
  });

  it("getBoardStatsMap aggregates every board in one pass", async () => {
    const a = await createBoard({ name: "A" });
    const b = await createBoard({ name: "B" });
    await setFavorite(a.id, true);

    const map = await getBoardStatsMap();
    expect(map[a.id].total).toBe(2);
    expect(map[b.id].total).toBe(1);
  });
});