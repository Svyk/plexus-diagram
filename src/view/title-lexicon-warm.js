// One idle read of the cached title word list once a board with PDF cards has painted. Cache Storage only; never a fetch.

export function scheduleTitleLexiconWarm({ win, hasPdf, ocr, cached = null, isDisposed, onWarm, setTimer = setTimeout }) {
  if (typeof hasPdf !== "function" || !hasPdf()) return false;
  const warm = () => {
    if (isDisposed()) return;
    let job = null;
    try { job = ocr()?.warmTitleLexicon?.(); } catch { job = null; }
    Promise.resolve(job).then((ok) => {
      if (ok === true && !isDisposed()) onWarm();
    }).catch(() => {});
  };
  // With `cached`, the OCR code is only reached when the word list is already in Cache Storage.
  const run = () => {
    if (isDisposed()) return;
    if (typeof cached !== "function") { warm(); return; }
    let probe = null;
    try { probe = cached(); } catch { probe = null; }
    Promise.resolve(probe).then((hit) => { if (hit === true) warm(); }).catch(() => {});
  };
  if (typeof win?.requestIdleCallback === "function") {
    try { win.requestIdleCallback(run, { timeout: 1500 }); return true; } catch { /* fall through */ }
  }
  setTimer(run, 1500);
  return true;
}
