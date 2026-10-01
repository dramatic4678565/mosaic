import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

import styles from "./ContextMenu.module.scss";

/**
 * Generic anchored popover menu.
 *
 * Responsibilities kept deliberately narrow: position itself under `anchorEl`,
 * flip above the trigger when there is not enough room below, stay inside the
 * viewport horizontally, and dismiss on outside click / Escape / scroll / resize.
 * It knows nothing about boards.
 *
 * Hand-rolled rather than a menu library because the dashboard needs a single
 * level, and pulling in the editor's radix-ui dependency for that would couple
 * the two bundles for no benefit.
 *
 * The measured menu size is needed for the flip calculation, so the first render
 * happens at (0,0) and is corrected in a rAF. Imperceptible to the user and it
 * avoids a layout-thrash loop.
 */
export const ContextMenu = ({
  open,
  anchorEl,
  onClose,
  children,
}: {
  open: boolean;
  anchorEl: HTMLElement | null;
  onClose: () => void;
  children: ReactNode;
}) => {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ top: 0, left: 0 });

  useEffect(() => {
    if (!open || !anchorEl) {
      return;
    }

    const place = () => {
      const rect = anchorEl.getBoundingClientRect();
      const menu = ref.current?.getBoundingClientRect();
      const width = menu?.width || 220;
      const height = menu?.height || 280;
      const viewportHeight = window.innerHeight;
      const viewportWidth = window.innerWidth;

      // Flip above the trigger when the menu would run past the viewport bottom.
      const flipUp = rect.bottom + height > viewportHeight;
      const top = flipUp ? Math.max(8, rect.top - height - 6) : rect.bottom + 6;

      // Right-align to the trigger, then clamp inside the viewport.
      const desiredLeft = rect.right - width;
      const left = Math.max(
        8,
        Math.min(desiredLeft, viewportWidth - width - 8),
      );

      setPos({ top, left });
    };

    place();
    const raf = requestAnimationFrame(place);

    const onPointerDown = (event: MouseEvent) => {
      if (!ref.current?.contains(event.target as Node)) {
        onClose();
      }
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      }
    };

    window.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("resize", place);
    // Capture phase so scrolling any ancestor (not just window) closes the menu.
    window.addEventListener("scroll", place, true);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [open, anchorEl, onClose]);

  if (!open) {
    return null;
  }

  return createPortal(
    <div
      ref={ref}
      className={styles.menu}
      style={{ top: pos.top, left: pos.left }}
      role="menu"
      data-testid="context-menu"
    >
      {children}
    </div>,
    document.body,
  );
};
