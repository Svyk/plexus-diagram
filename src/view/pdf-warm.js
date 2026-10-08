// PDF-U1 page image. Snapshot a live reader, or warm one hidden mount.
// create() and import do nothing. request() does no DOM and no store work
// on the caller's turn: the mount waits one timer task, so board open stays
// clear even if a caller asks too early. No graph write, no console,
// no document listener. A failure resolves null.
// The holder stays visibility:hidden so pdf.js can measure it. It is never taken out of layout.

import { COVER_MAX_W, WARM_MAX, coverKey, coverValid, scaleBox, isBlankCanvas } from "../model/pdf-cover.js";
import { TITLE_REV } from "../model/title-cap.js";
import { firstPageAllowed } from "./pdf-first-page.js";

export const WARM_TIMEOUT_MS = 8000;
export const WARM_POLL_MS = 100;
export const COVER_JPEG = 0.72;

const HOLDER_CLASS = "pxd-pdf-warm";

function clockOf(now) {
  return typeof now === "function" ? now : () => Date.now();
}

function timersOf(timers) {
  const set = typeof timers?.setTimeout === "function" ? timers.setTimeout.bind(timers) : setTimeout;
  const clear = typeof timers?.clearTimeout === "function" ? timers.clearTimeout.bind(timers) : clearTimeout;
  return { set, clear };
}

function positiveInt(value) {
  const n = Number(value);
  return Number.isInteger(n) && n >= 1 ? n : null;
}

function arm(timers, fn, ms) {
  try {
    const id = timers.set(fn, ms);
    try { id?.unref?.(); } catch { /* browser ids are numbers */ }
    return id;
  } catch {
    return null;
  }
}

function disarm(timers, id) {
  if (id == null) return;
  try { timers.clear(id); } catch { /* already cleared */ }
}

function pageNodes(root) {
  try {
    const nodes = root?.querySelectorAll?.(".page");
    if (!nodes || typeof nodes.length !== "number") return [];
    return nodes;
  } catch {
    return [];
  }
}

// The page whose data-page-number matches, and whose canvas has backing width.
function paintedCanvas(root, page) {
  try {
    const want = String(page);
    const nodes = pageNodes(root);
    for (let i = 0; i < nodes.length; i += 1) {
      const node = nodes[i];
      const attr = node?.getAttribute?.("data-page-number");
      if (attr == null || String(attr) !== want) continue;
      const canvas = node.querySelector?.("canvas");
      if (canvas && Number(canvas.width) > 0) return canvas;
    }
    return null;
  } catch {
    return null;
  }
}

function countPages(root) {
  try {
    const nodes = pageNodes(root);
    let max = 0;
    for (let i = 0; i < nodes.length; i += 1) {
      const n = positiveInt(nodes[i]?.getAttribute?.("data-page-number"));
      if (n && n > max) max = n;
    }
    return max || null;
  } catch {
    return null;
  }
}

// The page title read during a warm ("" when the page has none); null until one was read.
function titleFields(next, prev) {
  const got = next && typeof next.pageTitle === "string";
  return {
    titleRev: got ? TITLE_REV : (typeof prev?.pageTitle === "string" ? positiveInt(prev.titleRev) ?? null : null),
    pageTitle: got ? next.pageTitle : (typeof prev?.pageTitle === "string" ? prev.pageTitle : null),
    titleLines: got ? (Array.isArray(next.titleLines) ? next.titleLines : []) : (Array.isArray(prev?.titleLines) ? prev.titleLines : []),
  };
}

// A cached cover whose page title was never read: one title-only pass fills it.
export function needsPageTitle(record) {
  return Boolean(record) && typeof record === "object" && typeof record.pageTitle !== "string";
}

function hasFirst(record) {
  const value = record?.first;
  if (typeof value === "string") return value.length > 0;
  return Boolean(value) && typeof value === "object" && typeof value.size === "number" && value.size > 0;
}

function boxOf(node) {
  try {
    return typeof node.getBoundingClientRect === "function" ? node.getBoundingClientRect() : null;
  } catch {
    return null;
  }
}

function viewportOf(doc) {
  try {
    const view = doc?.defaultView;
    const w = Number(view?.innerWidth);
    const h = Number(view?.innerHeight);
    if (w > 0 && h > 0) return { w, h };
  } catch { /* stub */ }
  return null;
}

// A reader with no measurable box still counts. A positive box that misses the
// window does not: the page outline keeps every PDF mounted below the board.
function readerInView(node, doc) {
  const rect = boxOf(node);
  const view = viewportOf(doc);
  if (!rect || !view) return true;
  const width = Number(rect.width);
  const height = Number(rect.height);
  if (!(width > 0) || !(height > 0)) return true;
  const left = Number(rect.left ?? rect.x);
  const top = Number(rect.top ?? rect.y);
  if (!Number.isFinite(left) || !Number.isFinite(top)) return true;
  return left < view.w && top < view.h && left + width > 0 && top + height > 0;
}

function foreignReader(doc, holder) {
  try {
    const nodes = doc?.querySelectorAll?.(".rm-pdf-container") || [];
    for (let i = 0; i < nodes.length; i += 1) {
      const node = nodes[i];
      if (holder && typeof holder.contains === "function" && holder.contains(node)) continue;
      if (typeof node.closest === "function" && node.closest(".pxd-pdf-warm, .pxd-read")) continue;
      if (!readerInView(node, doc)) continue;
      return true;
    }
    return false;
  } catch {
    return false;
  }
}

function applyHolderStyle(el) {
  const style = el.style;
  if (!style) return;
  style.position = "absolute";
  style.left = "-10000px";
  style.top = "0";
  style.width = "640px";
  style.height = "900px";
  style.visibility = "hidden";
  style.pointerEvents = "none";
  try { style.setProperty?.("pointer-events", "none"); } catch { /* stub */ }
}

// P32-2: `renderFirst({ url, maxW })` is the pdf.js path (pdf-first-page.js). When it resolves a page
// image the job never mounts a reader; null falls through to the hidden mount. `paths` counts both.
export function createPdfWarm({ doc, root, host, store, timers, now, renderFirst } = {}) {
  const time = timersOf(timers);
  const nowFn = clockOf(now);
  const outcomes = new Map();
  const paths = { pdfjs: 0, reader: 0 };
  let generation = 0;
  let pending = 0;
  let spentCount = 0;
  let current = null;

  function blobOf(canvas) {
    return new Promise((resolve) => {
      let settled = false;
      let timer = null;
      const finish = (blob) => {
        if (settled) return;
        settled = true;
        disarm(time, timer);
        resolve(blob || null);
      };
      try {
        if (!canvas || typeof canvas.toBlob !== "function") { finish(null); return; }
        timer = arm(time, () => finish(null), WARM_TIMEOUT_MS);
        const returned = canvas.toBlob((blob) => finish(blob), "image/jpeg", COVER_JPEG);
        if (returned && typeof returned.then === "function") {
          returned.then((blob) => finish(blob), () => finish(null));
        }
      } catch {
        finish(null);
      }
    });
  }

  // Draw before the first await, so a later unmount cannot blank the copy.
  function drawShot(canvas) {
    try {
      const box = scaleBox(canvas.width, canvas.height, COVER_MAX_W);
      if (!box || !doc || typeof doc.createElement !== "function") return null;
      const off = doc.createElement("canvas");
      off.width = box.w;
      off.height = box.h;
      const ctx = off.getContext?.("2d");
      if (!ctx || typeof ctx.drawImage !== "function" || typeof off.toBlob !== "function") return null;
      ctx.drawImage(canvas, 0, 0, box.w, box.h);
      if (isBlankCanvas(off)) return null;
      return { box, blob: blobOf(off) };
    } catch {
      return null;
    }
  }

  async function snapshotFrom(liveEl, info, isStale) {
    try {
      const spec = info && typeof info === "object" ? info : {};
      const role = spec.as === "last" ? "last" : "first";
      const page = positiveInt(spec.page) || (role === "first" ? 1 : null);
      const url = coverKey(spec.url);
      if (!page || !url) return null;
      const canvas = paintedCanvas(liveEl, page);
      if (!canvas) return null;
      const shot = drawShot(canvas);
      if (!shot) return null;
      const blob = await shot.blob;
      if (!blob || isStale?.()) return null;
      let prior = null;
      try { prior = store ? await store.get(url) : null; } catch { prior = null; }
      if (isStale?.()) return null;
      const prev = prior && typeof prior === "object" ? prior : {};
      const record = {
        url,
        hash: typeof spec.hash === "string" && spec.hash.trim() ? spec.hash.trim() : (typeof prev.hash === "string" ? prev.hash : ""),
        first: role === "first" ? blob : (prev.first ?? null),
        last: role === "last" ? blob : (prev.last ?? null),
        lastPage: role === "last" ? page : (positiveInt(prev.lastPage) ?? null),
        pageCount: positiveInt(spec.pageCount) ?? positiveInt(prev.pageCount) ?? countPages(liveEl),
        w: role === "first" ? shot.box.w : (positiveInt(prev.w) ?? shot.box.w),
        h: role === "first" ? shot.box.h : (positiveInt(prev.h) ?? shot.box.h),
        ...titleFields(null, prev),
        ts: nowFn(),
      };
      if (!store || typeof store.put !== "function") return record;
      try {
        const saved = await store.put(record);
        return saved || null;
      } catch {
        return null;
      }
    } catch {
      return null;
    }
  }

  // A page-1 image from the pdf.js path, saved the way a reader snapshot is.
  async function storeFirst(url, shot, hash, prior) {
    try {
      const prev = prior && typeof prior === "object" ? prior : {};
      const record = {
        url,
        hash: typeof hash === "string" && hash.trim() ? hash.trim() : (typeof prev.hash === "string" ? prev.hash : ""),
        first: shot.blob,
        last: prev.last ?? null,
        lastPage: positiveInt(prev.lastPage) ?? null,
        pageCount: positiveInt(shot.pageCount) ?? positiveInt(prev.pageCount) ?? null,
        w: positiveInt(shot.w) ?? null,
        h: positiveInt(shot.h) ?? null,
        ...titleFields(shot, prev),
        ts: nowFn(),
      };
      if (!store || typeof store.put !== "function") return record;
      const saved = await store.put(record);
      return saved || null;
    } catch {
      return null;
    }
  }

  // The page title alone, for a cover cached before titles were read. The image is kept as it is.
  async function storeTitle(record, read) {
    try {
      const next = { ...record, ...titleFields(read, record), pageCount: positiveInt(record.pageCount) ?? positiveInt(read?.pageCount) ?? null, ts: nowFn() };
      if (!store || typeof store.put !== "function") return next;
      const saved = await store.put(next);
      return saved || null;
    } catch {
      return null;
    }
  }

  function teardown(job) {
    disarm(time, job.pollId);
    job.pollId = null;
    if (job.mount) {
      try { host?.unmount?.(job.mount); } catch { /* already gone */ }
    }
    try { job.holder?.remove?.(); } catch { /* already gone */ }
    job.mount = null;
    job.holder = null;
  }

  function finishSlot(job) {
    if (job.counted) return;
    job.counted = true;
    if (spentCount < WARM_MAX) spentCount += 1;
  }

  function settle(job, value) {
    if (job.done) return;
    job.done = true;
    if (current === job) current = null;
    if (job.holding) {
      job.holding = false;
      pending = Math.max(0, pending - 1);
    }
    disarm(time, job.killId);
    disarm(time, job.startId);
    try { job.resolve(value ?? null); } catch { /* the caller is gone */ }
  }

  function begin(job) {
    try {
      if (job.gen !== generation || job.done) {
        settle(job, null);
        return;
      }
      const url = coverKey(job.card.url);
      const blockUid = typeof job.card.blockUid === "string" ? job.card.blockUid.trim() : "";
      if (!url || !blockUid || !doc || !root || typeof host?.renderBlock !== "function") {
        outcomes.set(job.uid, "skipped");
        settle(job, null);
        return;
      }
      const read = store && typeof store.get === "function" ? store.get(url) : null;
      Promise.resolve(read).then((record) => {
        if (job.gen !== generation || job.done) {
          settle(job, null);
          return null;
        }
        // A first-page image is enough. last-only still warms page 1.
        // A hash mismatch is not a hit: the bytes changed.
        if (hasFirst(record) && coverValid(record, job.card.hash)) {
          outcomes.set(job.uid, "ready");
          if (!needsPageTitle(record) || typeof renderFirst !== "function" || !firstPageAllowed(url)) {
            settle(job, record);
            return null;
          }
          return Promise.resolve()
            .then(() => renderFirst({ url, titleOnly: true, hash: job.card.hash }))
            .catch(() => null)
            .then(async (read) => {
              if (job.gen !== generation || job.done) { settle(job, null); return null; }
              // A busy renderer is not an answer: store nothing, the title is asked for again later.
              if (read && read.busy === true) { settle(job, null); return null; }
              // A failed read stores "" so the same PDF is not fetched again on every board open.
              const stored = await storeTitle(record, read && typeof read.pageTitle === "string" ? read : { pageTitle: "", titleLines: [] });
              finishSlot(job);
              settle(job, stored || record);
              return null;
            });
        }
        const viaPdfjs = typeof renderFirst === "function" && firstPageAllowed(url)
          ? Promise.resolve().then(() => renderFirst({ url, maxW: COVER_MAX_W, hash: job.card.hash })).catch(() => null)
          : Promise.resolve(null);
        return viaPdfjs.then(async (shot) => {
          if (job.gen !== generation || job.done) {
            settle(job, null);
            return null;
          }
          if (shot && shot.blob) {
            const stored = await storeFirst(url, shot, job.card.hash, record);
            if (job.gen !== generation || job.done) {
              settle(job, null);
              return null;
            }
            if (stored) {
              paths.pdfjs += 1;
              outcomes.set(job.uid, "ready");
              finishSlot(job);
              settle(job, stored);
              return null;
            }
          }
          if (foreignReader(doc, null)) {
            outcomes.set(job.uid, "skipped");
            settle(job, null);
            return null;
          }
          paths.reader += 1;
          return mount(job, url, blockUid);
        });
      }).catch(() => {
        if (!job.done) {
          outcomes.set(job.uid, "none");
          settle(job, null);
        }
      });
    } catch {
      if (!job.done) {
        outcomes.set(job.uid, "none");
        settle(job, null);
      }
    }
  }

  function mount(job, url, blockUid) {
    if (job.gen !== generation || job.done) return null;
    let holder = null;
    let mountEl = null;
    try {
      holder = doc.createElement("div");
      holder.className = HOLDER_CLASS;
      try { holder.setAttribute?.("aria-hidden", "true"); } catch { /* stub */ }
      applyHolderStyle(holder);
      mountEl = doc.createElement("div");
      holder.append(mountEl);
      root.append(holder);
    } catch {
      outcomes.set(job.uid, "none");
      finishSlot(job);
      settle(job, null);
      return null;
    }
    job.holder = holder;
    job.mount = mountEl;
    try { host.renderBlock(mountEl, blockUid); } catch {
      teardown(job);
      outcomes.set(job.uid, "error");
      finishSlot(job);
      settle(job, null);
      return null;
    }
    if (job.gen !== generation || job.done) {
      teardown(job);
      settle(job, null);
      return null;
    }
    job.killId = arm(time, () => fail(job, "error"), WARM_TIMEOUT_MS);
    const look = () => {
      if (job.done || job.gen !== generation) return;
      const canvas = paintedCanvas(mountEl, 1);
      if (!canvas) {
        job.pollId = arm(time, look, WARM_POLL_MS);
        return;
      }
      disarm(time, job.killId);
      job.killId = null;
      const pageCount = positiveInt(job.card.pageCount) ?? countPages(mountEl);
      snapshotFrom(mountEl, {
        page: 1,
        url,
        hash: job.card.hash,
        pageCount,
        as: "first",
      }, () => job.gen !== generation || job.done).then((record) => {
        teardown(job);
        if (job.gen !== generation) {
          settle(job, null);
          return;
        }
        outcomes.set(job.uid, record ? "ready" : "none");
        finishSlot(job);
        settle(job, record);
      }).catch(() => {
        teardown(job);
        outcomes.set(job.uid, "none");
        finishSlot(job);
        settle(job, null);
      });
    };
    look();
    return null;
  }

  function fail(job, status) {
    if (job.done) return;
    teardown(job);
    outcomes.set(job.uid, status);
    finishSlot(job);
    settle(job, null);
  }

  function cancelJob(job) {
    job.gen = -1;
    disarm(time, job.killId);
    disarm(time, job.startId);
    disarm(time, job.pollId);
    teardown(job);
    if (!job.counted && outcomes.get(job.uid) === "loading") outcomes.set(job.uid, "idle");
    settle(job, null);
  }

  return {
    request(card) {
      try {
        const uid = typeof card?.uid === "string" ? card.uid.trim() : "";
        const blockUid = typeof card?.blockUid === "string" ? card.blockUid.trim() : "";
        const url = coverKey(card?.url);
        if (!uid || !blockUid || !url) return Promise.resolve(null);
        if (current || spentCount >= WARM_MAX) return Promise.resolve(null);
        const gen = generation;
        let resolve = () => {};
        const promise = new Promise((done) => { resolve = done; });
        const job = {
          uid,
          card,
          gen,
          resolve,
          done: false,
          counted: false,
          holding: true,
          holder: null,
          mount: null,
          startId: null,
          pollId: null,
          killId: null,
        };
        current = job;
        pending += 1;
        outcomes.set(uid, "loading");
        job.startId = arm(time, () => begin(job), 0);
        if (job.startId == null) {
          outcomes.set(uid, "skipped");
          settle(job, null);
        }
        return promise;
      } catch {
        return Promise.resolve(null);
      }
    },
    cancelAll() {
      try {
        generation += 1;
        const job = current;
        current = null;
        if (job) cancelJob(job);
      } catch { /* dispose must be safe */ }
    },
    snapshotFrom(liveEl, info) {
      return snapshotFrom(liveEl, info, null);
    },
    // Face for coverState: loading | ready | none | error | skipped | idle.
    // skipped and idle both paint as none.
    outcome(uid) {
      return outcomes.get(uid) || "idle";
    },
    // Finished mounts this board session. Cancel, cache hit, and a foreign
    // reader do not spend a slot. Pass this as warmPlan's done.
    spent() {
      return spentCount;
    },
    running() {
      return pending > 0;
    },
    // P32-2 probe: how many covers came from pdf.js and how many from a hidden reader this board session.
    report() {
      return { spent: spentCount, pending, paths: { ...paths } };
    },
  };
}
