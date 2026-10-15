// Chrome the board must not pan, zoom, or cancel. Used by the board pointer listeners.

export const BOARD_OVERLAY = ".pxd-chrome, .pxd-contexts, .pxd-memory";

// Reader and PDF text. A click or drag here selects text. It must not hit the board.
export const READER_TEXT = ".pxd-read, .rm-pdf-container, .pxd-pdf-reader, .pxd-pdf-live, .textLayer";

export function leavesBoardPointer(target) {
  return Boolean(target?.closest?.(BOARD_OVERLAY));
}

export function inReaderText(target) {
  return Boolean(target?.closest?.(READER_TEXT));
}
