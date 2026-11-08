// Roam Depot flavour: the extension is one plain bundle, so there are no pieces to load and nothing
// is evaluated at run time. These stubs keep the names src/feature.js and src/extension.js import.
export const pieceLog = () => [];
export function pieceLoadAll() {
  return [];
}
export function pieceTable() {}
export const pieceRan = () => false;
export function pieceLoad() {
  return undefined;
}
export function pieceDefer(make) {
  return make();
}
export function removePieceStyles() {}
