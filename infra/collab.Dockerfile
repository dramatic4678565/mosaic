# syntax=docker/dockerfile:1
#
# excalidraw-room, built for Mosaic.
#
# This exists instead of editing the submodule's own Dockerfile for three reasons:
#
# 1. The submodule stays pristine. A patched submodule shows as dirty in
#    `git submodule status`, cannot be updated with plain `git submodule update`,
#    and every upstream bump reintroduces a merge conflict. Upstream's file pins
#    `node:12-alpine`, which is long past EOL.
# 2. The build context is the repo root, so `infra/excalidraw-room/` is copied in
#    from the submodule without writing anything inside it.
# 3. Building with `tsc` in one stage and shipping only runtime dependencies in
#    the final image keeps the compiler and the lint stack out of the runtime.

# ---------------------------------------------------------------------------
# deps — install everything, including the TypeScript toolchain needed to build
# ---------------------------------------------------------------------------
FROM node:20-alpine AS deps

WORKDIR /app

# Manifests first so this layer is cached until dependencies actually change.
COPY infra/excalidraw-room/package.json infra/excalidraw-room/yarn.lock ./
RUN yarn install --frozen-lockfile --network-timeout 600000

# ---------------------------------------------------------------------------
# build — compile TypeScript to dist/
# ---------------------------------------------------------------------------
FROM deps AS build

COPY infra/excalidraw-room/tsconfig.json ./
COPY infra/excalidraw-room/src ./src
RUN yarn build

# ---------------------------------------------------------------------------
# runtime — production dependencies only, plus dist/
# ---------------------------------------------------------------------------
FROM node:20-alpine AS runtime

WORKDIR /app
ENV NODE_ENV=production

# Re-resolve dependencies without the dev-only lint/format stack. The room server
# lists everything under "dependencies", so this is what actually shrinks the
# image rather than a no-op.
COPY infra/excalidraw-room/package.json infra/excalidraw-room/yarn.lock ./
RUN yarn install --frozen-lockfile --production --network-timeout 600000 \
 && yarn cache clean

COPY --from=build /app/dist ./dist
COPY infra/excalidraw-room/public ./public

# The room server listens on 80 by default (src/index.ts), which is unprivileged.
EXPOSE 80

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD wget -q -O /dev/null http://localhost:80/ || exit 1

CMD ["node", "dist/index.js"]