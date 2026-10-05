// MEM-5. Dotted suggestion lines. No fill. At most 60.

const NS = "http://www.w3.org/2000/svg";

export function paintSuggest(doc, svg, lines) {
  if (!svg) return null;
  let group = svg.querySelector?.(".pxd-suggest");
  if (!group) {
    group = doc.createElementNS(NS, "g");
    group.setAttribute("class", "pxd-suggest");
    svg.insertBefore?.(group, svg.firstChild || null);
  }
  group.replaceChildren();
  for (const line of (lines || []).slice(0, 60)) {
    const path = doc.createElementNS(NS, "path");
    path.setAttribute("class", "pxd-suggest__line");
    path.setAttribute("fill", "none");
    path.setAttribute("stroke-dasharray", "4 4");
    path.setAttribute("d", `M ${line.x1} ${line.y1} L ${line.x2} ${line.y2}`);
    if (line.reason) path.setAttribute("data-reason", line.reason);
    if (line.a) path.setAttribute("data-a", line.a);
    if (line.b) path.setAttribute("data-b", line.b);
    if (line.key) path.setAttribute("data-key", line.key);
    group.append(path);
  }
  return group;
}
