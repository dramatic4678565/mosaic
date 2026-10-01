import type { Board, BoardSort, Folder } from "@/db/schema";

/**
 * Pure view-model helpers over boards and folders.
 *
 * These live outside the components on purpose: the grid, the sidebar and the
 * trash page all need the same filtering and sorting rules, and making them pure
 * functions means the rules are unit-testable without mounting React.
 */

/** Case-insensitive name match across name and folder name. */
export const matchesQuery = (board: Board, query: string): boolean => {
  const q = query.trim().toLowerCase();
  if (!q) {
    return true;
  }
  return board.name.toLowerCase().includes(q);
};

/** "3 boards" / "1 board" — avoids a plural bug in three different places. */
export const pluralize = (count: number, singular: string, plural?: string) =>
  `${count} ${count === 1 ? singular : (plural ?? `${singular}s`)}`;

const byName = (a: Board, b: Board) =>
  a.name.localeCompare(b.name, undefined, { sensitivity: "base" });

/**
 * Sorts a board list. Always returns a new array so callers can rely on
 * referential change to trigger re-renders.
 */
export const sortBoards = (boards: Board[], sort: BoardSort): Board[] => {
  const next = [...boards];
  switch (sort) {
    case "name":
      return next.sort(byName);
    case "created":
      return next.sort((a, b) => b.createdAt - a.createdAt);
    case "size":
      // Unknown size (never opened) sorts last rather than first, so the grid
      // does not open with a wall of 0-byte placeholders.
      return next.sort(
        (a, b) => (b.sceneBytes ?? -1) - (a.sceneBytes ?? -1),
      );
    case "recent":
    default:
      // Fall back to updatedAt when a board has never been opened, otherwise
      // "recent" would rank every untouched board as ancient.
      return next.sort((a, b) => {
        const aTime = a.lastOpenedAt ?? a.updatedAt;
        const bTime = b.lastOpenedAt ?? b.updatedAt;
        return bTime - aTime;
      });
  }
};

export type BoardFilters = {
  query?: string;
  sort?: BoardSort;
  folderId?: string | null;
  favoritesOnly?: boolean;
  /** Include soft-deleted boards. Only the trash page sets this. */
  includeTrashed?: boolean;
};

/**
 * Applies folder scope + search + favourites + sort in one pass.
 *
 * `folderId` semantics:
 *  - `undefined` → no folder filtering (All boards)
 *  - `null`      → only unfiled boards
 *  - a string    → only boards in that folder
 */
export const selectBoards = (
  boards: Board[],
  filters: BoardFilters = {},
): Board[] => {
  const {
    query = "",
    sort = "recent",
    folderId,
    favoritesOnly = false,
    includeTrashed = false,
  } = filters;

  const filtered = boards.filter((board) => {
    if (includeTrashed) {
      // Trash view: show trashed boards only.
      if (board.trashedAt === null) {
        return false;
      }
    } else if (board.trashedAt !== null) {
      return false;
    }

    if (favoritesOnly && !board.favorite) {
      return false;
    }

    if (folderId !== undefined) {
      if (folderId === null) {
        if (board.folderId !== null) {
          return false;
        }
      } else if (board.folderId !== folderId) {
        return false;
      }
    }

    return matchesQuery(board, query);
  });

  return sortBoards(filtered, sort);
};

/** Direct children of a folder (one level of nesting for v1). */
export const childFolders = (
  folders: Folder[],
  parentId: string | null,
): Folder[] => folders.filter((f) => f.parentId === parentId);

/** How many live boards sit in a folder — shown next to the sidebar label. */
export const countBoardsInFolder = (
  boards: Board[],
  folderId: string,
): number =>
  boards.filter((b) => b.folderId === folderId && b.trashedAt === null).length;

/** Boards with no folder — the "Unfiled" bucket. */
export const unfiledBoards = (boards: Board[]): Board[] =>
  boards.filter((b) => b.folderId === null && b.trashedAt === null);

/** How many days until a trashed board is auto-purged (0 = expiring today). */
export const daysUntilPurge = (
  board: Board,
  retentionDays: number,
  reference = Date.now(),
): number | null => {
  if (board.trashedAt === null) {
    return null;
  }
  const expiresAt = board.trashedAt + retentionDays * 24 * 60 * 60 * 1000;
  return Math.max(0, Math.ceil((expiresAt - reference) / (24 * 60 * 60 * 1000)));
};

/**
 * "Edited 3 days ago" style relative label. Uses Intl.RelativeTimeFormat so the
 * wording is localised by the platform rather than hand-rolled.
 */
export const relativeTime = (timestamp: number, reference = Date.now()) => {
  const deltaMs = reference - timestamp;
  const units: [Intl.RelativeTimeFormatUnit, number][] = [
    ["year", 365 * 24 * 60 * 60 * 1000],
    ["month", 30 * 24 * 60 * 60 * 1000],
    ["week", 7 * 24 * 60 * 60 * 1000],
    ["day", 24 * 60 * 60 * 1000],
    ["hour", 60 * 60 * 1000],
    ["minute", 60 * 1000],
  ];

  const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });
  for (const [unit, ms] of units) {
    if (Math.abs(deltaMs) >= ms) {
      return rtf.format(-Math.round(deltaMs / ms), unit);
    }
  }
  return rtf.format(0, "second");
};

/** Human-readable byte size for the size sort / board menu. */
export const formatBytes = (bytes: number | undefined): string => {
  if (!bytes || bytes <= 0) {
    return "—";
  }
  const units = ["B", "KB", "MB", "GB"];
  let value = bytes;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  return `${value < 10 && unitIndex > 0 ? value.toFixed(1) : Math.round(value)} ${
    units[unitIndex]
  }`;
};