// The board half of the parse motion: the PDF card being read gets the same beam, part outlines and ring as
// the reader, on its cover. Cards repaint, so the hosts are looked up again on every report. Nothing animates at
// map zoom or when the card is off screen; under prefers-reduced-motion only the ring and counts show.

import { createParseMotion, motionMode, prefersReducedMotion } from "./parse-motion.js";

// A parse run belongs to the card it started on: its later reports (a cancel after a card switch) go there too.
export function motionRouter(currentUid) {
  let runUid = "";
  return (event) => {
    if (event?.type === "start") runUid = currentUid() || "";
    const uid = runUid || currentUid() || "";
    if (event?.type === "done" || event?.type === "error" || event?.type === "cancel") runUid = "";
    return uid;
  };
}

const esc = (uid) => String(uid || "").replace(/["\\]/g, "\\$&");

export function createCardMotionRelay({ doc, root, pageOf = null, lod = null, viewport = null } = {}) {
  const live = new Map();
  // Runs that ended: their summary still plays (done/error), then they go idle. Kept only to be disposed.
  const finishing = new Map();
  const prune = () => {
    for (const [uid, entry] of finishing) {
      if (entry.motion.state?.() === "idle") { finishing.delete(uid); try { entry.motion.dispose(); } catch { /* gone */ } }
    }
  };
  const retire = (uid, entry) => {
    live.delete(uid);
    const old = finishing.get(uid);
    if (old && old !== entry) { try { old.motion.dispose(); } catch { /* gone */ } }
    finishing.set(uid, entry);
  };

  const cardEl = (uid) => {
    if (!uid || !root?.querySelector) return null;
    try { return root.querySelector(`.pxd-item[data-uid="${esc(uid)}"]`); } catch { return null; }
  };
  const hosts = (uid) => {
    const card = cardEl(uid);
    return {
      card,
      paper: card?.querySelector?.(".pxd-pdf-paper") || null,
      cover: card?.querySelector?.(".pxd-pdf-cover") || null,
    };
  };
  const onScreen = (card) => {
    if (!card?.getBoundingClientRect) return false;
    try {
      const r = card.getBoundingClientRect();
      const v = (typeof viewport === "function" ? viewport() : null) || root?.getBoundingClientRect?.();
      if (!v || !(r.width > 0) || !(r.height > 0)) return false;
      return r.right > v.left && r.left < v.right && r.bottom > v.top && r.top < v.bottom;
    } catch { return false; }
  };
  const tier = () => {
    try { return (typeof lod === "function" ? lod() : root?.getAttribute?.("data-pxd-lod")) || "detail"; } catch { return "detail"; }
  };
  const pageFor = (uid) => {
    try { return Number(pageOf?.(uid)) || 1; } catch { return 1; }
  };

  const controllerFor = (uid) => {
    let entry = live.get(uid);
    if (entry) return entry;
    entry = { uid, motion: null };
    entry.motion = createParseMotion({
      doc,
      cls: "pxd-pmotion--card",
      mode: () => motionMode({ reduced: prefersReducedMotion(doc?.defaultView), visible: onScreen(entry.card), lod: tier() }),
    });
    live.set(uid, entry);
    return entry;
  };
  const rebind = (entry) => {
    const { card, paper, cover } = hosts(entry.uid);
    entry.card = card;
    entry.motion.setOverlayHost(paper, paper ? pageFor(entry.uid) : 0);
    entry.motion.setHeadHost(cover);
  };
  const drop = (uid) => {
    const entry = live.get(uid);
    if (!entry) return;
    live.delete(uid);
    try { entry.motion.dispose(); } catch { /* gone */ }
  };

  return {
    handle(uid, event) {
      if (!uid || !event?.type) return;
      prune();
      if (event.type === "start") {
        const old = finishing.get(uid);
        if (old) { finishing.delete(uid); try { old.motion.dispose(); } catch { /* gone */ } }
        const entry = controllerFor(uid);
        rebind(entry);
        entry.motion.start();
        return;
      }
      if (event.type === "cancel") {
        const old = finishing.get(uid);
        if (old) { finishing.delete(uid); try { old.motion.dispose(); } catch { /* gone */ } }
      }
      const entry = live.get(uid);
      if (!entry) return;
      rebind(entry);
      if (event.type === "progress" || event.type === "page") {
        entry.motion.progress(event);
        if (event.type === "page") entry.motion.parts(event.page, event.boxes);
        return;
      }
      if (event.type === "done") {
        const page = entry.motion.overlayPage() || pageFor(uid);
        let boxes = [];
        try { boxes = typeof event.boxesOf === "function" ? event.boxesOf(page) : []; } catch { boxes = []; }
        // The controller clears its own nodes after the summary and can start again for the next parse.
        entry.motion.done({ counts: event.counts, ms: event.ms, boxes });
        retire(uid, entry);
        return;
      }
      if (event.type === "error") { entry.motion.fail(); retire(uid, entry); return; }
      if (event.type === "cancel") drop(uid);
    },
    active: () => [...live.keys()],
    dispose() {
      for (const entry of [...live.values(), ...finishing.values()]) {
        try { entry.motion.dispose(); } catch { /* gone */ }
      }
      live.clear();
      finishing.clear();
    },
  };
}
