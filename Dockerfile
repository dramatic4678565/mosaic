# syntax=docker/dockerfile:1
#
# Mosaic — single image serving BOTH apps.
#
#   /        -> dashboard  (mosaic-dashboard/dist)
#   /app/    -> editor    (excalidraw-app/build)
#
# Why one image rather than two: the dashboard embeds the editor in an iframe
# and both read the same IndexedDB, which is partitioned per origin. Serving them
# from one nginx under one host is what makes that data handoff work at all. Two
# containers would need a shared origin (reverse proxy + careful cookie and
# service-worker scoping) for no benefit here.
#
# Stage 1 builds both workspaces with the repo's own yarn workspaces, so the
# dependency graph is identical to a developer's checkout.

# ---------------------------------------------------------------------------
# Stage 1 — build
# ---------------------------------------------------------------------------
FROM --platform=${BUILDPLATFORM} node:20-bookworm-slim AS build

WORKDIR /opt/mosaic

# Copy manifests first so `yarn install` is cached until dependencies actually
# change. Copying the whole tree first (as the upstream Dockerfile does)
# invalidates the dependency layer on every source edit.
COPY package.json yarn.lock ./
COPY excalidraw-app/package.json ./excalidraw-app/
COPY mosaic-dashboard/package.json ./mosaic-dashboard/
COPY packages/common/package.json ./packages/common/
COPY packages/element/package.json ./packages/element/
COPY packages/excalidraw/package.json ./packages/excalidraw/
COPY packages/fractional-indexing/package.json ./packages/fractional-indexing/
COPY packages/laser-pointer/package.json ./packages/laser-pointer/
COPY packages/math/package.json ./packages/math/
COPY packages/utils/package.json ./packages/utils/
COPY packages/mosaic-brand/package.json ./packages/mosaic-brand/

# Native optional deps (esbuild/rollup platform binaries) must be installed for
# the *target* platform, hence TARGETARCH.
ARG TARGETARCH
RUN --mount=type=cache,target=/root/.cache/yarn \
    npm_config_target_arch=${TARGETARCH} \
    yarn install --frozen-lockfile --network-timeout 600000

# The rest of the source.
COPY . .

ARG NODE_ENV=production

# Both workspaces, in dependency order.
#
# The two base paths must match how the apps are *mounted*, or the editor's
# built index.html references its hashed chunks at the wrong URL and the app
# renders a blank canvas with no console error:
#
#   editor    -> /app/   (nginx serves it under /app/)
#   dashboard -> /       (it is the site root; VITE_EDITOR_BASE points back at /app/)
#
# Setting only the server-side mount is not enough -- the *build* has to know.
RUN npm_config_target_arch=${TARGETARCH} \
    EXCALIDRAW_BASE_PATH=/app \
    VITE_EDITOR_BASE=/app \
    yarn build:all

# Fail the build rather than shipping an image whose routes 404. The editor has
# to be checked at /app/ because that is the mounted path, not /.
RUN test -f /opt/mosaic/mosaic-dashboard/dist/index.html \
 && test -f /opt/mosaic/excalidraw-app/build/index.html

# Assert the editor's built HTML references its own mount point. A mismatch here
# is the blank-canvas failure mode: index.html loads, the chunks 404, and nothing
# reports an error.
RUN grep -q '/app/assets/index-' /opt/mosaic/excalidraw-app/build/index.html

# ---------------------------------------------------------------------------
# Stage 2 — serve
# ---------------------------------------------------------------------------
# nginx-unprivileged rather than stock nginx:alpine.
#
# Stock nginx runs as root, drops to the `nginx` user for workers but keeps root
# for the master, and writes its pid file and the *_temp directories under /var.
# Running it fully as an unprivileged user (which we want) therefore needs a pile
# of chown calls that break silently when a path changes between base images.
# This image is purpose-built for it: it runs as uid 101, listens on 8080 and
# needs no writable /var paths.
FROM nginxinc/nginx-unprivileged:1.27-alpine AS serve

# No `rm -rf /usr/share/nginx/html/*` here. This base image already runs as the
# non-root `nginx` user, so it cannot delete the root-owned stock files in
# /usr/share/nginx/html and the build fails with "Permission denied". `COPY` below
# overwrites index.html anyway, and the two stock files that would remain
# (50x.html, and a favicon we do not ship) are unreachable from any route we
# serve. Deleting them as root and dropping privileges would work but is more
# machinery for no benefit.

# Dashboard at the root.
COPY --from=build /opt/mosaic/mosaic-dashboard/dist /usr/share/nginx/html

# Editor under /app/.
COPY --from=build /opt/mosaic/excalidraw-app/build /usr/share/nginx/html/app

COPY docker/nginx.conf /etc/nginx/conf.d/default.conf

# The editor's service worker is registered at the site root by Vite's PWA
# plugin. Under /app/ it has to be /app/sw.js or the browser silently refuses to
# register it and offline support silently dies.
RUN sed -i 's#/sw.js#/app/sw.js#' /usr/share/nginx/html/app/index.html 2>/dev/null || true

# Validate the config during the build, not at runtime.
#
# A bad nginx.conf otherwise passes the whole multi-stage build and only fails
# when someone starts the container — which is exactly how a `{8,}` regex
# reached production once. `nginx -t` needs the html directory to exist, which
# the COPYs above have already created.
RUN nginx -t

# 8080 is the unprivileged image's default and is what nginx.conf listens on.
EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -q -O /dev/null http://localhost:8080/ || exit 1

CMD ["nginx", "-g", "daemon off;"]