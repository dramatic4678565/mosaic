# Upstream-only workflows that are disabled in the Mosaic fork.

#

# Each was renamed from `*.yml` to `*.yml.disabled` (GitHub only reads `.yml`).

# Keeping the files rather than deleting them documents _why_ they are off and

# makes re-enabling a one-line rename if Mosaic ever grows that capability.

#

# | Disabled | Why |

# |-------------------------|-----|

# | autorelease-excalidraw | Publishes `@excalidraw/*` to npm with `secrets.NPM_TOKEN`. Mosaic does not publish the upstream packages, and there is no NPM_TOKEN. |

# | locales-coverage | Pushes translation coverage to upstream's project using `secrets.PUSH_TRANSLATIONS_COVERAGE_PAT`. The 57 non-English locales are still Crowdin-managed from upstream's side; Mosaic does not push to that project. |

# | publish-docker | Pushes to upstream's Docker Hub (`secrets.DOCKER_USERNAME` / `DOCKER_PASSWORD`). Mosaic publishes to GHCR instead, via `docker.yml`. |

# | sentry-production | Uploads source maps to upstream's Sentry org with `SENTRY_*` secrets that belong to the Excalidraw project. Pointing at someone else's Sentry would leak Mosaic's code and error data to them. |

#

# Everything else in `.github/workflows/` is either Mosaic-authored

# (`ci.yml`, `upstream-sync.yml`, `docker.yml`) or still-valid upstream tooling

# (`lint.yml`, `test.yml`, `size-limit.yml`, `cancel.yml`,

# `test-coverage-pr.yml`, `semantic-pr-title.yml`, `build-docker.yml`).
