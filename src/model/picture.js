// A static picture of a board for readers without Plexus: one image child block of the board block.

export const PICTURE_TYPE = "picture";
export const PICTURE_MAX_SIDE = 4096;

const clean = (text) => String(text ?? "").replace(/[[\]()\r\n]+/g, " ").replace(/\s+/g, " ").trim();

export function pictureString({ url, title = "", date = "" } = {}) {
  const name = clean(title) || "board";
  const day = clean(date);
  return `![Plexus board: ${name}${day ? `, ${day}` : ""}](${String(url ?? "").trim()})`;
}
