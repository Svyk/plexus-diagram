(async () => {
  const spec = globalThis.__pxdFixture || { phase: "0", cards: 6 };
  const phase = String(spec.phase).replace(/^P/i, "");
  const extra = Math.max(0, Number(spec.cards) || 0);
  const title = "Plexus Diagram/Test Lab";
  const boardTitle = extra > 6 ? `P${phase} bench ${extra}` : `P${phase} fixture`;
  const api = window.roamAlphaAPI;
  const graph = (location.hash.match(/#\/app\/([^/]+)/) || [])[1] || "";
  const get = (obj, key) => obj?.[key] ?? obj?.[":" + key];
  const px = window.__plexusDiagram;
  if (!px?.session) return JSON.stringify({ ok: false, reason: "no-session-api", version: px?.version || null });

  let page = api.data.pull("[:block/uid]", [":node/title", title]);
  let pageUid = get(page, "block/uid") || null;
  let createdPage = false;
  if (!pageUid) {
    pageUid = api.util.generateUID();
    await api.data.page.create({ page: { title, uid: pageUid } });
    createdPage = true;
  }

  const boardUid = api.util.generateUID();
  await api.data.block.create({
    location: { "parent-uid": pageUid, order: "last" },
    block: { uid: boardUid, string: `{{[[diagram]]:${boardTitle}}}` },
  });

  const session = px.session(boardUid);
  const uids = [];
  const note = (uid, why) => { if (uid) uids.push({ uid, why }); };
  note(pageUid, createdPage ? "page" : "");
  note(boardUid, "board");
  try {
    const enhanced = await session.enhance();
    const sectionA = await session.createSection({ rect: { x: 40, y: 40, w: 480, h: 240 }, title: "Section one" });
    const sectionB = await session.createSection({ rect: { x: 560, y: 40, w: 480, h: 240 }, title: "Section two" });
    note(sectionA, "section");
    note(sectionB, "section");

    const noteCard = await session.createCard({ x: 40, y: 340, string: "Note card" });
    const pageCard = await session.createCard({ x: 360, y: 340, string: `[[${title}]]` });
    const sourceUid = api.util.generateUID();
    await api.data.block.create({
      location: { "parent-uid": pageUid, order: "last" },
      block: { uid: sourceUid, string: "Fixture source block" },
    });
    const blockCard = await session.createCard({ x: 680, y: 340, string: `((${sourceUid}))` });
    note(noteCard, "note");
    note(pageCard, "page-ref");
    note(sourceUid, "block-ref-source");
    note(blockCard, "block-ref");

    const canvas = document.createElement("canvas");
    canvas.width = 96;
    canvas.height = 64;
    const paint = canvas.getContext("2d");
    paint.fillStyle = "#3dcc91";
    paint.fillRect(0, 0, 96, 64);
    paint.fillStyle = "#102a43";
    paint.font = "20px sans-serif";
    paint.fillText("IMG", 28, 40);
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
    const file = new File([blob], "pxd-fixture.png", { type: "image/png" });
    const uploaded = await api.file.upload({ file, toast: { hide: true } });
    const raw = typeof uploaded === "string" ? uploaded : uploaded && uploaded.url;
    const imageString = typeof raw === "string" && raw.includes("](") ? raw : `![](${raw})`;
    const imageCard = await session.createCard({ x: 40, y: 560, string: imageString });
    const todoCard = await session.createCard({ x: 360, y: 560, string: "{{[[TODO]]}} Fixture todo" });
    const nested = await session.createBoard({ rect: { x: 680, y: 540, w: 280, h: 180 }, title: "Nested fixture" });
    note(imageCard, "image");
    note(todoCard, "todo");
    note(nested, "nested-board");

    const edgeLabel = await session.addEdge({ from: noteCard, to: pageCard, label: "causes" });
    const edgePlain = await session.addEdge({ from: pageCard, to: blockCard });
    const edgeThird = await session.addEdge({ from: todoCard, to: imageCard });
    note(edgeLabel, "edge-labelled");
    note(edgePlain, "edge");
    note(edgeThird, "edge");

    const extras = [];
    for (let i = 0; i < extra; i += 1) {
      const col = i % 10;
      const row = Math.floor(i / 10);
      const id = await session.createCard({ x: 40 + col * 300, y: 820 + row * 200, string: `Bench ${i + 1}` });
      note(id, "bench-card");
      extras.push(id);
    }

    await api.ui.mainWindow.openBlock({ block: { uid: boardUid } });
    return JSON.stringify({
      ok: Boolean(noteCard && pageCard && blockCard && imageCard && todoCard && nested && sectionA && sectionB && edgeLabel && edgePlain && edgeThird),
      graph, page: title, pageUid, createdPage, boardUid, boardTitle, enhanced,
      uids: uids.filter((row) => row.why),
      extras: extras.length,
    });
  } finally {
    session.release();
  }
})()
