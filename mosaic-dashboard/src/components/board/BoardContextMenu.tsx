import { useEffect, useState, type ReactNode } from "react";

import styles from "./BoardContextMenu.module.scss";

import type { Board, Folder } from "@/db/schema";

import { ContextMenu } from "@/components/common/ContextMenu";
import { t } from "@/lib/i18n";

export type DownloadFormat = "mosaic" | "excalidraw" | "png" | "svg";

export type BoardMenuActions = {
  onOpen: () => void;
  onRename: () => void;
  onDuplicate: () => void;
  onMove: (folderId: string | null) => void;
  onDownload: (format: DownloadFormat) => void;
  onTrash: () => void;
  onRestore: () => void;
  onDeleteForever: () => void;
};

type Section = "move" | "download" | null;

/**
 * Board action menu (STEP 3).
 *
 * "Move to folder" and "Download" are inline sub-sections rather than nested
 * popovers. A second floating menu would need its own positioning/flip logic and
 * would dismiss whenever the pointer crossed the gap between the two panels;
 * expanding inside the single panel is simpler and stays keyboard-reachable.
 *
 * In the trash view only the recovery actions are offered — "Open" or "Duplicate"
 * on a deleted board would be meaningless.
 */
export const BoardContextMenu = ({
  open,
  anchorEl,
  onClose,
  board,
  folders,
  isTrashView,
  actions,
}: {
  open: boolean;
  anchorEl: HTMLElement | null;
  onClose: () => void;
  board: Board;
  folders: Folder[];
  isTrashView: boolean;
  actions: BoardMenuActions;
}) => {
  const [expanded, setExpanded] = useState<Section>(null);

  // Collapse sub-sections every time the menu is (re)opened, so it never
  // reappears in the state it was left in.
  useEffect(() => {
    if (open) {
      setExpanded(null);
    }
  }, [open]);

  /**
   * Wraps a menu action.
   *
   * Most actions should close the menu first (`closeThen`). Rename is the
   * exception: it flips the card into inline-edit mode, and closing the menu
   * unmounts the popover on the same render that sets `renaming`, which loses the
   * flag. So rename runs *after* the close and the card re-renders with its input.
   */
  const closeThen = (onClose: () => void, fn: () => void) => () => {
    onClose();
    fn();
  };

  return (
    <ContextMenu open={open} anchorEl={anchorEl} onClose={onClose}>
      {isTrashView ? null : (
        <>
          <Item onClick={closeThen(onClose, actions.onOpen)} testId="menu-open">
            {t("board.action.open")}
          </Item>
          <Item
            onClick={closeThen(onClose, actions.onRename)}
            testId="menu-rename"
          >
            {t("board.action.rename")}
          </Item>
          <Item
            onClick={closeThen(onClose, actions.onDuplicate)}
            testId="menu-duplicate"
          >
            {t("board.action.duplicate")}
          </Item>

          <Toggle
            label={t("board.action.move")}
            open={expanded === "move"}
            onToggle={() => setExpanded(expanded === "move" ? null : "move")}
            testId="menu-move-toggle"
          />
          {expanded === "move" ? (
            <div className={styles.submenu} data-testid="menu-move-list">
              <Item
                onClick={closeThen(onClose, () => actions.onMove(null))}
                testId="menu-move-unfiled"
              >
                {t("board.action.unfiled")}
              </Item>
              {folders.map((folder) => (
                <Item
                  key={folder.id}
                  onClick={closeThen(onClose, () => actions.onMove(folder.id))}
                  testId={`menu-move-${folder.id}`}
                >
                  {folder.name}
                </Item>
              ))}
              {folders.length === 0 ? (
                <div className={styles.submenuEmpty}>
                  {t("board.empty.folder")}
                </div>
              ) : null}
            </div>
          ) : null}

          <Toggle
            label={t("board.action.download")}
            open={expanded === "download"}
            onToggle={() =>
              setExpanded(expanded === "download" ? null : "download")
            }
            testId="menu-download-toggle"
          />
          {expanded === "download" ? (
            <div className={styles.submenu} data-testid="menu-download-list">
              <Item
                onClick={closeThen(onClose, () => actions.onDownload("mosaic"))}
                testId="menu-download-mosaic"
              >
                {t("board.download.mosaic")}
              </Item>
              <Item
                onClick={closeThen(onClose, () =>
                  actions.onDownload("excalidraw"),
                )}
                testId="menu-download-excalidraw"
              >
                {t("board.download.excalidraw")}
              </Item>
              <Item
                onClick={closeThen(onClose, () => actions.onDownload("png"))}
                testId="menu-download-png"
              >
                {t("board.download.png")}
              </Item>
              <Item
                onClick={closeThen(onClose, () => actions.onDownload("svg"))}
                testId="menu-download-svg"
              >
                {t("board.download.svg")}
              </Item>
            </div>
          ) : null}

          <div className={styles.separator} />
          <Item
            onClick={closeThen(onClose, actions.onTrash)}
            testId="menu-trash"
            danger
          >
            {t("board.action.trash")}
          </Item>
          <Item
            onClick={closeThen(onClose, actions.onDeleteForever)}
            testId="menu-delete-forever"
            danger
          >
            {t("board.action.deleteForever")}
          </Item>
        </>
      )}

      {isTrashView ? (
        <>
          <Item
            onClick={closeThen(onClose, actions.onRestore)}
            testId="menu-restore"
          >
            {t("board.action.restore")}
          </Item>
          <Item
            onClick={closeThen(onClose, actions.onDeleteForever)}
            testId="menu-delete-forever"
            danger
          >
            {t("board.action.deleteForever")}
          </Item>
        </>
      ) : null}
    </ContextMenu>
  );
};

const Item = ({
  onClick,
  children,
  testId,
  danger,
}: {
  onClick: () => void;
  children: ReactNode;
  testId: string;
  danger?: boolean;
}) => (
  <button
    type="button"
    role="menuitem"
    className={`${styles.item} ${danger ? styles.isDanger : ""}`}
    onClick={onClick}
    data-testid={testId}
  >
    {children}
  </button>
);

const Toggle = ({
  label,
  open,
  onToggle,
  testId,
}: {
  label: string;
  open: boolean;
  onToggle: () => void;
  testId: string;
}) => (
  <button
    type="button"
    role="menuitem"
    aria-expanded={open}
    className={styles.item}
    onClick={onToggle}
    data-testid={testId}
  >
    {label}
    <span style={{ marginLeft: "auto" }}>{open ? "▾" : "▸"}</span>
  </button>
);
