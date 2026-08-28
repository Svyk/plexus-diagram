import { DiagramAdapter } from "./adapter.js";
import { DIAGRAM_PULL_PATTERN, DiagramModel } from "./model.js";

export class NativeDiagramSession {
  constructor({ diagramUid, metadataStore, settings, onChange }) {
    this.diagramUid = diagramUid;
    this.metadataStore = metadataStore;
    this.settings = settings;
    this.onChange = onChange;
    this.adapter = new DiagramAdapter(diagramUid, DIAGRAM_PULL_PATTERN);
    this.model = null;
    this.views = new Set();
    this.unwatch = null;
  }

  load() {
    const tree = this.adapter.pull();
    const metadataLayout = this.metadataStore.get(this.diagramUid);
    this.model = new DiagramModel({
      diagramUid: this.diagramUid,
      tree,
      metadataLayout,
      defaults: {
        width: Number(this.settings.get("default-card-width")) || 280,
        height: Number(this.settings.get("default-card-height")) || 160,
      },
    });
    this.adapter.adoptBaseTree(tree);
    return this.model;
  }

  startWatch() {
    if (this.unwatch) return;
    this.unwatch = this.adapter.watchExternal((tree, info) => {
      const metadataLayout = this.metadataStore.get(this.diagramUid);
      this.model.applyPull(tree, metadataLayout, {
        width: Number(this.settings.get("default-card-width")) || 280,
        height: Number(this.settings.get("default-card-height")) || 160,
      });
      this.adapter.adoptBaseTree(tree);
      this.notifyViews(info);
    });
  }

  stopWatch() {
    if (this.unwatch) this.unwatch();
    this.unwatch = null;
  }

  addView(view) {
    this.views.add(view);
  }

  removeView(view) {
    this.views.delete(view);
  }

  notifyViews(info = {}) {
    for (const view of this.views) view.refresh?.(info);
    this.onChange?.(this, info);
  }

  async persistLayout() {
    const layout = this.model.layoutSnapshot();
    await this.metadataStore.set(this.diagramUid, layout);
  }

  async persistViewport() {
    await this.adapter.updateViewport(this.model.viewport);
    const layout = this.metadataStore.get(this.diagramUid) || this.model.layoutSnapshot();
    layout.viewport = { ...this.model.viewport };
    await this.metadataStore.set(this.diagramUid, layout);
  }

  async addCard(string, position) {
    const contentUid = await this.adapter.createChild(string);
    this.model.ensureNode(contentUid, { pos: position });
    const tree = this.adapter.pull();
    this.model.applyPull(tree, this.metadataStore.get(this.diagramUid), {});
    this.adapter.adoptBaseTree(tree);
    await this.persistLayout();
    this.notifyViews({ type: "structural" });
    return contentUid;
  }

  async connectSelected(kind) {
    const selected = [...this.model.selected];
    if (selected.length !== 2) return false;
    this.model.addEdge(selected[0], selected[1], kind);
    await this.persistLayout();
    this.notifyViews({ type: "edge" });
    return true;
  }

  dispose() {
    this.stopWatch();
    for (const view of [...this.views]) view.dispose?.();
    this.views.clear();
  }
}

const sessions = new Map();

export function getOrCreateSession(diagramUid, factory) {
  if (sessions.has(diagramUid)) return sessions.get(diagramUid);
  const session = factory();
  sessions.set(diagramUid, session);
  return session;
}

export function disposeSession(diagramUid) {
  const session = sessions.get(diagramUid);
  if (session) session.dispose();
  sessions.delete(diagramUid);
}

export function getSession(diagramUid) {
  return sessions.get(diagramUid) || null;
}

export function allSessions() {
  return sessions;
}
