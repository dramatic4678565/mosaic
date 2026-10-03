import path from "path";
import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import svgrPlugin from "vite-plugin-svgr";
import { ViteEjsPlugin } from "vite-plugin-ejs";
import { VitePWA } from "vite-plugin-pwa";
import checker from "vite-plugin-checker";
import { createHtmlPlugin } from "vite-plugin-html";
import Sitemap from "vite-plugin-sitemap";
import { woff2BrowserPlugin } from "../scripts/woff2/woff2-vite-plugins";
export default defineConfig(({ mode }) => {
  // To load .env variables
  const envVars = loadEnv(mode, `../`);
  // https://vitejs.dev/config/
  return {
    /**
     * Public base path.
     *
     * Resolution order:
     *   1. `process.env.EXCALIDRAW_BASE_PATH` - what Docker and the e2e build
     *      set, because they mount the editor somewhere specific.
     *   2. `VITE_MOSAIC_EDITOR_BASE` from `.env.development` - local dev, so
     *      the path lives in a tracked file instead of an inline `FOO=bar`
     *      prefix, which is POSIX-only and silently does the wrong thing in
     *      cmd.exe.
     *   3. "/" - the plain standalone case.
     *
     * In local dev the editor is mounted at `/editor` because the dashboard's
     * dev server proxies `/editor` here so the two share one origin (and
     * therefore one IndexedDB). The `mosaic-root-redirect` plugin below keeps
     * "/" working for anyone who wants the editor on its own.
     */
    base:
      process.env.EXCALIDRAW_BASE_PATH ??
      envVars.VITE_MOSAIC_EDITOR_BASE ??
      "/",
    server: {
      port: Number(envVars.VITE_APP_PORT || 3000),
      // open the browser
      open: true,
      /**
       * No dashboard proxy here, and that is deliberate.
       *
       * Both apps must share an origin: the dashboard embeds this editor in an
       * iframe and both read the same IndexedDB database (`mosaic-dashboard`),
       * which is partitioned per origin. Two ports means two databases and every
       * board opens blank.
       *
       * The dashboard's route table is written as `/dashboard`,
       * `/dashboard/trash`, ..., `/board/:id` — it assumes it is mounted at the
       * root of its own origin, which is what production does (nginx: `/` =
       * dashboard, `/app/` = editor).
       *
       * Proxying `/dashboard` from here looks like the obvious fix and is not:
       * the dashboard's HTML is emitted with root-relative asset URLs
       * (`/assets/...`), so the browser would then request them from *this*
       * origin, where the editor answers 404. Making it work would mean proxying
       * the dashboard's entire dev module graph (`/@vite`, `/node_modules/.vite`,
       * `/src/**`, `/@id/**`), which breaks silently on the first miss and on
       * every Vite version bump.
       *
       * So in development the dashboard owns its own origin and is reached
       * directly at http://localhost:3002/ — the same arrangement the e2e
       * suite uses, and the one `verify:brand` and the Playwright specs are
       * proven against. This editor is reached at http://localhost:3000/editor/
       * (and at `/` thanks to the redirect plugin above).
       */
    },
    // We need to specify the envDir since now there are no
    //more located in parallel with the vite.config.ts file but in parent dir
    envDir: "../",
    resolve: {
      alias: [
        {
          find: /^@mosaic\/brand$/,
          replacement: path.resolve(
            __dirname,
            "../packages/mosaic-brand/src/index.ts",
          ),
        },
        {
          find: /^@mosaic\/brand\/(.*?)/,
          replacement: path.resolve(__dirname, "../packages/mosaic-brand/src/$1"),
        },
        {
          find: /^@excalidraw\/common$/,
          replacement: path.resolve(
            __dirname,
            "../packages/common/src/index.ts",
          ),
        },
        {
          find: /^@excalidraw\/common\/(.*?)/,
          replacement: path.resolve(__dirname, "../packages/common/src/$1"),
        },
        {
          find: /^@excalidraw\/element$/,
          replacement: path.resolve(
            __dirname,
            "../packages/element/src/index.ts",
          ),
        },
        {
          find: /^@excalidraw\/element\/(.*?)/,
          replacement: path.resolve(__dirname, "../packages/element/src/$1"),
        },
        {
          find: /^@excalidraw\/excalidraw$/,
          replacement: path.resolve(
            __dirname,
            "../packages/excalidraw/index.tsx",
          ),
        },
        {
          find: /^@excalidraw\/excalidraw\/(.*?)/,
          replacement: path.resolve(__dirname, "../packages/excalidraw/$1"),
        },
        {
          find: /^@excalidraw\/math$/,
          replacement: path.resolve(__dirname, "../packages/math/src/index.ts"),
        },
        {
          find: /^@excalidraw\/math\/(.*?)/,
          replacement: path.resolve(__dirname, "../packages/math/src/$1"),
        },
        {
          find: /^@excalidraw\/utils$/,
          replacement: path.resolve(
            __dirname,
            "../packages/utils/src/index.ts",
          ),
        },
        {
          find: /^@excalidraw\/utils\/(.*?)/,
          replacement: path.resolve(__dirname, "../packages/utils/src/$1"),
        },
        {
          find: /^@excalidraw\/fractional-indexing$/,
          replacement: path.resolve(
            __dirname,
            "../packages/fractional-indexing/src/index.ts",
          ),
        },
        {
          find: /^@excalidraw\/laser-pointer$/,
          replacement: path.resolve(
            __dirname,
            "../packages/laser-pointer/src/index.ts",
          ),
        },
      ],
    },
    build: {
      outDir: "build",
      rollupOptions: {
        output: {
          assetFileNames(chunkInfo) {
            if (chunkInfo?.name?.endsWith(".woff2")) {
              const family = chunkInfo.name.split("-")[0];
              return `fonts/${family}/[name][extname]`;
            }

            return "assets/[name]-[hash][extname]";
          },
          // Creating separate chunk for locales except for en and percentages.json so they
          // can be cached at runtime and not merged with
          // app precache. en.json and percentages.json are needed for first load
          // or fallback hence not clubbing with locales so first load followed by offline mode works fine. This is how CRA used to work too.
          manualChunks(id) {
            if (
              id.includes("packages/excalidraw/locales") &&
              id.match(/en.json|percentages.json/) === null
            ) {
              const index = id.indexOf("locales/");
              // Taking the substring after "locales/"
              return `locales/${id.substring(index + 8)}`;
            }

            if (id.includes("@excalidraw/mermaid-to-excalidraw")) {
              return "mermaid-to-excalidraw";
            }

            if (id.includes("@codemirror/") || id.includes("@lezer/")) {
              return "codemirror.chunk";
            }
          },
        },
      },
      sourcemap: true,
      // don't auto-inline small assets (i.e. fonts hosted on CDN)
      assetsInlineLimit: 0,
    },
    plugins: [
      /**
       * Redirect `/` to `/editor/` when the editor is mounted under a base path.
       *
       * In local dev the editor is mounted at `/editor` so the dashboard's dev
       * server can proxy `/editor` here and keep both apps on one origin — which
       * they must be, because they share one IndexedDB and IndexedDB is
       * partitioned per origin.
       *
       * Two details, both learned the hard way:
       *
       * 1. It must be a **redirect**, not a `req.url` rewrite. Rewriting makes
       *    Vite emit a relative module URL (`index.tsx`), which the browser
       *    resolves against `http://localhost:3000/` and requests as
       *    `/index.tsx` — a 404, so the page renders only its static
       *    `<h1>` and nothing else, with no error in any log.
       *
       * 2. It must be **unshifted onto the front of the stack**. A plain
       *    `server.middlewares.use()` is appended, and Vite's own index.html
       *    middleware runs first and answers `/` itself, so the redirect never
       *    fires.
       */
      {
        name: "mosaic-root-redirect",
        configureServer(server) {
          const redirect = (req: any, res: any, next: any) => {
            if (req.url === "/" || req.url === "/index.html") {
              res.statusCode = 302;
              res.setHeader("Location", "/editor/");
              res.end();
              return;
            }
            next();
          };
          server.middlewares.use(redirect);
          // `use()` appends; move it to the front so it beats Vite's own
          // index.html handling. Capture the removed layer before re-inserting it
          // — popping the stack after a splice would grab the wrong entry.
          const stack = server.middlewares.stack as any[];
          const index = stack.findIndex(
            (layer: any) => layer.handle === redirect,
          );
          if (index > 0) {
            const [layer] = stack.splice(index, 1);
            stack.unshift(layer);
          }
        },
      },
      Sitemap({
        hostname: "https://excalidraw.com",
        outDir: "build",
        changefreq: "monthly",
        // its static in public folder
        generateRobotsTxt: false,
      }),
      woff2BrowserPlugin(),
      react(),
      checker({
        typescript: true,
        eslint:
          envVars.VITE_APP_ENABLE_ESLINT === "false"
            ? undefined
            : { lintCommand: 'eslint "./**/*.{js,ts,tsx}"' },
        overlay: {
          initialIsOpen: envVars.VITE_APP_COLLAPSE_OVERLAY === "false",
          badgeStyle: "margin-bottom: 4rem; margin-left: 1rem",
        },
      }),
      svgrPlugin(),
      ViteEjsPlugin(),
      VitePWA({
        registerType: "autoUpdate",
        devOptions: {
          /* set this flag to true to enable in Development mode */
          enabled: envVars.VITE_APP_ENABLE_PWA === "true",
        },

        workbox: {
          // don't precache fonts, locales and separate chunks
          globIgnores: [
            "fonts.css",
            "**/locales/**",
            "service-worker.js",
            "**/*.chunk-*.js",
            // CodeMirrorEditor can't be assigned a `.chunk` name via
            // manualChunks because Rollup would hoist shared deps (React)
            // via a static import from the main bundle, defeating lazy
            // loading. So we exclude it by name instead.
            "**/CodeMirrorEditor-*.js",
          ],
          runtimeCaching: [
            {
              urlPattern: new RegExp(".+.woff2"),
              handler: "CacheFirst",
              options: {
                cacheName: "fonts",
                expiration: {
                  maxEntries: 1000,
                  maxAgeSeconds: 60 * 60 * 24 * 90, // 90 days
                },
                cacheableResponse: {
                  // 0 to cache "opaque" responses from cross-origin requests (i.e. CDN)
                  statuses: [0, 200],
                },
              },
            },
            {
              urlPattern: new RegExp("fonts.css"),
              handler: "StaleWhileRevalidate",
              options: {
                cacheName: "fonts",
                expiration: {
                  maxEntries: 50,
                },
              },
            },
            {
              urlPattern: new RegExp("locales/[^/]+.js"),
              handler: "CacheFirst",
              options: {
                cacheName: "locales",
                expiration: {
                  maxEntries: 50,
                  maxAgeSeconds: 60 * 60 * 24 * 30, // <== 30 days
                },
              },
            },
            {
              urlPattern: new RegExp("(.chunk-.+|CodeMirrorEditor-.+)\\.js"),
              handler: "CacheFirst",
              options: {
                cacheName: "chunk",
                expiration: {
                  maxEntries: 50,
                  maxAgeSeconds: 60 * 60 * 24 * 90, // <== 90 days
                },
              },
            },
          ],
          maximumFileSizeToCacheInBytes: 2.3 * 1024 ** 2, // 2.3MB
        },
        manifest: {
          short_name: "Mosaic",
          name: "Mosaic",
          description:
            "Mosaic is a whiteboard tool that lets you easily sketch diagrams that have a hand-drawn feel to them.",
          icons: [
            {
              src: "android-chrome-192x192.png",
              sizes: "192x192",
              type: "image/png",
            },
            {
              src: "apple-touch-icon.png",
              type: "image/png",
              sizes: "180x180",
            },
            {
              src: "favicon-32x32.png",
              sizes: "32x32",
              type: "image/png",
            },
            {
              src: "favicon-16x16.png",
              sizes: "16x16",
              type: "image/png",
            },
          ],
          start_url: "/",
          id: "excalidraw",
          display: "standalone",
          theme_color: "#121212",
          background_color: "#ffffff",
          file_handlers: [
            {
              action: "/",
              accept: {
                "application/vnd.excalidraw+json": [".excalidraw"],
              },
            },
          ],
          share_target: {
            action: "/web-share-target",
            method: "POST",
            enctype: "multipart/form-data",
            params: {
              files: [
                {
                  name: "file",
                  accept: [
                    "application/vnd.excalidraw+json",
                    "application/json",
                    ".excalidraw",
                  ],
                },
              ],
            },
          },
          screenshots: [
            {
              src: "/screenshots/virtual-whiteboard.png",
              type: "image/png",
              sizes: "462x945",
            },
            {
              src: "/screenshots/wireframe.png",
              type: "image/png",
              sizes: "462x945",
            },
            {
              src: "/screenshots/illustration.png",
              type: "image/png",
              sizes: "462x945",
            },
            {
              src: "/screenshots/shapes.png",
              type: "image/png",
              sizes: "462x945",
            },
            {
              src: "/screenshots/collaboration.png",
              type: "image/png",
              sizes: "462x945",
            },
            {
              src: "/screenshots/export.png",
              type: "image/png",
              sizes: "462x945",
            },
          ],
        },
      }),
      createHtmlPlugin({
        minify: true,
      }),
    ],
    publicDir: "../public",
  };
});
