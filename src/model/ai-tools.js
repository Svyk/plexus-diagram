// PXD-5. Tools for Roam AI agents (extensionAPI.ai.addTool). Pure: the host, the board pull and the session
// come in through deps, so the tools run under node:test without Roam.
import { buildBoard, worldRects } from "./board.js";
import { boardToMarkdown, titleOf } from "./export.js";
import { boardVersion } from "./public-api.js";
import { DIRS } from "./schema.js";
import { MAX_GROUP_WRITES } from "../host/roam.js";

const MAX_TOOLS = 25;
const LIST_CAP = 200;
const CARD_CAP = 500;
const TEXT_CAP = 40000;
const ADD_CAP = 45;

export function boardUidOf(raw) {
  const s = String(raw ?? "").trim().replace(/^\(\(/, "").replace(/\)\)$/, "").trim();
  if (!s) throw new Error("Give a board uid");
  return s;
}

const round = (r) => ({ x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.w), h: Math.round(r.h) });

// Where new things go: left of the board, below everything (or the origin on an empty board).
function boardArea(board, rects) {
  let left = Infinity;
  let bottom = -Infinity;
  for (const item of board.items.values()) {
    if (item.parentUid !== board.uid) continue;
    const r = rects.get(item.uid);
    if (!r) continue;
    left = Math.min(left, r.x);
    bottom = Math.max(bottom, r.y + r.h);
  }
  return Number.isFinite(left) ? { x: left, y: bottom + 80 } : { x: 0, y: 0 };
}

export function autoPlace(n, area, { w = 280, h = 160, gap = 40, cols = 4 } = {}) {
  const out = [];
  for (let i = 0; i < n; i++) {
    out.push({ x: area.x + (i % cols) * (w + gap), y: area.y + Math.floor(i / cols) * (h + gap) });
  }
  return out;
}

const str = (description) => ({ type: "string", description });
const boardProp = str("Board block uid, with or without (( )). Get it from list_boards.");

export function createAiTools(deps) {
  const { listBoards, pullBoard, withSession } = deps;

  const load = (raw) => {
    const uid = boardUidOf(raw);
    const pulled = pullBoard(uid);
    if (boardVersion(pulled) !== 2) {
      throw new Error("Not a Plexus board. Open it in Roam and run Plexus: Enhance this diagram first.");
    }
    const board = buildBoard(pulled);
    if (!board) throw new Error("Not a Plexus board. Open it in Roam and run Plexus: Enhance this diagram first.");
    return { uid, board };
  };

  const run = async (context, raw, fn) => {
    const { uid } = load(raw);
    return withSession(uid, async (session) => {
      if (!session?.board) throw new Error("Board not loaded");
      let pending;
      let ran = false;
      const go = () => {
        ran = true;
        pending = session.asUser(context?.tokenUserUid, () => fn(session), { maxWrites: MAX_GROUP_WRITES });
        return pending;
      };
      if (typeof context?.asTokenUser === "function") context.asTokenUser(go); else go();
      if (!ran) throw new Error("Roam did not run the write");
      try {
        return await pending;
      } catch (err) {
        if (/one undo step holds/.test(String(err?.message))) throw err;
        throw new Error(`Roam did not save this change (${err?.message || err}). Plexus reloaded the board: read it and try again.`);
      }
    });
  };

  const list_boards = {
    name: "list_boards",
    scope: "read",
    description: "Lists the Plexus whiteboards in this graph with their uid, title, page and card count. Use it first to find a board uid. Up to 200 boards.",
    inputSchema: {
      type: "object",
      properties: { page: str("Only boards whose page title contains this text (case-insensitive).") },
      additionalProperties: false,
    },
    handler(args) {
      const needle = String(args?.page ?? "").trim().toLowerCase();
      const rows = (listBoards() ?? []).filter((r) => !needle || String(r.pageTitle ?? "").toLowerCase().includes(needle));
      const boards = rows.slice(0, LIST_CAP).map((r) => ({ uid: r.uid, title: r.title, page: r.pageTitle, pageUid: r.pageUid, cards: r.count }));
      return { boards, count: rows.length, truncated: rows.length > LIST_CAP };
    },
  };

  const read_board = {
    name: "read_board",
    scope: "read",
    description: "Reads one Plexus board: its outline as text, plus every section, card and arrow with world rectangles. Use it before changing a board. Returns at most 500 cards and 40000 characters of text.",
    inputSchema: {
      type: "object",
      properties: { board: boardProp },
      required: ["board"],
      additionalProperties: false,
    },
    handler(args) {
      const { uid, board } = load(args?.board);
      const rects = worldRects(board);
      const top = (item) => (item.parentUid === board.uid ? null : item.parentUid);
      const sections = [];
      const cards = [];
      let truncated = false;
      for (const item of board.items.values()) {
        const r = rects.get(item.uid);
        if (!r) continue;
        if (item.type === "section") {
          sections.push({ uid: item.uid, title: titleOf(item), parent: top(item), rect: round(r) });
        } else if (cards.length < CARD_CAP) {
          cards.push({ uid: item.uid, title: titleOf(item), kind: item.kind, section: top(item), rect: round(r) });
        } else truncated = true;
      }
      const arrows = [...board.edges.values()].filter((e) => e.valid)
        .map((e) => ({ uid: e.uid, from: e.from, to: e.to, label: e.label || "", direction: e.dir }));
      let text = boardToMarkdown(board, rects);
      if (text.length > TEXT_CAP) { text = text.slice(0, TEXT_CAP); truncated = true; }
      const out = { uid, title: board.title, text, sections, cards, arrows };
      if (truncated) out.truncated = true;
      return out;
    },
  };

  const add_cards = {
    name: "add_cards",
    // Edit, not append: a card placed in a section can grow that existing section (auto-fit) and push its neighbours.
    scope: "edit",
    description: "Adds cards to a board. Each card is plain text, one [[Page]] link or one ((block uid)). Up to 45 cards per call, one undo step; a section that grows to fit them takes a few writes of that budget, and a call over budget is refused with an error (split it). Cards without x and y are laid out in a grid.",
    inputSchema: {
      type: "object",
      properties: {
        board: boardProp,
        cards: {
          type: "array",
          minItems: 1,
          maxItems: ADD_CAP,
          description: "The cards to add, at most 45.",
          items: {
            type: "object",
            properties: {
              text: str("Card text: plain text, one [[Page]] or one ((block uid))."),
              x: { type: "number", description: "World x. Leave out to auto-place." },
              y: { type: "number", description: "World y. Leave out to auto-place." },
            },
            required: ["text"],
            additionalProperties: false,
          },
        },
        section: str("Section uid on this board to place the auto-placed cards in."),
      },
      required: ["board", "cards"],
      additionalProperties: false,
    },
    async handler(args, context) {
      const cards = Array.isArray(args?.cards) ? args.cards : [];
      if (!cards.length) throw new Error("Give at least one card");
      if (cards.length > ADD_CAP) throw new Error("At most 45 cards per call (Roam undo holds 50 changes)");
      const { board } = load(args?.board);
      const rects = worldRects(board);
      let area = boardArea(board, rects);
      let cols = 4;
      let into = null;
      if (args?.section) {
        const sec = board.items.get(boardUidOf(args.section));
        if (!sec || sec.type !== "section") throw new Error(`Not a section on this board: ${args.section}`);
        const r = rects.get(sec.uid);
        area = { x: r.x + 24, y: r.y + 60 };
        cols = Math.max(1, Math.floor((r.w - 24) / 320));
        into = sec.uid;
      }
      const slots = autoPlace(cards.length, area, { cols });
      const list = cards.map((c, i) => {
        const text = String(c?.text ?? "").trim();
        if (!text) throw new Error("Every card needs text");
        const placed = Number.isFinite(c.x) && Number.isFinite(c.y);
        const card = { string: text, x: placed ? c.x : slots[i].x, y: placed ? c.y : slots[i].y };
        // Auto-placed rows past the section's bottom still join it; auto-fit grows the section around them.
        if (into && !placed) card.into = into;
        return card;
      });
      const added = await run(context, args.board, (session) => session.addRefCards(list));
      return { added: added ?? [], count: (added ?? []).length };
    },
  };

  const add_section = {
    name: "add_section",
    scope: "append",
    description: "Adds an empty titled section (a frame that groups cards) to a board. Defaults to 640 by 400 below the existing content. One undo step.",
    inputSchema: {
      type: "object",
      properties: {
        board: boardProp,
        title: str("Section title."),
        x: { type: "number", description: "World x of the left edge." },
        y: { type: "number", description: "World y of the top edge." },
        w: { type: "number", description: "Width, default 640." },
        h: { type: "number", description: "Height, default 400." },
      },
      required: ["board", "title"],
      additionalProperties: false,
    },
    async handler(args, context) {
      const { board } = load(args?.board);
      const area = boardArea(board, worldRects(board));
      const num = (v, d) => (Number.isFinite(v) ? v : d);
      const rect = { x: num(args.x, area.x), y: num(args.y, area.y), w: num(args.w, 640), h: num(args.h, 400) };
      const uid = await run(context, args.board, (session) => session.createSection({ rect, title: String(args.title ?? "").trim() || "Section" }));
      return { uid };
    },
  };

  const connect_cards = {
    name: "connect_cards",
    scope: "append",
    description: "Draws an arrow between two items on a board, with an optional label. One undo step.",
    inputSchema: {
      type: "object",
      properties: {
        board: boardProp,
        from: str("Uid of the item the arrow starts at."),
        to: str("Uid of the item the arrow ends at."),
        label: str("Text on the arrow."),
        direction: { type: "string", enum: DIRS, description: "one = arrowhead at the end (default), two = both ends, none = a plain line." },
      },
      required: ["board", "from", "to"],
      additionalProperties: false,
    },
    async handler(args, context) {
      const { board } = load(args?.board);
      const from = boardUidOf(args?.from);
      const to = boardUidOf(args?.to);
      for (const id of [from, to]) if (!board.items.has(id)) throw new Error(`Not an item on this board: ${id}`);
      const dir = DIRS.includes(args.direction) ? args.direction : "one";
      const uid = await run(context, args.board, (session) => session.addEdge({ from, to, label: String(args.label ?? ""), dir }));
      if (!uid) throw new Error("Could not connect these two");
      return { uid };
    },
  };

  const arrange_board = {
    name: "arrange_board",
    scope: "edit",
    description: "Re-lays out cards in a grid, a row, a column or an outline. Targets the given cards, else one section, else the whole board. Moves existing cards; one undo step.",
    inputSchema: {
      type: "object",
      properties: {
        board: boardProp,
        mode: { type: "string", enum: ["grid", "row", "column", "outline"], description: "The layout to apply." },
        section: str("Arrange the members of this section."),
        cards: { type: "array", items: { type: "string" }, description: "Uids of the cards to arrange." },
      },
      required: ["board", "mode"],
      additionalProperties: false,
    },
    async handler(args, context) {
      const { board } = load(args?.board);
      if (!["grid", "row", "column", "outline"].includes(args.mode)) throw new Error("mode must be grid, row, column or outline");
      let uids;
      if (Array.isArray(args.cards) && args.cards.length) uids = args.cards.map(boardUidOf);
      else if (args.section) uids = [boardUidOf(args.section)];
      else uids = [...board.items.values()].filter((i) => i.parentUid === board.uid).map((i) => i.uid);
      for (const id of uids) if (!board.items.has(id)) throw new Error(`Not an item on this board: ${id}`);
      const moved = await run(context, args.board, (session) => session.tidyItems(uids, args.mode));
      return { moved: Number(moved) || 0 };
    },
  };

  return [list_boards, read_board, add_cards, add_section, connect_cards, arrange_board];
}

export function installAiTools(extensionAPI, tools) {
  const ai = extensionAPI?.ai;
  if (typeof ai?.addTool !== "function") return () => {};
  const added = [];
  let warned = false;
  for (const tool of (tools ?? []).slice(0, MAX_TOOLS)) {
    try {
      ai.addTool({ name: tool.name, description: tool.description, scope: tool.scope, inputSchema: tool.inputSchema, handler: tool.handler });
      added.push(tool.name);
    } catch (err) {
      if (!warned) { warned = true; console.warn("[plexus] AI tool not registered", tool.name, err); }
    }
  }
  return () => {
    for (const name of added.splice(0)) {
      try { ai.removeTool?.({ name }); } catch { /* already removed */ }
    }
  };
}
