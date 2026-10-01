import { useEffect, type ReactNode } from "react";
import { createPortal } from "react-dom";

import styles from "./Modal.module.scss";

import { t } from "@/lib/i18n";

/**
 * Small confirm dialog used for the irreversible actions (delete forever,
 * empty trash, delete all local data).
 *
 * Deliberately hand-rolled rather than pulling in a dialog library: the editor
 * app already depends on radix-ui, and reusing it would couple the dashboard's
 * bundle to the editor's dependency set for one dialog.
 *
 * Rendered through a portal to `document.body` so it escapes the grid's
 * `overflow: hidden` containers, and closes on Escape.
 */
export const Modal = ({
  open,
  title,
  description,
  confirmLabel,
  onConfirm,
  onCancel,
  children,
}: {
  open: boolean;
  title: string;
  description?: string;
  confirmLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
  children?: ReactNode;
}) => {
  useEffect(() => {
    if (!open) {
      return;
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onCancel();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, onCancel]);

  if (!open) {
    return null;
  }

  return createPortal(
    <div
      className={styles.backdrop}
      onClick={onCancel}
      data-testid="modal-backdrop"
    >
      {/* Stop the backdrop click from also firing when the dialog itself is hit. */}
      {/* eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions */}
      <div
        className={styles.modal}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(event) => event.stopPropagation()}
        data-testid="modal"
      >
        <h2 className={styles.title}>{title}</h2>
        {description ? (
          <p className={styles.description}>{description}</p>
        ) : null}
        {children}
        <div className={styles.actions}>
          <button type="button" onClick={onCancel} data-testid="modal-cancel">
            {t("common.cancel")}
          </button>
          <button
            type="button"
            className={styles.confirm}
            onClick={onConfirm}
            data-testid="modal-confirm"
          >
            {confirmLabel ?? t("common.confirm")}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
};
