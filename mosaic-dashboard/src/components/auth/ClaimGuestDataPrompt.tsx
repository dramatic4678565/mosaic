import { useEffect, useState } from "react";

import { Modal } from "@/components/common/Modal";
import { claimGuestData, getGuestData, type GuestData } from "@/lib/auth";
import { pluralize } from "@/lib/selectors";
import { useAuthStore } from "@/state/useAuthStore";
import { useDashboardStore } from "@/state/useDashboardStore";

/**
 * One-time prompt offering to import boards created before signing in.
 *
 * ## Why this exists
 *
 * Part 3A identified people by a cookie. Signing in changes the identity rows are
 * scoped by, so without a hand-off a user who made three boards anonymously would
 * sign in and find an empty grid — their work would still be in Postgres, reachable
 * only through a cookie the app had just stopped using.
 *
 * ## Why it is a prompt and not an automatic move
 *
 * Importing silently would be a surprise: it changes what "my boards" means, and
 * someone might want the anonymous set kept separate. Skip is a first-class answer,
 * and it leaves the guest cookie in place, so nothing is destroyed by declining.
 *
 * ## Why it appears once
 *
 * The dismissal is recorded in localStorage. A prompt that reappears on every
 * navigation is worse than no prompt, and re-deriving "has this been answered" from
 * the server would mean the Skip decision was silently forgotten the moment the
 * guest cookie rotated.
 */

const DISMISSED_KEY = "mosaic.guestClaim.dismissed";

const wasDismissed = (): boolean => {
  try {
    return globalThis.localStorage?.getItem(DISMISSED_KEY) === "1";
  } catch {
    // Private browsing or a blocked storage partition. Showing the prompt again is
    // harmless; failing to render would not be.
    return false;
  }
};

const rememberDismissed = () => {
  try {
    globalThis.localStorage?.setItem(DISMISSED_KEY, "1");
  } catch {
    /* non-fatal, see wasDismissed */
  }
};

export const ClaimGuestDataPrompt = () => {
  const user = useAuthStore((s) => s.user);
  const reload = useDashboardStore((s) => s.reload);

  const [counts, setCounts] = useState<GuestData | null>(null);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  /**
   * Only ever checked when signed in: without an account there is nothing to import
   * into, and this would fire for every anonymous visitor.
   */
  useEffect(() => {
    if (!user || wasDismissed()) {
      return;
    }
    let cancelled = false;
    void getGuestData().then((data) => {
      if (!cancelled && data.boards > 0) {
        setCounts(data);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [user]);

  const handleImport = async () => {
    setBusy(true);
    setFailed(false);
    try {
      await claimGuestData();
      // The board list is now scoped by user_id, so the current contents are the
      // anonymous set and would render stale until re-read.
      await reload();
      setCounts(null);
      rememberDismissed();
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  };

  const handleSkip = () => {
    // The guest cookie is deliberately left alone, so this stays reversible: signing
    // out again brings the anonymous boards back.
    rememberDismissed();
    setCounts(null);
  };

  if (!counts) {
    return null;
  }

  return (
    <Modal
      open
      title="Import your guest boards?"
      description={`We found ${pluralize(
        counts.boards,
        "board",
      )} from your guest session${
        counts.folders > 0 ? ` and ${pluralize(counts.folders, "folder")}` : ""
      }. Import them into ${user?.email ?? "your account"}?`}
      confirmLabel={busy ? "Importing…" : "Import"}
      onConfirm={() => void handleImport()}
      onCancel={handleSkip}
    >
      <div data-testid="claim-prompt">
        <p>
          Importing moves them to your account and deletes the guest session. If
          you skip, they stay in this browser and you keep working without an
          account.
        </p>
        {failed ? (
          <p role="alert" data-testid="claim-error">
            Import failed. Please try again.
          </p>
        ) : null}
        <button
          type="button"
          onClick={handleSkip}
          disabled={busy}
          data-testid="claim-skip"
        >
          Skip
        </button>
      </div>
    </Modal>
  );
};
