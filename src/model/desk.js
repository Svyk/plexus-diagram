// Roam's Desk: one embed block per entry, first child of the user's Desk page. Pure, no Roam.

// Mirrors openItemInSidebar in board-view.js.
export function deskTargetOf(item) {
  if (!item) return null;
  if (item.target?.kind === "page") return item.target.title ? { kind: "page", title: item.target.title } : null;
  const uid = item.target?.uid || item.uid;
  return uid ? { kind: "block", uid } : null;
}

export function deskEntryString(target) {
  if (!target) return "";
  return target.kind === "page" ? `{{embed: [[${target.title}]]}}` : `{{embed-path: ((${target.uid})) closed}}`;
}

// {{embed: X}} or {{embed-path: X ...}} (the macro name may be wrapped as [[embed]]) with X exactly ((uid)) or [[title]].
export function deskEntryKey(string) {
  const m = /^\{\{(?:\[\[)?(embed|embed-path)(?:\]\])?:\s*(\(\([^()\s]+\)\)|\[\[.+?\]\])(\s[^}]*)?\}\}$/.exec(String(string ?? "").trim());
  if (!m || (m[3] && m[1] === "embed")) return null;
  const x = m[2];
  return x.startsWith("((") ? { kind: "block", uid: x.slice(2, -2) } : { kind: "page", title: x.slice(2, -2) };
}

export function sameDeskEntry(a, b) {
  if (!a || !b || a.kind !== b.kind) return false;
  return a.kind === "page" ? a.title === b.title : a.uid === b.uid;
}
