// Chrome the board must not pan, zoom, or cancel. Used by the board pointer listeners.

export const BOARD_OVERLAY = ".pxd-chrome, .pxd-contexts, .pxd-memory";

export function leavesBoardPointer(target) {
  return Boolean(target?.closest?.(BOARD_OVERLAY));
}
