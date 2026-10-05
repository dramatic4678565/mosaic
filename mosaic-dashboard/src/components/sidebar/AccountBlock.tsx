import styles from "./AccountBlock.module.scss";

import { authEnabled, type AuthUser } from "@/lib/auth";

/**
 * Account block for the sidebar footer.
 *
 * Shows one of three things, and which one is the whole design:
 *
 * - **Loading** — nothing. Rendering "Sign in" before `/api/auth/me` answers would
 *   flash the wrong state at every signed-in user on every page load.
 * - **Signed out** — a single "Sign in" link. No prompt, no modal, no banner.
 * - **Signed in** — the address, and a "Sign out" action.
 *
 * Absent entirely when the build has no API configured (IndexedDB mode), because
 * showing a Sign in link that goes nowhere would be worse than showing nothing.
 *
 * This is a plain `Link` rather than a router-aware active state because it is a
 * footer affordance, not a destination competing with the primary nav.
 */
export const AccountBlock = ({
  user,
  loading,
  onSignOut,
}: {
  user: AuthUser | null;
  loading: boolean;
  onSignOut: () => void;
}) => {
  if (!authEnabled || loading) {
    return null;
  }

  if (!user) {
    return (
      <div className={styles.account} data-testid="account-signed-out">
        <a className={styles.signIn} href="/login" data-testid="sign-in-link">
          Sign in
        </a>
      </div>
    );
  }

  return (
    <div className={styles.account} data-testid="account-signed-in">
      <span
        className={styles.email}
        title={user.email}
        data-testid="account-email"
      >
        {user.email}
      </span>
      <button
        type="button"
        className={styles.signOut}
        onClick={onSignOut}
        data-testid="sign-out"
      >
        Sign out
      </button>
    </div>
  );
};
