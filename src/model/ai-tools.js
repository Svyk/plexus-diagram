// PXD-5. Tools for Roam AI agents (extensionAPI.ai.addTool). Pure: the host, the board pull and the session
// come in through deps, so the tools run under node:test without Roam.
import { buildBoard, worldRects } from "./board.js";
import { boardToMarkdown, titleOf } from "./export.js";
import {
  ADD_CAP,
  assertCardBatch,
  boardUidOf,
  boardsMatching,
  loadPlexusBoard,
  placeCards,
  prepareEdges,
  prepareSection,
  runBoardWrite,
  writeEdges,
} from "./board-writes.js";
import { DIRS } from "./schema.js";

export { autoPlace, boardUidOf } from "./board-writes.js";

const MAX_TOOLS = 25;
const LIST_CAP = 200;
const CARD_CAP = 500;
const TEXT_CAP = 40000;

const round = (r) => ({ x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.w), h: Math.round(r.h) });

const str = (description) => ({ type: "string", description });
const boardProp = str("Board block uid, with or without (( )). Get it from list_boards.");

export function createAiTools(deps) {
  const { listBoards, pullBoard, withSession } = deps;

  const load = (raw) => loadPlexusBoard(raw, pullBoard);
  const run = (context, raw, fn) => runBoardWrite({ context, raw, withSession, pullBoard, fn });

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
      const rows = boardsMatching(listBoards() ?? [], args?.page);
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
      const cards = assertCardBatch(args?.cards);
      const { board } = load(args?.board);
      const list = placeCards(board, cards, args?.section, { joinPlaced: false });
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
      const prepared = prepareSection(board, args);
      const uid = await run(context, args.board, (session) => session.createSection(prepared));
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
      const [edge] = prepareEdges(board, { from: args?.from, to: args?.to, label: args?.label, direction: args?.direction });
      const [uid] = await run(context, args.board, (session) => writeEdges(session, [edge]));
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
