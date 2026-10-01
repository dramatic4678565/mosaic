import { useState } from "react";

import { useDashboardStore } from "@/state/useDashboardStore";
import { t } from "@/lib/i18n";
import { BOARD_SORTS, type BoardSort } from "@/db/schema";
import { pluralize } from "@/lib/selectors";

/**
 * Search, sort and bulk-action bar above the grid (STEP 3).
 *
 * Query and sort live in the store rather than in local state so the trash page
 * and the folder pages share them, and so a filter survives navigation.
 *
 * The bulk bar only appears when something is selected; otherwise it would push
 * the grid down on every render.
 */
export const BoardToolbar = ({ onCreate }: { onCreate: () => void }) => {
  const query = useDashboardStore((s) => s.query);
  const setQuery = useDashboardStore((s) => s.setQuery);
  const sort = useDashboardStore((s) => s.sort);
  const setSort = useDashboardStore((s) => s.setSort);
  const selectedIds = useDashboardStore((s) => s.selectedIds);
  const clearSelection = useDashboardStore((s) => s.clearSelection);
  const trashBoard = useDashboardStore((s) => s.trashBoard);
  const toggleFavorite = useDashboardStore((s) => s.toggleFavorite);
  const moveBoardToFolder = useDashboardStore((s) => s.moveBoardToFolder);

  const [moveOpen, setMoveOpen] = useState(false);
  const folders = useDashboardStore((s) => s.folders);

  const hasSelection = selectedIds.length > 0;

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        flexWrap: "wrap",
        marginTop: 16,
      }}
      data-testid="board-toolbar"
    >
      <input
        type="search"
        placeholder={t("toolbar.search")}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        style={{
          flex: "1 1 220px",
          padding: "8px 12px",
          border: "1px solid #e3e7ef",
          borderRadius: 10,
          outline: "none",
        }}
        data-testid="search-input"
      />

      <label
        style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13 }}
      >
        <span style={{ color: "#5b6676" }}>{t("toolbar.sort")}</span>
        <select
          value={sort}
          onChange={(e) => setSort(e.target.value as BoardSort)}
          style={{
            padding: "8px 10px",
            border: "1px solid #e3e7ef",
            borderRadius: 10,
            background: "#fff",
          }}
          data-testid="sort-select"
        >
          {BOARD_SORTS.map((option) => (
            <option key={option} value={option}>
              {t(`toolbar.sort.${option}`)}
            </option>
          ))}
        </select>
      </label>

      {hasSelection ? (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            paddingLeft: 8,
            borderLeft: "1px solid #e3e7ef",
          }}
          data-testid="bulk-bar"
        >
          <span
            style={{ fontSize: 13, color: "#5b6676" }}
            data-testid="bulk-count"
          >
            {pluralize(selectedIds.length, "selected", "selected")}
          </span>
          <button
            type="button"
            onClick={() => {
              void Promise.all(selectedIds.map((id) => toggleFavorite(id)));
            }}
            data-testid="bulk-favorite"
          >
            {t("board.bulk.favorite")}
          </button>
          <button
            type="button"
            onClick={() => setMoveOpen((v) => !v)}
            data-testid="bulk-move-toggle"
          >
            {t("board.bulk.move")}
          </button>
          {moveOpen ? (
            <div
              data-testid="bulk-move-list"
              style={{ display: "flex", gap: 6 }}
            >
              <button
                type="button"
                onClick={() => {
                  void Promise.all(
                    selectedIds.map((id) => moveBoardToFolder(id, null)),
                  );
                  setMoveOpen(false);
                }}
                data-testid="bulk-move-unfiled"
              >
                {t("board.action.unfiled")}
              </button>
              {folders.map((folder) => (
                <button
                  key={folder.id}
                  type="button"
                  onClick={() => {
                    void Promise.all(
                      selectedIds.map((id) => moveBoardToFolder(id, folder.id)),
                    );
                    setMoveOpen(false);
                  }}
                  data-testid={`bulk-move-${folder.id}`}
                >
                  {folder.name}
                </button>
              ))}
            </div>
          ) : null}
          <button
            type="button"
            onClick={() => {
              void Promise.all(selectedIds.map((id) => trashBoard(id)));
              clearSelection();
            }}
            data-testid="bulk-trash"
          >
            {t("board.bulk.trash")}
          </button>
          <button
            type="button"
            onClick={clearSelection}
            data-testid="bulk-clear"
          >
            {t("board.bulk.clear")}
          </button>
        </div>
      ) : null}
    </div>
  );
};
