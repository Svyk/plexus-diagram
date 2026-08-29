import { DiagramAdapter, MutationQueue } from "./adapter.js";
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
    // Metadata writes rewrite the whole diagram block; two in flight at once would
    // duplicate node/edge lines. Every persist goes through this queue.
    this.persistQueue = new MutationQueue();
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
    return this.persistQueue.run(async () => {
      const layout = this.model.layoutSnapshot();
      await this.metadataStore.set(this.diagramUid, layout);
    });
  }

  async persistViewport() {
    return this.persistQueue.run(async () => {
      await this.metadataStore.setViewport(this.diagramUid, { ...this.model.viewport });
    });
  }

  async seedNativeViewport() {
    return this.persistQueue.run(async () => {
      await this.adapter.updateViewport({ ...this.model.viewport });
    });
  }

  async addCard(string, position) {
    const contentUid = await this.adapter.createChild(string);
    this.model.ensureNode(contentUid, {
      pos: position,
      width: Number(this.settings.get("default-card-width")) || 280,
      height: Number(this.settings.get("default-card-height")) || 160,
    });
    const tree = this.adapter.pull();
    this.model.applyPull(tree, this.metadataStore.get(this.diagramUid), {});
    this.adapter.adoptBaseTree(tree);
    await this.persistLayout();
    this.notifyViews({ type: "structural" });
    return contentUid;
  }

  async addSection(position) {
    const id = `s${Date.now().toString(36)}`;
    this.model.sections.set(id, {
      pos: { ...position },
      size: { width: 320, height: 240 },
      title: "",
    });
    await this.persistLayout();
    this.notifyViews({ type: "section" });
    return id;
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

// Roam navigation detaches overlay DOM without telling us. A view whose canvas/wrapper
// is no longer connected is dead: dispose it and drop it so the session accepts a fresh
// view instead of leaking wrappers registered with the lifecycle.
export function pruneDetachedViews(session) {
  for (const view of [...session.views]) {
    const root = view.wrapper || view.canvas?.root || null;
    if (root && root.isConnected === false) {
      try {
        view.dispose?.();
      } catch (error) {
        console.warn("[plexus-diagram] Detached view cleanup failed", error);
      }
      session.removeView(view);
    }
  }
}

const sessions = new Map();

export function getOrCreateSession(diagramUid, factory) {
  const existing = sessions.get(diagramUid);
  if (existing) {
    pruneDetachedViews(existing);
    return existing;
  }
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
