import { childrenFingerprint, parsePullResult, treeFingerprint } from "./model.js";

function roam() {
  return globalThis.roamAlphaAPI;
}

export class MutationQueue {
  constructor() {
    this.tail = Promise.resolve();
  }

  run(task) {
    const next = this.tail.then(task, task);
    this.tail = next.catch(() => {});
    return next;
  }
}

export function getTree(uid) {
  const api = roam();
  if (api?.pullPageTree) return normalizeTree(api.pullPageTree({ page: { uid } }));
  if (api?.data?.pull) {
    return normalizeTree(api.data.pull(
      "[:block/uid :block/string :block/order :block/props {:block/children ...}]",
      [":block/uid", uid],
    ));
  }
  return null;
}

function normalizeTree(node) {
  if (!node) return null;
  const children = (node.children || node[":block/children"] || [])
    .map(normalizeTree)
    .filter(Boolean)
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  return {
    uid: node.uid ?? node[":block/uid"],
    string: node.string ?? node[":block/string"] ?? "",
    order: node.order ?? node[":block/order"] ?? 0,
    props: node.props ?? node[":block/props"] ?? {},
    children,
  };
}

export class DiagramAdapter {
  constructor(diagramUid, pullPattern) {
    this.diagramUid = diagramUid;
    this.pullPattern = pullPattern;
    this.queue = new MutationQueue();
    this.baseTree = null;
    this.childrenFingerprint = null;
    this.expectedStructuralFingerprint = null;
    this.watchHandler = null;
  }

  pull() {
    const api = roam();
    const raw = api.data.pull(this.pullPattern, [":block/uid", this.diagramUid]);
    return parsePullResult(raw);
  }

  adoptBaseTree(tree) {
    this.baseTree = tree;
    this.childrenFingerprint = childrenFingerprint(tree.children);
  }

  recordExpectedFingerprint(tree) {
    this.expectedStructuralFingerprint = childrenFingerprint(tree.children);
  }

  consumeExpectedFingerprint(tree) {
    const fp = childrenFingerprint(tree.children);
    if (this.expectedStructuralFingerprint && fp === this.expectedStructuralFingerprint) {
      this.expectedStructuralFingerprint = null;
      return true;
    }
    return false;
  }

  watchExternal(callback) {
    const entity = `[:block/uid "${this.diagramUid}"]`;
    const handler = (before, after) => {
      const next = parsePullResult(after);
      const prev = parsePullResult(before);
      if (!next) return;
      const structural = !prev || childrenFingerprint(prev.children) !== childrenFingerprint(next.children);
      if (structural && this.consumeExpectedFingerprint(next)) return;
      callback(next, { structural });
    };
    roam().data.addPullWatch(this.pullPattern, entity, handler);
    this.watchHandler = handler;
    return () => roam().data.removePullWatch(this.pullPattern, entity, handler);
  }

  async createChild(string, order = "last") {
    return this.queue.run(async () => {
      const api = roam();
      const current = this.pull();
      const beforeFp = childrenFingerprint(current.children);
      const uid = api.util.generateUID();
      await api.data.block.create({
        location: { "parent-uid": this.diagramUid, order },
        block: { uid, string },
      });
      const after = this.pull();
      this.recordExpectedFingerprint(after);
      this.adoptBaseTree(after);
      if (childrenFingerprint(after.children) === beforeFp) {
        throw new Error("Child create did not change diagram children");
      }
      return uid;
    });
  }

  async updateViewport(viewport) {
    return this.queue.run(async () => {
      const api = roam();
      const props = { ":rf-diagram": { viewport } };
      if (typeof api.updateBlock === "function") {
        await api.updateBlock({ block: { uid: this.diagramUid, props } });
        return;
      }
      await api.data.block.update({
        block: { uid: this.diagramUid, props },
      });
    });
  }

  async deleteChild(contentUid) {
    return this.queue.run(async () => {
      const current = this.pull();
      const beforeFp = childrenFingerprint(current.children);
      await roam().data.block.delete({ block: { uid: contentUid } });
      const after = this.pull();
      this.recordExpectedFingerprint(after);
      this.adoptBaseTree(after);
      if (childrenFingerprint(after.children) === beforeFp) {
        throw new Error("Child delete did not change diagram children");
      }
    });
  }

  verifyChildrenBeforeWrite() {
    const current = this.pull();
    const fp = childrenFingerprint(current.children);
    if (this.childrenFingerprint && fp !== this.childrenFingerprint) {
      return { ok: false, tree: current };
    }
    return { ok: true, tree: current };
  }
}

export { treeFingerprint, childrenFingerprint };
