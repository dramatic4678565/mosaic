// time constants (ms)
export const SAVE_TO_LOCAL_STORAGE_TIMEOUT = 300;
export const INITIAL_SCENE_UPDATE_TIMEOUT = 5000;
export const FILE_UPLOAD_TIMEOUT = 300;
export const LOAD_IMAGES_TIMEOUT = 500;

/**
 * How often outbound scene updates are flushed to collaborators.
 *
 * Upstream ships this at 20000, and `Collab.queueBroadcastAllElements` is a
 * `throttle` on exactly this constant. That means during continuous drawing the
 * scene is broadcast at most once every 20 seconds, which is the entire reason a
 * remote edit appeared to take ~60s: it is not a slow server, it is a
 * client-side throttle measured in tens of seconds.
 *
 * 50ms (20 updates/sec) is comfortably below a human perception threshold for
 * "live" while still coalescing the high-frequency move events a freehand stroke
 * produces into sane packet sizes. See docs/COLLAB.md.
 */
export const SYNC_FULL_SCENE_INTERVAL_MS = 50;

export const SYNC_BROWSER_TABS_TIMEOUT = 50;
export const CURSOR_SYNC_TIMEOUT = 33; // ~30fps

/**
 * Socket.io reconnection.
 *
 * Not specified upstream, so socket.io's defaults applied: first retry at 1s,
 * doubling up to 5s. Capping the ceiling at 3s keeps a dropped connection from
 * feeling broken while still backing off enough to avoid hammering a room server
 * that is genuinely down.
 */
export const WS_RECONNECTION = {
  reconnection: true,
  reconnectionAttempts: Infinity,
  // first retry fires at `reconnectionDelay`
  reconnectionDelay: 500,
  // ...and the backoff ceiling is capped rather than the default 5000, so a
  // dropped link recovers within 3s instead of drifting out to 5s+ per attempt
  reconnectionDelayMax: 3000,
  randomizationFactor: 0.5,
  timeout: 5000,
} as const;

export const DELETED_ELEMENT_TIMEOUT = 24 * 60 * 60 * 1000; // 1 day

// should be aligned with MAX_ALLOWED_FILE_BYTES
export const FILE_UPLOAD_MAX_BYTES = 4 * 1024 * 1024; // 4 MiB
// 1 year (https://stackoverflow.com/a/25201898/927631)
export const FILE_CACHE_MAX_AGE_SEC = 31536000;

export const WS_EVENTS = {
  SERVER_VOLATILE: "server-volatile-broadcast",
  SERVER: "server-broadcast",
  USER_FOLLOW_CHANGE: "user-follow",
  USER_FOLLOW_ROOM_CHANGE: "user-follow-room-change",
} as const;

export enum WS_SUBTYPES {
  INVALID_RESPONSE = "INVALID_RESPONSE",
  INIT = "SCENE_INIT",
  UPDATE = "SCENE_UPDATE",
  MOUSE_LOCATION = "MOUSE_LOCATION",
  IDLE_STATUS = "IDLE_STATUS",
  USER_VISIBLE_SCENE_BOUNDS = "USER_VISIBLE_SCENE_BOUNDS",
}

export const FIREBASE_STORAGE_PREFIXES = {
  shareLinkFiles: `/files/shareLinks`,
  collabFiles: `/files/rooms`,
};

export const ROOM_ID_BYTES = 10;

export const STORAGE_KEYS = {
  LOCAL_STORAGE_ELEMENTS: "excalidraw",
  LOCAL_STORAGE_APP_STATE: "excalidraw-state",
  LOCAL_STORAGE_COLLAB: "excalidraw-collab",
  LOCAL_STORAGE_THEME: "excalidraw-theme",
  LOCAL_STORAGE_DEBUG: "excalidraw-debug",
  VERSION_DATA_STATE: "version-dataState",
  VERSION_FILES: "version-files",

  IDB_LIBRARY: "excalidraw-library",
  IDB_TTD_CHATS: "excalidraw-ttd-chats",

  // do not use apart from migrations
  __LEGACY_LOCAL_STORAGE_LIBRARY: "excalidraw-library",
} as const;

export const COOKIES = {
  AUTH_STATE_COOKIE: "excplus-auth",
} as const;

export const isExcalidrawPlusSignedUser = document.cookie.includes(
  COOKIES.AUTH_STATE_COOKIE,
);
