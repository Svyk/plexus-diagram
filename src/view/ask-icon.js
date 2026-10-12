// The one "Ask AI" mark: a rounded speech bubble with a tail at the bottom left and a four-point sparkle
// a little above and right of centre. 16 × 16, currentColor, the 1.5 stroke of the other Plexus icons.

const SVG_NS = "http://www.w3.org/2000/svg";

export const ASK_AI_BUBBLE = "M4.5 2.5h7A2.5 2.5 0 0 1 14 5v4a2.5 2.5 0 0 1-2.5 2.5H7.2l-3 2.3v-2.3A2.5 2.5 0 0 1 2 9V5a2.5 2.5 0 0 1 2.5-2.5z";
export const ASK_AI_SPARKLE = "M9.4 4.1Q9.7 6.3 11.9 6.6Q9.7 6.9 9.4 9.1Q9.1 6.9 6.9 6.6Q9.1 6.3 9.4 4.1z";

export function askAiIcon(doc, size = 16) {
  if (!doc) return null;
  const make = (tag) => (typeof doc.createElementNS === "function" ? doc.createElementNS(SVG_NS, tag) : doc.createElement(tag));
  const svg = make("svg");
  svg.setAttribute("viewBox", "0 0 16 16");
  svg.setAttribute("width", String(size));
  svg.setAttribute("height", String(size));
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("focusable", "false");
  svg.setAttribute("class", "pxd-ask-icon");
  const bubble = make("path");
  bubble.setAttribute("d", ASK_AI_BUBBLE);
  bubble.setAttribute("fill", "none");
  bubble.setAttribute("stroke", "currentColor");
  bubble.setAttribute("stroke-width", "1.5");
  bubble.setAttribute("stroke-linecap", "round");
  bubble.setAttribute("stroke-linejoin", "round");
  const spark = make("path");
  spark.setAttribute("d", ASK_AI_SPARKLE);
  spark.setAttribute("fill", "currentColor");
  spark.setAttribute("stroke", "currentColor");
  spark.setAttribute("stroke-width", "0.9");
  spark.setAttribute("stroke-linejoin", "round");
  svg.append(bubble, spark);
  return svg;
}

// Two offset rounded squares, for the gutter's Copy button.
export const COPY_PATHS = Object.freeze(["M6 5.5h6.5a1 1 0 0 1 1 1V13a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V6.5a1 1 0 0 1 1-1z", "M3.5 10.5H3a1 1 0 0 1-1-1V3a1 1 0 0 1 1-1h6.5a1 1 0 0 1 1 1v.5"]);

export function copyIcon(doc, size = 16) {
  if (!doc) return null;
  const make = (tag) => (typeof doc.createElementNS === "function" ? doc.createElementNS(SVG_NS, tag) : doc.createElement(tag));
  const svg = make("svg");
  svg.setAttribute("viewBox", "0 0 16 16");
  svg.setAttribute("width", String(size));
  svg.setAttribute("height", String(size));
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("focusable", "false");
  for (const d of COPY_PATHS) {
    const path = make("path");
    path.setAttribute("d", d);
    path.setAttribute("fill", "none");
    path.setAttribute("stroke", "currentColor");
    path.setAttribute("stroke-width", "1.5");
    path.setAttribute("stroke-linecap", "round");
    path.setAttribute("stroke-linejoin", "round");
    svg.append(path);
  }
  return svg;
}
