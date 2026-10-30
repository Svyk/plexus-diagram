// Rarely used code travels inside extension.js as deflated text (scripts/pieces.mjs). A forwarder
// calls pieceLoad on its first use, so the text is only inflated and evaluated if the feature runs.
// Roam Depot publishes extension.js and extension.css alone; nothing here touches the network.
// The call stays synchronous, which is why this file inflates by hand instead of using
// DecompressionStream.

let table = {};
let core = [];
const loaded = new Map();
const styles = [];
const styled = new Set();
const log = [];

// Which pieces ran in this window, and how long each took to inflate and evaluate.
export const pieceLog = () => log.slice();

export function pieceLoadAll() {
  for (const [name, entry] of Object.entries(table)) pieceLoad(name, Object.keys(entry.roots)[0]);
  return Object.keys(table);
}

export function pieceTable(pieces, coreModules) {
  table = pieces;
  core = coreModules;
}

export function pieceLoad(name, path) {
  let piece = loaded.get(name);
  if (!piece) {
    const entry = table[name];
    const start = globalThis.performance?.now?.() ?? 0;
    const text = new TextDecoder().decode(inflateBase64(entry.code));
    const exports = new Function("__core", text)(core);
    piece = { exports, roots: entry.roots };
    loaded.set(name, piece);
    log.push({ name, ms: Math.round((globalThis.performance?.now?.() ?? 0) - start) });
  }
  if (table[name].css && !styled.has(name)) {
    styled.add(name);
    addPieceStyle(name, new TextDecoder().decode(inflateBase64(table[name].css)));
  }
  return piece.exports[piece.roots[path]];
}

// A view built at board mount but rarely opened (the side panel, Kanban, presenter). It is built on
// the first use that needs it. `idle` answers the calls made while it does not exist yet: `calls`
// gives a method's result, `props` a property's value, and `replay` names setters whose last call
// is passed on when it gets built.
export function pieceDefer(make, idle) {
  let real = null;
  const owed = new Map();
  const build = () => {
    if (real === null) {
      real = make();
      for (const [key, args] of owed) real[key](...args);
      owed.clear();
    }
    return real;
  };
  return new Proxy({}, {
    get(_, key) {
      if (real === null && typeof key === "string") {
        if (idle.calls && key in idle.calls) return () => idle.calls[key];
        if (idle.props && key in idle.props) return idle.props[key];
        if (idle.replay?.includes(key)) return (...args) => { owed.set(key, args); };
      }
      const value = build()[key];
      return typeof value === "function" ? value.bind(real) : value;
    },
    set(_, key, value) {
      build()[key] = value;
      return true;
    },
    has(_, key) {
      return key in build();
    },
  });
}

function addPieceStyle(name, css) {
  const style = document.createElement("style");
  style.setAttribute("data-pxd-piece", name);
  style.textContent = css;
  document.head.appendChild(style);
  styles.push(style);
}

export function removePieceStyles() {
  for (const style of styles) style.remove();
  styles.length = 0;
  styled.clear();
}

const LENGTH_BASE = [3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 15, 17, 19, 23, 27, 31, 35, 43, 51, 59, 67, 83, 99, 115, 131, 163, 195, 227, 258];
const LENGTH_EXTRA = [0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 0];
const DIST_BASE = [1, 2, 3, 4, 5, 7, 9, 13, 17, 25, 33, 49, 65, 97, 129, 193, 257, 385, 513, 769, 1025, 1537, 2049, 3073, 4097, 6145, 8193, 12289, 16385, 24577];
const DIST_EXTRA = [0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10, 11, 11, 12, 12, 13, 13];
const CODE_ORDER = [16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15];

function huffman(lengths) {
  const count = new Uint16Array(16);
  for (const length of lengths) count[length] += 1;
  count[0] = 0;
  const offsets = new Uint16Array(16);
  for (let bits = 1; bits < 15; bits += 1) offsets[bits + 1] = offsets[bits] + count[bits];
  const symbols = new Uint16Array(lengths.length);
  lengths.forEach((length, symbol) => {
    if (length) symbols[offsets[length]++] = symbol;
  });
  return { count, symbols };
}

function fixedTables() {
  const lengths = new Uint8Array(288);
  lengths.fill(8, 0, 144);
  lengths.fill(9, 144, 256);
  lengths.fill(7, 256, 280);
  lengths.fill(8, 280, 288);
  return [huffman(lengths), huffman(new Uint8Array(30).fill(5))];
}

export function inflateBase64(base64) {
  const binary = atob(base64);
  const input = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) input[i] = binary.charCodeAt(i);
  return inflate(input);
}

export function inflate(input) {
  let output = new Uint8Array(input.length * 4);
  let size = 0;
  let position = 0;
  let bitBuffer = 0;
  let bitCount = 0;

  const bits = (need) => {
    while (bitCount < need) {
      bitBuffer |= input[position++] << bitCount;
      bitCount += 8;
    }
    const value = bitBuffer & ((1 << need) - 1);
    bitBuffer >>>= need;
    bitCount -= need;
    return value;
  };
  const decode = ({ count, symbols }) => {
    let code = 0;
    let first = 0;
    let index = 0;
    for (let length = 1; length <= 15; length += 1) {
      code |= bits(1);
      const here = count[length];
      if (code - here < first) return symbols[index + (code - first)];
      index += here;
      first = (first + here) << 1;
      code <<= 1;
    }
    throw new Error("Bad deflate data");
  };
  const room = (more) => {
    if (size + more <= output.length) return;
    const grown = new Uint8Array(Math.max(output.length * 2, size + more));
    grown.set(output);
    output = grown;
  };

  for (let last = 0; !last;) {
    last = bits(1);
    const type = bits(2);
    if (type === 0) {
      bitBuffer = 0;
      bitCount = 0;
      const length = input[position] | (input[position + 1] << 8);
      position += 4;
      room(length);
      output.set(input.subarray(position, position + length), size);
      size += length;
      position += length;
      continue;
    }
    if (type === 3) throw new Error("Bad deflate data");
    let tables;
    if (type === 1) tables = fixedTables();
    else {
      const literalCount = bits(5) + 257;
      const distanceCount = bits(5) + 1;
      const codeCount = bits(4) + 4;
      const codeLengths = new Uint8Array(19);
      for (let i = 0; i < codeCount; i += 1) codeLengths[CODE_ORDER[i]] = bits(3);
      const codeTable = huffman(codeLengths);
      const lengths = new Uint8Array(literalCount + distanceCount);
      for (let i = 0; i < lengths.length;) {
        const symbol = decode(codeTable);
        if (symbol < 16) lengths[i++] = symbol;
        else {
          const previous = symbol === 16 ? lengths[i - 1] : 0;
          const repeat = symbol === 16 ? 3 + bits(2) : symbol === 17 ? 3 + bits(3) : 11 + bits(7);
          lengths.fill(previous, i, i + repeat);
          i += repeat;
        }
      }
      tables = [huffman(lengths.subarray(0, literalCount)), huffman(lengths.subarray(literalCount))];
    }
    const [literals, distances] = tables;
    for (;;) {
      const symbol = decode(literals);
      if (symbol === 256) break;
      if (symbol < 256) {
        room(1);
        output[size++] = symbol;
        continue;
      }
      const length = LENGTH_BASE[symbol - 257] + bits(LENGTH_EXTRA[symbol - 257]);
      const slot = decode(distances);
      const distance = DIST_BASE[slot] + bits(DIST_EXTRA[slot]);
      room(length);
      for (let i = 0; i < length; i += 1) output[size + i] = output[size + i - distance];
      size += length;
    }
  }
  return output.subarray(0, size);
}
