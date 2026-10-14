// P8 U2. A background part sized from what its items cost so far: ms per item (the costlier of the last part and a
// running mean), and as many items as fit what is left of the slice. One item at least, `max` at most.
export function createPartSizer({ max = 30, start = 4 } = {}) {
  let per = 0;
  return {
    size(leftMs) {
      if (!(per > 0)) return Math.max(1, Math.min(max, start));
      return Math.max(1, Math.min(max, Math.floor(Math.max(0, leftMs) / per)));
    },
    note(n, ms) {
      if (!(n > 0) || !(ms >= 0)) return;
      const last = ms / n;
      per = per > 0 ? Math.max(last, (per + last) / 2) : last;
    },
  };
}
