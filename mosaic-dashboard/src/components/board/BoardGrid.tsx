import { useDraggable, useDroppable } from "@dnd-kit/core";
import { useEffect, useState } from "react";

import { BoardCard } from "./BoardCard";

import styles from "./BoardGrid.module.scss";

import type { Board } from "@/db/schema";

import type { BoardStats } from "@/lib/storage/types";

import { storage } from "@/lib/storage";

import { nextSelection } from "@/lib/selection";
import {
  FOLDER_DROPPABLE_PREFIX,
  GRID_DROPPABLE_ID,
} from "@/components/dnd/DndProvider";
import { useDashboardStore } from "@/state/useDashboardStore";

/**
 * Board grid (STEP 3).
 *
 * This component deliberately owns *no* DndContext — it lives in `DndProvider`
 * at the shell level so the sidebar folder rows can be drop targets too. Here we
 * only make each card draggable and the grid container a droppable meaning
 * "unfiled".
 *
 * `isTrashView` switches the card into recovery mode: no star, no select box, no
 * drag, and the context menu offers Restore / Delete forever instead of the
 * editing actions. Dragging a board out of the trash would be meaningless.
 *
 * Multi-select (plain / ctrl / shift) is delegated to the pure `nextSelection`
 * helper so the rules are unit-testable without a DOM — see lib/selection.ts.
 *
 * The shift anchor is reset whenever the visible list changes identity (search,
 * sort, folder switch). Without that, a shift-click after filtering could
 * silently select a range spanning boards the user cannot currently see.
 */
export const BoardGrid = ({
  boards,
  isTrashView = false,
}: {
  boards: Board[];
  isTrashView?: boolean;
}) => {
  const selectedIds = useDashboardStore((s) => s.selectedIds);
  const toggleSelected = useDashboardStore((s) => s.toggleSelected);
  const selectMany = useDashboardStore((s) => s.selectMany);

  const [anchor, setAnchor] = useState<string | null>(null);
  const [stats, setStats] = useState<Record<string, BoardStats>>({});

  // Reset the anchor whenever the set of visible boards changes.
  useEffect(() => {
    setAnchor(null);
  }, [boards]);

  useEffect(() => {
    let cancelled = false;
    void storage.getBoardStatsMap().then((map) => {
      if (!cancelled) {
        setStats(map);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [boards]);

  const ids = boards.map((b) => b.id);
  const { setNodeRef: setGridRef, isOver: gridIsOver } = useDroppable({
    id: GRID_DROPPABLE_ID,
  });

  return (
    <div
      ref={isTrashView ? undefined : setGridRef}
      className={`${styles.grid} ${
        !isTrashView && gridIsOver ? styles.dropTarget : ""
      }`}
      role="list"
      data-testid="board-grid"
      data-over={(!isTrashView && gridIsOver) || undefined}
    >
      {boards.map((board) => (
        <BoardCardWithDrag
          key={board.id}
          board={board}
          isTrashView={isTrashView}
          selected={selectedIds.includes(board.id)}
          {...(stats[board.id] !== undefined ? { stats: stats[board.id] } : {})}
          ids={ids}
          selectedIds={selectedIds}
          anchor={anchor}
          onAnchorChange={setAnchor}
          onToggleSelected={() => toggleSelected(board.id)}
          onSelectMany={selectMany}
        />
      ))}
    </div>
  );
};

/** One draggable card + its selection handlers. */
const BoardCardWithDrag = ({
  board,
  isTrashView,
  selected,
  stats,
  ids,
  selectedIds,
  anchor,
  onAnchorChange,
  onToggleSelected,
  onSelectMany,
}: {
  board: Board;
  isTrashView: boolean;
  selected: boolean;
  stats?: BoardStats;
  ids: string[];
  selectedIds: string[];
  anchor: string | null;
  onAnchorChange: (id: string | null) => void;
  onToggleSelected: () => void;
  onSelectMany: (ids: string[]) => void;
}) => {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: board.id,
    // A trashed board cannot be filed into a folder, so it is not draggable.
    disabled: isTrashView,
  });

  /**
   * Ctrl/Cmd click: toggle this board, keeping the rest of the selection.
   *
   * The toggle itself is delegated to the store (`toggleSelected`) so the store
   * stays the single owner of selection. This handler only decides the shift
   * anchor: the first ctrl-click of an empty selection becomes the anchor, later
   * ones leave it alone.
   */
  const handleAdditive = () => {
    onAnchorChange(selectedIds.length === 0 ? board.id : anchor);
    onToggleSelected();
  };

  /** Shift click: select the range between the anchor and this card. */
  const handleRange = () => {
    const next = nextSelection(
      ids,
      selectedIds,
      board.id,
      { shift: true },
      anchor,
    );
    onSelectMany(next.selected);
    onAnchorChange(next.anchor ?? board.id);
  };

  return (
    <div
      ref={setNodeRef}
      style={isTrashView ? undefined : { touchAction: "none" }}
      className={isDragging ? styles.isDragging : undefined}
      {...listeners}
      {...attributes}
    >
      <BoardCard
        board={board}
        selected={selected}
        {...(stats !== undefined ? { stats } : {})}
        isTrashView={isTrashView}
        onToggleSelect={handleAdditive}
        onRangeSelect={handleRange}
      />
    </div>
  );
};

/**
 * Makes a sidebar folder row a drop target. Lives here (next to the other dnd
 * hooks) so the id convention in DndProvider is defined in one place.
 */
export const useFolderDroppable = (folderId: string) =>
  useDroppable({ id: `${FOLDER_DROPPABLE_PREFIX}${folderId}` });
