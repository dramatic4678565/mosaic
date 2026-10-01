import styles from "./AppShell.module.scss";

import type { ReactNode } from "react";

import { Sidebar } from "@/components/sidebar/Sidebar";
import { DndProvider } from "@/components/dnd/DndProvider";

/**
 * Two-column app shell: persistent sidebar + scrolling content area.
 *
 * The shell is deliberately dumb — it owns layout only. Route components own
 * their own headers and toolbars, which keeps the sidebar usable from every page
 * without each page re-implementing the two-column grid.
 *
 * `DndProvider` wraps both columns because the drag source (board grid) and the
 * drop targets (sidebar folder rows) live in different columns; a dnd-kit context
 * only reaches its own subtree.
 */
export const AppShell = ({ children }: { children: ReactNode }) => (
  <div className={`dashboardRoot ${styles.shell}`}>
    <DndProvider>
      <Sidebar />
      <div className={styles.shell__main}>
        <div className={styles.shell__content}>{children}</div>
      </div>
    </DndProvider>
  </div>
);
