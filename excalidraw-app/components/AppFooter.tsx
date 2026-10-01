import { Footer } from "@excalidraw/excalidraw/index";
import React from "react";

import { isExcalidrawPlusSignedUser } from "../app_constants";
import { dashboardUrl, getBoardIdFromHash } from "../boardMode";

import { DebugFooter, isVisualDebuggerEnabled } from "./DebugCanvas";
import { EncryptedIcon } from "./EncryptedIcon";

export const AppFooter = React.memo(
  ({ onChange }: { onChange: () => void }) => {
    // Board mode only (Part 2, STEP 6): offer a way back to the dashboard that
    // opened this editor. `useState` is not needed because the hash does not
    // change while the editor is open, so reading it once per render is enough.
    const boardId = getBoardIdFromHash();

    return (
      <Footer>
        <div
          style={{
            display: "flex",
            gap: ".5rem",
            alignItems: "center",
          }}
        >
          {boardId ? (
            <a
              href={dashboardUrl()}
              className="modal-drawer-link mosaic-back-link"
              data-testid="back-to-dashboard"
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: ".35rem",
                fontSize: ".8rem",
              }}
            >
              ← Back to dashboard
            </a>
          ) : null}
          {isVisualDebuggerEnabled() && <DebugFooter onChange={onChange} />}
          {!isExcalidrawPlusSignedUser && <EncryptedIcon />}
        </div>
      </Footer>
    );
  },
);
