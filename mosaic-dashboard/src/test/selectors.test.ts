import { describe, expect, it } from "vitest";

import type { Board, Folder } from "@/db/schema";
import {
  countBoardsInFolder,
  daysUntilPurge,
  formatBytes,
  matchesQuery,
  pluralize,
  relativeTime,
  selectBoards,
  sortBoards,
  unfiledBoards,
} from "@/lib/selectors";

/**
 * `selectBoards` is the single gate every grid view goes through, so these tests
 * cover the filter semantics that are easy to get subtly wrong — in particular
 * the three-way `folderId` (undefined / null / string) meaning.
 */

const HOUR = 60 * 60 * 1000;

const board = (over: Partial<Board> = {}): Board => ({
  id: over.id ?? Math.random().toString(36).slice(2),
  name: over.name ?? "Board",
  folderId: over.folderId ?? null,
  favorite: over.favorite ?? false,
  trashedAt: over.trashedAt ?? null,
  thumbnail: over.thumbnail ?? null,
  sceneVersion: over.sceneVersion ?? 0,
  createdAt: over.createdAt ?? 0,
  updatedAt: over.updatedAt ?? 0,
  lastOpenedAt: over.lastOpenedAt ?? null,
  ...(over.sceneBytes !== undefined ? { sceneBytes: over.sceneBytes } : {}),
});

describe("matchesQuery", () => {
  it("is case-insensitive and matches on substring", () => {
    expect(matchesQuery(board({ name: "Product Roadmap" }), "road")).toBe(true);
    expect(matchesQuery(board({ name: "Product Roadmap" }), "ROADMAP")).toBe(
      true,
    );
    expect(matchesQuery(board({ name: "Product Roadmap" }), "missing")).toBe(
      false,
    );
  });

  it("treats an empty or whitespace query as match-all", () => {
    expect(matchesQuery(board({ name: "Anything" }), "")).toBe(true);
    expect(matchesQuery(board({ name: "Anything" }), "   ")).toBe(true);
  });
});

describe("selectBoards filtering", () => {
  const live = board({ name: "Live", folderId: "f1", favorite: true });
  const unfiled = board({ name: "Unfiled" });
  const trashed = board({ name: "Trashed", trashedAt: Date.now() });
  const all = [live, unfiled, trashed];

  it("hides trashed boards by default", () => {
    expect(selectBoards(all).map((b) => b.name)).toEqual(["Live", "Unfiled"]);
  });

  it("includeTrashed shows trashed boards and hides live ones", () => {
    expect(
      selectBoards(all, { includeTrashed: true }).map((b) => b.name),
    ).toEqual(["Trashed"]);
  });

  it("favoritesOnly narrows to starred boards", () => {
    expect(
      selectBoards(all, { favoritesOnly: true }).map((b) => b.name),
    ).toEqual(["Live"]);
  });

  it("folderId: string scopes to that folder", () => {
    expect(selectBoards(all, { folderId: "f1" }).map((b) => b.name)).toEqual([
      "Live",
    ]);
    expect(selectBoards(all, { folderId: "nope" })).toHaveLength(0);
  });

  it("folderId: null scopes to unfiled boards only", () => {
    expect(selectBoards(all, { folderId: null }).map((b) => b.name)).toEqual([
      "Unfiled",
    ]);
  });

  it("folderId: undefined applies no folder filter", () => {
    expect(selectBoards(all)).toHaveLength(2);
  });

  it("combines folder + query", () => {
    expect(
      selectBoards(all, { folderId: "f1", query: "liv" }).map((b) => b.name),
    ).toEqual(["Live"]);
    expect(selectBoards(all, { folderId: "f1", query: "unfil" })).toHaveLength(0);
  });
});

describe("sortBoards", () => {
  it("recent prefers lastOpenedAt, falling back to updatedAt", () => {
    const neverOpened = board({ name: "Never", updatedAt: 900 });
    const old = board({ name: "Old", updatedAt: 100, lastOpenedAt: 200 });
    const fresh = board({ name: "Fresh", updatedAt: 100, lastOpenedAt: 999 });

    expect(sortBoards([neverOpened, old, fresh], "recent").map((b) => b.name)).toEqual(
      ["Fresh", "Never", "Old"],
    );
  });

  it("name sorts alphabetically, case-insensitive", () => {
    const rows = [board({ name: "beta" }), board({ name: "Alpha" })];
    expect(sortBoards(rows, "name").map((b) => b.name)).toEqual(["Alpha", "beta"]);
  });

  it("created sorts newest first", () => {
    const rows = [
      board({ name: "old", createdAt: 1 }),
      board({ name: "new", createdAt: 999 }),
    ];
    expect(sortBoards(rows, "created").map((b) => b.name)).toEqual(["new", "old"]);
  });

  it("size sorts largest first and puts unknown sizes last", () => {
    const rows = [
      board({ name: "unknown" }),
      board({ name: "small", sceneBytes: 10 }),
      board({ name: "big", sceneBytes: 5000 }),
    ];
    expect(sortBoards(rows, "size").map((b) => b.name)).toEqual([
      "big",
      "small",
      "unknown",
    ]);
  });

  it("does not mutate the input array", () => {
    const rows = [board({ name: "b" }), board({ name: "a" })];
    const before = rows.map((r) => r.name);
    sortBoards(rows, "name");
    expect(rows.map((r) => r.name)).toEqual(before);
  });
});

describe("folder helpers", () => {
  it("countBoardsInFolder ignores trashed boards", () => {
    const rows = [
      board({ folderId: "f1" }),
      board({ folderId: "f1", trashedAt: 5 }),
      board({ folderId: "f2" }),
    ];
    expect(countBoardsInFolder(rows, "f1")).toBe(1);
  });

  it("unfiledBoards excludes trashed and foldered boards", () => {
    const rows = [
      board({ folderId: null }),
      board({ folderId: "f1" }),
      board({ folderId: null, trashedAt: 3 }),
    ];
    expect(unfiledBoards(rows)).toHaveLength(1);
  });
});

describe("formatting helpers", () => {
  it("pluralize handles singular and plural", () => {
    expect(pluralize(1, "board")).toBe("1 board");
    expect(pluralize(3, "board")).toBe("3 boards");
    expect(pluralize(0, "board")).toBe("0 boards");
  });

  it("formatBytes renders a dash for unknown size", () => {
    expect(formatBytes(undefined)).toBe("—");
    expect(formatBytes(0)).toBe("—");
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(2048)).toBe("2.0 KB");
    expect(formatBytes(5 * 1024 * 1024)).toBe("5.0 MB");
  });

  it("relativeTime produces human phrasing", () => {
    const now = Date.now();
    expect(relativeTime(now - 2 * HOUR, now)).toMatch(/hour/);
    expect(relativeTime(now - 3 * 24 * HOUR, now)).toMatch(/day/);
  });

  it("daysUntilPurge counts down and floors at zero", () => {
    const now = Date.now();
    const trashedYesterday = board({ trashedAt: now - 24 * HOUR });
    expect(daysUntilPurge(trashedYesterday, 30, now)).toBe(29);

    // Trashed long ago: already past the window.
    const ancient = board({ trashedAt: now - 60 * 24 * HOUR });
    expect(daysUntilPurge(ancient, 30, now)).toBe(0);

    expect(daysUntilPurge(board(), 30, now)).toBeNull();
  });
});

describe("folder type compatibility", () => {
  it("Folder carries a nested parentId for one level of nesting", () => {
    const parent: Folder = {
      id: "p",
      name: "Parent",
      color: "blue",
      parentId: null,
      createdAt: 0,
    };
    const child: Folder = { ...parent, id: "c", parentId: "p" };
    expect(child.parentId).toBe("p");
  });
});