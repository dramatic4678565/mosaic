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
  readonly VITE_APP_PORT?: string;
  readonly BASE_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
