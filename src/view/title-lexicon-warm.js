// One idle read of the cached title word list once a board with PDF cards has painted. Cache Storage only; never a fetch.

export function scheduleTitleLexiconWarm({ win, hasPdf, ocr, isDisposed, onWarm, setTimer = setTimeout }) {
  if (typeof hasPdf !== "function" || !hasPdf()) return false;
  const run = () => {
    if (isDisposed()) return;
    let job = null;
    try { job = ocr()?.warmTitleLexicon?.(); } catch { job = null; }
    Promise.resolve(job).then((ok) => {
      if (ok === true && !isDisposed()) onWarm();
    }).catch(() => {});
  };
  if (typeof win?.requestIdleCallback === "function") {
    try { win.requestIdleCallback(run, { timeout: 1500 }); return true; } catch { /* fall through */ }
  }
  setTimer(run, 1500);
  return true;
}
