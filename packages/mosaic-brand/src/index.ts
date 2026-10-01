/**
 * Mosaic — brand single source of truth.
 *
 * Every user-visible product string must come from here. Internal identifiers
 * (npm package names, import paths, localStorage keys, IndexedDB store names)
 * intentionally keep their upstream `excalidraw` spelling so the build never
 * breaks — see REBRAND.md.
 */

export const BRAND = {
  /** Display name, used in titles, menus and dialogs. */
  name: "Mosaic",
  /** Lowercase identifier for slugs, file names and manifest ids. */
  slug: "mosaic",
  /** <title> tag and default meta title. */
  title: "Mosaic — Visual Whiteboard",
  /** Placeholder until the production domain is provisioned. */
  domain: "mosaic.app",
  colors: {
    primary: "#3977df",
    accent: "#759dec",
  },
  logoLight: "/favicon.svg",
  logoDark: "/favicon.svg",
} as const;

export const BRAND_NAME = BRAND.name;
export const BRAND_SLUG = BRAND.slug;
export const BRAND_TITLE = BRAND.title;
export const BRAND_DOMAIN = BRAND.domain;

/** Manifest / PWA names. */
export const PWA_SHORT_NAME = BRAND.name;
export const PWA_NAME = BRAND.name;

/** One-line product description used in meta description + manifest. */
export const BRAND_DESCRIPTION =
  "Mosaic is a virtual collaborative whiteboard tool that lets you easily sketch diagrams that have a hand-drawn feel to them.";

/** Short marketing variant used in og:title / twitter:title. */
export const BRAND_TAGLINE = "Mosaic — Collaborative whiteboarding made easy";

/** Accessibility / alternate text for brand imagery. */
export const BRAND_IMAGE_ALT = "Mosaic logo";

/** Visually hidden <h1> on the app shell. */
export const BRAND_HEADING = BRAND.name;

/** File-picker descriptions (shown in native open/save dialogs). */
export const BRAND_FILE_DESCRIPTION = "Mosaic file";
export const BRAND_FILES_DESCRIPTION = "Mosaic files";
export const BRAND_LIBRARY_FILE_DESCRIPTION = "Mosaic library file";
export const BRAND_LIBRARY_FILES_DESCRIPTION = "Mosaic library files";

/** Group heading in the main menu. */
export const BRAND_LINKS_GROUP_TITLE = "Mosaic links";

/** Accessibility title for the editor iframe. */
export const BRAND_EMBEDDED_CONTENT_TITLE = "Mosaic Embedded Content";

/**
 * Upstream attribution required by the MIT license. Kept behind a small
 * "Credits" link rather than in the primary wordmark.
 */
export const ATTRIBUTION = {
  label: "Powered by Excalidraw",
  url: "https://excalidraw.com",
  license: "MIT",
  repository: "https://github.com/excalidraw/excalidraw",
} as const;
