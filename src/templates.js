// Inserts a starter onto the open board, and copies a board onto Plexus Diagram/Templates.
// Registers with extendSession. Creates stay in chunks of 45. Undo deletes the new root.
import { containerAt, toRelative } from "./model/board.js";
import { DEFAULT_BOARD_CARD } from "./model/schema.js";
import { TEMPLATE_PAGE, planCopy, planTemplate, starterById } from "./model/templates.js";
import { extendSession } from "./session.js";

const round1 = (n) => Math.round(n * 10) / 10;

async function writeChunks(chunks, write, toast) {
  for (let i = 0; i < chunks.length; i += 1) {
    await write(chunks[i]);
    if (chunks.length > 1) toast(`Template ${i + 1} of ${chunks.length}`);
  }
}

extendSession((session, api) => {
  const { host } = api;

  session.insertTemplate = (id, rect) => {
    const starter = starterById(id);
    const board = api.board();
    if (!starter || !board) return Promise.resolve(null);
    const d = DEFAULT_BOARD_CARD;
    const r = { x: rect?.x ?? 0, y: rect?.y ?? 0, w: rect?.w ?? d.w, h: rect?.h ?? d.h };
    const parent = containerAt(board, { x: r.x + r.w / 2, y: r.y + r.h / 2 }, { rects: api.rects() });
    const rel = toRelative(board, parent, { x: r.x, y: r.y }, api.rects());
    const plan = planTemplate(id, {
      genUid: () => host.generateUid(),
      parentUid: parent,
      plexusPatch: { x: round1(rel.x), y: round1(rel.y), w: r.w, h: r.h, v: 2 },
    });
    if (!plan?.creates.length) return Promise.resolve(null);
    const rootUid = plan.rootUid;
    return writeChunks(plan.chunks, (chunk) => api.txn((t) => {
      for (const op of chunk) {
        t.create({
          uid: op.uid,
          parent: op.parent,
          order: op.order,
          string: op.string,
          plexus: op.props?.plexus,
          open: op.open,
        });
      }
    }), (message) => api.emit("toast", { message })).then(() => {
      api.emit("toast", {
        message: `Inserted ${starter.title}`,
        action: { label: "Undo", run: () => api.txn((t) => t.del(rootUid)) },
      });
      return rootUid;
    });
  };

  session.saveAsTemplate = async () => {
    const tree = api.rawNode(api.uid);
    if (!tree) return null;
    const pageUid = await host.ensurePage?.(TEMPLATE_PAGE);
    if (!pageUid) {
      api.emit("toast", { message: "Couldn't open the templates page." });
      return null;
    }
    const plan = planCopy(tree, { genUid: () => host.generateUid(), parentUid: pageUid });
    if (!plan.creates.length) return null;
    const rootUid = plan.rootUid;
    await writeChunks(plan.chunks, async (chunk) => {
      await host.group(async () => {
        for (const op of chunk) {
          await host.createBlock({
            parentUid: op.parent,
            order: op.order,
            uid: op.uid,
            string: op.string,
            props: op.props,
            open: op.open,
          });
        }
      });
    }, (message) => api.emit("toast", { message }));
    api.emit("toast", {
      message: "Saved board as template",
      action: { label: "Undo", run: () => host.deleteBlock(rootUid) },
    });
    return rootUid;
  };
});
