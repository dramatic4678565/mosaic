import type { Board } from "@/db/schema";

import type {
  ListBoardsOptions,
  SaveScenePayload,
  StorageAdapter,
} from "./types";

import { TRASH_RETENTION_DAYS } from "@/db/schema";

/**
 * The HTTP-backed {@link StorageAdapter} that talks to the Neon API in STEP 3.
 *
 * ## Scope, stated plainly
 *
 * STEP 3 only specified `api/health.ts` and `api/boards/*`. There are therefore no
 * server endpoints for folders or activity, and this adapter **does not invent
 * any**. Every operation the API does not cover is delegated to the `local`
 * adapter passed to the factory, which in practice is IndexedDB. That is a real
 * limitation of PART 3A, not a hidden stub: boards sync to Postgres, folders and
 * the activity feed stay in the browser.
 *
 * A visible consequence: the API writes its own `activity` rows when a board is
 * created, renamed, favourited or trashed (`api/boards/[id].ts`). Nothing reads
 * them yet, so they accumulate server-side while the UI reads the local rows.
 * Adding `api/folders/*` and `api/activity` later would let this adapter drop the
 * `local` fallback entirely.
 *
 * ## Error handling
 *
 * Every non-2xx response throws. The alternative — returning `undefined` like the
 * IndexedDB adapter does for a missing row — would be worse here: it makes "this
 * board does not exist" indistinguishable from "the network is down" or "the
 * server threw", and the UI would silently show an empty board rather than an
 * error. `Board | undefined` is still returned for a genuine 404.
 */

export type ApiAdapterOptions = {
  /** API root, e.g. `""` for same-origin or `https://api.example.com`. */
  baseUrl: string;
  /** Serves the operations the API does not implement. */
  local: StorageAdapter;
};

/** Thrown when the API answers with a non-2xx status. */
export class ApiError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

export const createApiAdapter = ({
  baseUrl,
  local,
}: ApiAdapterOptions): StorageAdapter => {
  /**
   * Single request helper.
   *
   * `credentials: "include"` is mandatory, not decorative: the API identifies the
   * caller by the signed `mosaic_uid` cookie, and without it every request would
   * be treated as a brand-new anonymous user with no boards.
   */
  const request = async <T>(
    path: string,
    init: RequestInit = {},
  ): Promise<T> => {
    const res = await fetch(`${baseUrl}${path}`, {
      ...init,
      credentials: "include",
      headers: {
        ...(init.body !== undefined
          ? { "content-type": "application/json" }
          : {}),
        ...(init.headers ?? {}),
      },
    });

    if (!res.ok) {
      // Prefer the server's own message when it sent one; fall back to the status
      // so the thrown error is never an empty string.
      let detail = `HTTP ${res.status}`;
      try {
        const body = (await res.json()) as { error?: string };
        if (body?.error) {
          detail = body.error;
        }
      } catch {
        // Not JSON (a proxy error page, say) — the status is all we have.
      }
      throw new ApiError(res.status, detail);
    }

    // 204 has no body to parse.
    if (res.status === 204) {
      return undefined as T;
    }
    return (await res.json()) as T;
  };

  /** `undefined` for a 404, so callers keep the IndexedDB adapter's contract. */
  const requestOrUndefined = async <T>(path: string, init?: RequestInit) => {
    try {
      return await request<T>(path, init);
    } catch (error) {
      if (error instanceof ApiError && error.status === 404) {
        return undefined;
      }
      throw error;
    }
  };

  /**
   * `includeTrashed: true` means "give me everything, I will filter".
   *
   * That is what `useDashboardStore.reload()` asks for and what the Dexie adapter
   * delivers, because it has no trash filter to push down — it returns every row and
   * the selectors narrow it. Translating the flag to `?trashed=1` is *not* the same
   * request: the server answers that with only trashed boards, so the dashboard's
   * main list came back holding nothing but the bin. `trashed=all` says explicitly
   * "no trash filter", and the omission of the parameter keeps its existing meaning
   * of live-only.
   */
  const listBoards = async (
    options: ListBoardsOptions = {},
  ): Promise<Board[]> => {
    const params = new URLSearchParams();
    if (options.includeTrashed) {
      params.set("trashed", "all");
    }
    if (options.folderId !== undefined) {
      params.set(
        "folderId",
        options.folderId === null ? "unfiled" : options.folderId,
      );
    }
    const qs = params.toString();
    const { boards } = await request<{ boards: Board[] }>(
      `/api/boards${qs ? `?${qs}` : ""}`,
    );
    return boards;
  };

  /**
   * The bin, and only the bin.
   *
   * Spelled out rather than reusing `listBoards({includeTrashed:true})`, because that
   * now means "everything" and the trash page must never show a live board.
   */
  const listTrashedOnly = async (): Promise<Board[]> => {
    const { boards } = await request<{ boards: Board[] }>(
      "/api/boards?trashed=1",
    );
    return boards;
  };

  const createBoard = (partial: Partial<Board> = {}) =>
    request<{ board: Board }>("/api/boards", {
      method: "POST",
      body: JSON.stringify({
        ...(partial.name !== undefined ? { name: partial.name } : {}),
        ...(partial.folderId !== undefined
          ? { folderId: partial.folderId }
          : {}),
        ...(partial.scene !== undefined ? { scene: partial.scene } : {}),
        ...(partial.thumbnail !== undefined
          ? { thumbnail: partial.thumbnail }
          : {}),
      }),
    }).then((r) => r.board);

  const getBoardWithScene = async (id: string) => {
    const r = await requestOrUndefined<{ board: Board }>(`/api/boards/${id}`);
    return r?.board;
  };

  const getBoard = (id: string) => getBoardWithScene(id);

  const patch = (id: string, body: Record<string, unknown>) =>
    request<{ board: Board }>(`/api/boards/${id}`, {
      method: "PATCH",
      body: JSON.stringify(body),
    }).then((r) => r.board);

  /**
   * Blank names return `undefined` rather than reaching the API, matching
   * `renameFolder`'s contract and saving a guaranteed-400 round trip.
   */
  const renameBoard = async (id: string, name: string) => {
    if (!name.trim()) {
      return undefined;
    }
    return requestOrUndefined<{ board: Board }>(`/api/boards/${id}`, {
      method: "PATCH",
      body: JSON.stringify({ name }),
    }).then((r) => r?.board);
  };

  const setFavorite = (id: string, favorite: boolean) =>
    patch(id, { favorite });

  const toggleFavorite = async (id: string) => {
    const board = await getBoardWithScene(id);
    if (!board) {
      return undefined;
    }
    return setFavorite(id, !board.favorite);
  };

  const moveBoardToFolder = (id: string, folderId: string | null) =>
    patch(id, { folderId });

  const duplicateBoard = async (id: string) => {
    const source = await getBoardWithScene(id);
    if (!source) {
      return undefined;
    }
    // The copy is unfiled and unfavourited, matching the local behaviour: the API's
    // POST ignores any folderId/favorite and always creates a clean board.
    return createBoard({
      name: `${source.name} (copy)`,
      scene: source.scene,
      thumbnail: source.thumbnail,
    });
  };

  /**
   * Scene write with the optimistic-concurrency guard.
   *
   * `baseVersion` is checked locally first so a stale writer is skipped without a
   * round trip. The API also bumps `scene_version` server-side on every scene
   * write, so the token keeps advancing even across devices.
   */
  const saveBoardScene = async (id: string, payload: SaveScenePayload) => {
    if (payload.baseVersion !== undefined) {
      const current = await getBoardWithScene(id);
      if (!current || current.sceneVersion !== payload.baseVersion) {
        return undefined;
      }
    }
    return patch(id, { scene: payload.scene, thumbnail: payload.thumbnail });
  };

  /**
   * `GET /api/boards/[id]` bumps `last_opened_at` server-side, so this is a plain
   * read rather than a write — no PATCH needed. The local activity row is still
   * appended because activity is served locally.
   */
  const markBoardOpened = async (id: string) => {
    await requestOrUndefined(`/api/boards/${id}`);
    await local.markBoardOpened(id);
  };

  const trashBoard = async (id: string) => {
    await patch(id, { trashedAt: Date.now() });
    // Also appends the local audit row the Activity page renders. The local board
    // row may not exist in API mode, and Dexie's update is a no-op when it does
    // not, so this is safe either way.
    await local.trashBoard(id);
  };

  const restoreBoard = async (id: string) => {
    await patch(id, { trashedAt: null });
    await local.restoreBoard(id);
  };

  const deleteBoardForever = async (id: string) => {
    await request(`/api/boards/${id}`, { method: "DELETE" });
    await local.deleteBoardForever(id);
  };

  const listTrashedBoards = () => listTrashedOnly();

  const listTrashedBoardsLite = async () => {
    // The API already omits `scene` from listings, so this needs no extra work —
    // it stays a separate method because the interface promises it.
    const boards = await listTrashedOnly();
    return boards.map(({ scene: _scene, ...rest }) => rest);
  };

  const emptyTrash = async () => {
    const rows = await listTrashedBoards();
    await Promise.all(rows.map((b) => deleteBoardForever(b.id)));
  };

  const purgeExpiredTrash = async (retentionDays?: number) => {
    const days = retentionDays ?? TRASH_RETENTION_DAYS;
    const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
    const rows = await listTrashedBoards();
    // `trashedAt !== null` is load-bearing, not redundant. The server filters on
    // `?trashed=1`, but this function *deletes*, so it must not depend on that
    // filter being right: with `(b.trashedAt ?? 0) < cutoff` a live board reads as
    // epoch 0, looks 56 years old, and gets purged while the user is looking at it.
    // A board that is not in the trash is never expired, whatever it returns.
    const expired = rows.filter(
      (b) => b.trashedAt !== null && b.trashedAt < cutoff,
    );
    await Promise.all(expired.map((b) => deleteBoardForever(b.id)));
    return expired.map((b) => b.id);
  };

  return {
    // ---- boards go to the API ----
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

    // ---- no endpoints exist for these yet; served locally ----
    createFolder: local.createFolder,
    listFolders: local.listFolders,
    getFolder: local.getFolder,
    renameFolder: local.renameFolder,
    recolorFolder: local.recolorFolder,
    deleteFolder: local.deleteFolder,
    listActivity: local.listActivity,
    listBoardActivity: local.listBoardActivity,
    getBoardStats: local.getBoardStats,
    getBoardStatsMap: local.getBoardStatsMap,
  };
};
