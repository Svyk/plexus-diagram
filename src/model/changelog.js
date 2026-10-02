// The running version's section from the bundled changelog. No network.

export function changelogEntry(markdown, version) {
  const text = String(markdown || "").replace(/^\uFEFF/, "");
  const ver = String(version || "").trim().replace(/^v/, "");
  if (!ver) return "";
  const lines = text.split(/\r?\n/);
  const start = lines.findIndex((line) => line.startsWith(`## ${ver} `) || line.startsWith(`## ${ver}\n`) || line === `## ${ver}`);
  if (start < 0) return "";
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i += 1) {
    if (/^## [^#]/.test(lines[i])) { end = i; break; }
  }
  return lines.slice(start, end).join("\n").trim();
}
