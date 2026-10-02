export const EMPTY_HINT = "Double-click to add a block · drag bullets from the outline · press ? for shortcuts";

export function boardIsEmpty(board) {
  return (board?.items?.size || 0) === 0;
}

export function syncEmptyHint(node, board) {
  if (!node) return false;
  const show = boardIsEmpty(board);
  node.hidden = !show;
  if (show) {
    node.removeAttribute?.("hidden");
    if (node.textContent !== EMPTY_HINT) node.textContent = EMPTY_HINT;
  } else node.setAttribute?.("hidden", "");
  return show;
}
