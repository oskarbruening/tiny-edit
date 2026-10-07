/** Window geometry from the brief: 750 px editor + 200 px sidebar, 500 px tall. */
export const DEFAULT_SIDEBAR_WIDTH = 200;
export const DEFAULT_EDITOR_WIDTH = 750;
export const DEFAULT_WINDOW = {
  width: DEFAULT_EDITOR_WIDTH + DEFAULT_SIDEBAR_WIDTH,
  height: 500,
} as const;
export const MIN_WINDOW = { width: 400, height: 300 } as const;

/** Surface colour of the default (Meadow) theme; painted behind the renderer so there is no flash. */
export const DEFAULT_BACKGROUND = "#fbf9f7";

export const APP_NAME = "Tiny Edit";

/** Env var that redirects userData; used by E2E tests for isolation. */
export const USER_DATA_ENV = "TINY_EDIT_USER_DATA";
