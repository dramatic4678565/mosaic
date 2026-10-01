import { useState } from "react";
import { useNavigate } from "react-router-dom";

import { BoardContextMenu } from "./BoardContextMenu";

import styles from "./BoardCard.module.scss";

import type { DownloadFormat } from "./BoardContextMenu";

import type { Board } from "@/db/schema";

import type { BoardStats } from "@/db/operations";

import { MosaicMark } from "@/components/common/MosaicMark";
import { downloadBoard } from "@/lib/download";
import { t } from "@/lib/i18n";
import { relativeTime } from "@/lib/selectors";

import { useDashboardStore } from "@/state/useDashboardStore";

/**
 * A single board tile (STEP 3).
 *
 * Interaction summary:
 *  - click (no modifier)  → open in the editor
 *  - double-click on name → inline rename
 *  - ctrl/cmd click       → toggle selection
 *  - shift click          → range selection (handled by BoardGrid)
 *  - star button          → favourite toggle, stops propagation so it does not
 *                           also open the board
 *  - "..." button         → context menu (open/rename/duplicate/move/download/
 *                           trash/delete forever)
 *
 * All the data mutation goes through the store, which wraps the DB call and
 * refreshes. The card itself never touches Dexie.
 */
export const BoardCard = ({
  board,
  selected,
  stats,
  isTrashView,
  onToggleSelect,
  onRangeSelect,
}: {
  board: Board;
  selected: boolean;
  stats?: BoardStats;
  isTrashView: boolean;
  onToggleSelect: () => void;
  onRangeSelect: () => void;
}) => {
  const navigate = useNavigate();
  const [renaming, setRenaming] = useState(false);
  const [draftName, setDraftName] = useState(board.name);
  const [menuOpen, setMenuOpen] = useState(false);
  // The menu anchors to the "..." button; captured so the popover can position
  // itself under the exact element that was clicked.
  const [menuAnchor, setMenuAnchor] = useState<HTMLElement | null>(null);

  const renameBoard = useDashboardStore((s) => s.renameBoard);
  const toggleFavorite = useDashboardStore((s) => s.toggleFavorite);
  const duplicateBoard = useDashboardStore((s) => s.duplicateBoard);
  const moveBoardToFolder = useDashboardStore((s) => s.moveBoardToFolder);
  const trashBoard = useDashboardStore((s) => s.trashBoard);
  const restoreBoard = useDashboardStore((s) => s.restoreBoard);
  const deleteBoardForever = useDashboardStore((s) => s.deleteBoardForever);
  const folders = useDashboardStore((s) => s.folders);

  const open = () => {
    if (isTrashView) {
      return;
    }
    navigate(`/board/${board.id}`);
  };

  const handleClick = (event: React.MouseEvent) => {
    if (renaming) {
      return;
    }
    if (event.shiftKey) {
      onRangeSelect();
      return;
    }
    if (event.metaKey || event.ctrlKey) {
      onToggleSelect();
      return;
    }
    if (selected) {
      // Clicking an already-selected card opens it; this matches how native
      // file managers treat a single-selected item.
      open();
      return;
    }
    open();
  };

  const commitRename = async () => {
    const name = draftName.trim();
    setRenaming(false);
    if (name && name !== board.name) {
      await renameBoard(board.id, name);
    }
  };

  return (
    <div
      className={[
        styles.card,
        selected ? styles.isSelected : "",
        isTrashView ? "" : "",
      ]
        .filter(Boolean)
        .join(" ")}
      onClick={handleClick}
      data-testid={`board-card-${board.id}`}
      data-selected={selected || undefined}
      role="listitem"
      aria-label={board.name}
    >
      <div className={styles.thumb}>
        {board.thumbnail ? (
          <img
            className={styles.thumb__img}
            src={board.thumbnail}
            alt=""
            data-testid={`board-thumb-${board.id}`}
          />
        ) : (
          <span className={styles.thumb__placeholder}>
            <MosaicMark size={28} />
          </span>
        )}

        {isTrashView ? null : (
          <button
            type="button"
            className={`${styles.selectBox} ${
              selected ? styles.isChecked : ""
            }`}
            onClick={(e) => {
              e.stopPropagation();
              onToggleSelect();
            }}
            aria-pressed={selected}
            aria-label={selected ? "Deselect board" : "Select board"}
            data-testid={`select-${board.id}`}
          >
            ✓
          </button>
        )}

        {isTrashView ? null : (
          <button
            type="button"
            className={`${styles.star} ${
              board.favorite ? styles.isFavorite : ""
            }`}
            onClick={(e) => {
              e.stopPropagation();
              void toggleFavorite(board.id);
            }}
            title={
              board.favorite
                ? t("board.action.unfavorite")
                : t("board.action.favorite")
            }
            aria-pressed={board.favorite}
            aria-label={
              board.favorite
                ? t("board.action.unfavorite")
                : t("board.action.favorite")
            }
            data-testid={`star-${board.id}`}
          >
            {board.favorite ? "★" : "☆"}
          </button>
        )}

        <button
          type="button"
          className={styles.menuButton}
          onClick={(e) => {
            e.stopPropagation();
            setMenuAnchor(e.currentTarget);
            setMenuOpen(true);
          }}
          aria-label={t("common.more")}
          data-testid={`menu-${board.id}`}
        >
          ⋯
        </button>
      </div>

      <div className={styles.body}>
        {renaming ? (
          <input
            className={styles.nameInput}
            value={draftName}
            autoFocus
            onClick={(e) => e.stopPropagation()}
            onChange={(e) => setDraftName(e.target.value)}
            onBlur={commitRename}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                void commitRename();
              } else if (e.key === "Escape") {
                setDraftName(board.name);
                setRenaming(false);
              }
            }}
            data-testid={`rename-input-${board.id}`}
          />
        ) : (
          <span
            className={styles.name}
            onDoubleClick={(e) => {
              e.stopPropagation();
              setDraftName(board.name);
              setRenaming(true);
            }}
            data-testid={`board-name-${board.id}`}
          >
            {board.name}
          </span>
        )}

        <div className={styles.meta}>
          <span>{relativeTime(board.lastOpenedAt ?? board.updatedAt)}</span>
          {stats && stats.total > 0 ? (
            <span
              className={styles.statsChip}
              data-testid={`stats-${board.id}`}
            >
              {stats.last7Days} edits · 7d
            </span>
          ) : null}
        </div>
      </div>

      <BoardContextMenu
        open={menuOpen}
        anchorEl={menuAnchor}
        onClose={() => {
          setMenuOpen(false);
          setMenuAnchor(null);
        }}
        board={board}
        folders={folders}
        isTrashView={isTrashView}
        actions={{
          onOpen: () => navigate(`/board/${board.id}`),
          onRename: () => {
            setDraftName(board.name);
            setRenaming(true);
          },
          onDuplicate: () => void duplicateBoard(board.id),
          onMove: (folderId: string | null) =>
            void moveBoardToFolder(board.id, folderId),
          onDownload: (format: DownloadFormat) =>
            void downloadBoard(board, format),
          onTrash: () => void trashBoard(board.id),
          onRestore: () => void restoreBoard(board.id),
          onDeleteForever: () => void deleteBoardForever(board.id),
        }}
      />
    </div>
  );
};
