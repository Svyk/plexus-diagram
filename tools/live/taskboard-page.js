// Builds one board of cards on Plexus Diagram/Test Lab. Runs in the page as a background job:
// poll window.__pxdTaskBoard for { done, made, uids, boardUid, error }.
// spec.notes builds plain note cards. Otherwise Better Tasks task cards.
(() => {
  const spec = globalThis.__pxdTaskBoardSpec || { count: 40 };
  const count = Math.max(1, Number(spec.count) || 40);
  const notes = spec.notes === true;
  const title = "Plexus Diagram/Test Lab";
  const api = window.roamAlphaAPI;
  const px = window.__plexusDiagram;
  const get = (obj, key) => obj?.[key] ?? obj?.[":" + key];
  const state = { done: false, made: 0, uids: [], boardUid: null, error: null, notes: [] };
  window.__pxdTaskBoard = state;
  (async () => {
    try {
      if (!px?.session) throw new Error("no session api");
      const bt = (window.RoamExtensionTools?.["better-tasks"]?.tools || []).find((t) => t.name === "bt_modify");
      const page = api.data.pull("[:block/uid]", [":node/title", title]);
      const pageUid = get(page, "block/uid");
      if (!pageUid) throw new Error("Test Lab page missing");
      const boardUid = api.util.generateUID();
      const boardTitle = spec.title || (notes ? `RE bench notes ${count}` : `RE bench ${count}`);
      await api.data.block.create({ location: { "parent-uid": pageUid, order: "last" }, block: { uid: boardUid, string: `{{[[diagram]]:${boardTitle}}}` } });
      state.boardUid = boardUid;
      state.uids.push({ uid: boardUid, why: notes ? "RE bench notes board" : "RE bench board" });
      const session = px.session(boardUid);
      await session.enhance();
      const iso = (n) => { const d = new Date(2026, 9, 4 + n); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };
      const projects = ["EMP", "Ops", "QA"];
      const words = ["wash line", "check log", "swab plan", "review SOP", "order parts"];
      for (let i = 0; i < count; i += 1) {
        if (notes) {
          const string = `note ${i + 1} ${words[i % 5]}`;
          const uid = await session.createCard({ x: (i % 8) * 300, y: Math.floor(i / 8) * 190, string, w: 280, h: 160 });
          state.uids.push({ uid, why: "RE bench note card" });
          state.made += 1;
          continue;
        }
        const mark = i % 9 === 4 ? "DONE" : "TODO";
        const cancelled = i % 13 === 12 ? " #[[task-status/Cancelled]]" : "";
        const string = `{{[[${mark}]]}} task ${i + 1} ${words[i % 5]}${cancelled}`;
        const uid = await session.createCard({ x: (i % 8) * 300, y: Math.floor(i / 8) * 190, string, w: 280, h: 160 });
        state.uids.push({ uid, why: "RE bench task card" });
        if (bt && mark === "TODO" && i % 3 !== 2) {
          const attributes = { due: iso((i % 7) - 3) };
          if (i % 4 === 0) attributes.priority = ["low", "medium", "high"][i % 3];
          if (i % 5 === 0) attributes.project = projects[i % 3];
          if (spec.repeatEvery && i % spec.repeatEvery === 0) attributes.repeat = "every Friday";
          try { await bt.execute({ uid, attributes }); } catch (e) { state.notes.push(`bt ${uid}: ${e?.message || e}`); }
        }
        state.made += 1;
      }
    } catch (e) {
      state.error = String(e?.message || e);
    }
    state.done = true;
  })();
  return "started";
})()
