import { create } from "zustand";

import { authEnabled, getSession, signOut, type AuthUser } from "@/lib/auth";

/**
 * Who is signed in, as far as the shell is concerned.
 *
 * Kept separate from `useDashboardStore` because the two answer different
 * questions and have different lifetimes. The dashboard store is about local
 * content — boards, folders, activity — and is fully usable signed out. This store
 * is about identity, and `user: null` is its normal resting state, not an error.
 *
 * That distinction is the whole reason the anonymous flow survives: nothing in the
 * dashboard store knows or cares whether a session exists.
 */

export type AuthState = {
  user: AuthUser | null;
  /** True until the first `/api/auth/me` answer lands, to avoid a Sign in flash. */
  loading: boolean;
  /** Set when the session could not be read, which is not the same as signed out. */
  error: string | null;
  /** Re-reads the session. Called on boot and after a sign-in redirect. */
  refresh: () => Promise<void>;
  /** Signs out and clears local state. */
  signOut: () => Promise<void>;
};

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  loading: authEnabled,
  error: null,

  refresh: async () => {
    if (!authEnabled) {
      // No API configured: this build has no accounts at all. Say so once and stop
      // asking, rather than reporting a signed-out state that implies otherwise.
      set({ user: null, loading: false, error: null });
      return;
    }
    set({ loading: true });
    try {
      set({ user: await getSession(), loading: false, error: null });
    } catch (error) {
      set({
        user: null,
        loading: false,
        error: error instanceof Error ? error.message : "unknown error",
      });
    }
  },

  signOut: async () => {
    await signOut();
    set({ user: null, error: null });
  },
}));
