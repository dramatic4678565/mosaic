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
  readonly VITE_EDITOR_URL?: string;
  readonly VITE_APP_PORT?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
