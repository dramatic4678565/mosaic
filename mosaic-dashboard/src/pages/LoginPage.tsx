import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { BRAND } from "@mosaic/brand";

import styles from "./LoginPage.module.scss";

import { authEnabled, requestMagicLink } from "@/lib/auth";
import { MosaicMark } from "@/components/common/MosaicMark";
import { useAuthStore } from "@/state/useAuthStore";

/**
 * Sign-in page (STEP 3, route `/login`).
 *
 * One input and one button. There is no password field because there are no
 * passwords — the emailed link is the proof, which is why there is also nothing to
 * reset, no breach surface to manage, and no credential fields to autofill.
 *
 * ## Why this page never blocks anything
 *
 * Signing in is entirely optional. The dashboard works signed out against
 * IndexedDB, and this page is reachable only from an explicit "Sign in" link. No
 * route redirects here, and `/api/auth/*` failing does not degrade the app — a
 * visitor who never signs in never learns accounts exist.
 */

/** Human wording for the `error` code `/api/auth/verify` redirects with. */
const ERROR_COPY: Record<string, string> = {
  used: "That link has already been used. Request a new one below.",
  expired: "That link has expired. Request a new one below.",
  invalid: "That link is not valid. Request a new one below.",
  server: "Something went wrong on our side. Try again in a moment.",
};

export const LoginPage = () => {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const user = useAuthStore((s) => s.user);
  const refresh = useAuthStore((s) => s.refresh);

  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const linkError = params.get("error");

  /**
   * Already signed in? Go through.
   *
   * `refresh` first because the session cookie is set by a redirect from
   * `/api/auth/verify`, so the store in memory may still be signed out at this
   * point. `replace` so the login URL does not sit in history after leaving.
   */
  useEffect(() => {
    if (user) {
      navigate("/dashboard", { replace: true });
      return;
    }
    void refresh().then(() => {
      /* store update drives the redirect above */
    });
  }, [user, refresh, navigate]);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (busy) {
      return;
    }
    setBusy(true);
    setFormError(null);
    try {
      await requestMagicLink(email);
      setSent(true);
    } catch {
      // A failure here is a transport or server problem, not a statement about the
      // address — the server deliberately answers {ok:true} for anything it would
      // accept. So there is nothing to tell the user that would be accurate and
      // non-leaking, beyond "try again".
      setFormError("Could not send right now. Please try again.");
    } finally {
      setBusy(false);
    }
  };

  if (!authEnabled) {
    return (
      <div data-testid="login-page" className={styles.loginPage}>
        <p className={styles.loginPage__note}>
          This build has no server, so accounts are unavailable. Your boards are
          stored in this browser.
        </p>
      </div>
    );
  }

  return (
    <div data-testid="login-page" className={styles.loginPage}>
      <div className={styles.loginPage__card}>
        <div className={styles.loginPage__brand}>
          <MosaicMark title={BRAND.name} />
          <span>{BRAND.name}</span>
        </div>

        <h1 className={styles.loginPage__title}>Sign in</h1>
        <p className={styles.loginPage__lede}>
          We will email you a link. No password to remember, and nothing to
          reset if you forget it.
        </p>

        {linkError ? (
          <p
            role="alert"
            className={styles.loginPage__alert}
            data-testid="login-error"
          >
            {ERROR_COPY[linkError] ?? ERROR_COPY.invalid}
          </p>
        ) : null}

        {sent ? (
          <div data-testid="login-sent">
            <p className={styles.loginPage__sent}>
              Check your email. The link works once and expires in 15 minutes.
            </p>
            <button
              type="button"
              className={styles.loginPage__secondary}
              onClick={() => setSent(false)}
              data-testid="login-resend"
            >
              Use a different address
            </button>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className={styles.loginPage__form}>
            <label className={styles.loginPage__label} htmlFor="login-email">
              Email
            </label>
            <input
              id="login-email"
              className={styles.loginPage__input}
              type="email"
              // Not `required`: the server is the authority on what it accepts, and a
              // native bubble would fire before that could answer.
              autoComplete="email"
              autoFocus
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              data-testid="login-email"
            />

            {formError ? (
              <p role="alert" className={styles.loginPage__alert}>
                {formError}
              </p>
            ) : null}

            <button
              type="submit"
              className={styles.loginPage__submit}
              disabled={busy}
              data-testid="login-submit"
            >
              {busy ? "Sending…" : "Send magic link"}
            </button>
          </form>
        )}

        <p className={styles.loginPage__foot}>
          You do not need an account. Boards are stored in this browser either
          way.
        </p>
      </div>
    </div>
  );
};
