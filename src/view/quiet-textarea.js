// PXD-1: Roam's block textarea is a controlled React input. After every keystroke React also writes the string to
// `defaultValue` (on input and again on the next commit), and that setter replaces the textarea's text child.
// A child-list change starts Blink's :has() walk up the ancestors. The board's host `.rm-block-main` and `.pxd-root`
// are non-subject :has() anchors, so Blink restyles everything under them that matches the document's one :has()
// invalidation set; other extensions' CSS puts `span` in that set. On MAIN that was ~2,190 elements, ~30 ms, twice a
// key. A typed-in textarea paints `value`, never its text child, so the board keeps React's string on the element.
const quieted = new WeakSet();

export function isRoamTextarea(node) {
  return node?.nodeType === 1 && String(node.tagName || "").toUpperCase() === "TEXTAREA" && Boolean(node.classList?.contains?.("rm-block-input"));
}

// Reads give back what was last written, so React's `defaultValue !== value` check sees the write as done.
export function quietTextarea(node) {
  if (!isRoamTextarea(node) || quieted.has(node)) return false;
  let value = String(node.defaultValue ?? "");
  try {
    Object.defineProperty(node, "defaultValue", {
      configurable: true,
      enumerable: true,
      get: () => value,
      set: (next) => { value = String(next); },
    });
  } catch {
    return false;
  }
  quieted.add(node);
  return true;
}
