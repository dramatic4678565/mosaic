/// <reference types="vite/client" />

/**
 * SCSS Modules and CSS Modules declarations.
 *
 * Vite scopes `*.module.scss` to a hashed class map; TypeScript has no built-in
 * knowledge of that, so without this declaration every `import styles from
 * "./X.module.scss"` fails with TS2307.
 */
declare module "*.module.scss" {
  const classes: { readonly [key: string]: string };
  export default classes;
}

declare module "*.module.css" {
  const classes: { readonly [key: string]: string };
  export default classes;
}

declare module "*.scss";

interface ImportMetaEnv {
  /**
   * Where the editor is mounted relative to this app's origin.
   * Defaults to "/app/" (the nginx layout in Dockerfile / docker/nginx.conf).
   * The e2e suite overrides it to "/editor/" via `.env.e2e`.
   */
  readonly VITE_EDITOR_BASE?: string;
  /**
   * Selects the storage backend — see `src/lib/storage/index.ts`.
   *
   * - **undefined** (variable absent): IndexedDB. This is the default for local dev
   *   and the e2e suite, which must stay offline and hermetic.
   * - **""** (present but empty): the Neon API, same-origin under `/api`. This is
   *   what production sets, and it is why the empty string counts as "defined" —
   *   treating it as absent would silently send production back to local storage.
   * - A hostname switches to a cross-origin API (unused today; the functions are
   *   deployed alongside the dashboard).
   *
   * There is deliberately no VITE_-prefixed value that could carry a secret here:
   * everything VITE_ is inlined into the public bundle.
   */
  readonly VITE_API_URL?: string;
  readonly VITE_APP_PORT?: string;
  readonly BASE_URL?: string;
  /**
   * Router basename. Deliberately independent of `BASE_URL`; defaults to "".
   * Only set it if the app is mounted under a prefix that is *not* already part
   * of the route table. See the note above `BASENAME` in `src/App.tsx`.
   */
  readonly MOSAIC_DASHBOARD_BASENAME?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
