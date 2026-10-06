import { guardCallback } from "./guard.js";

function isPromiseLike(value) {
  return value != null && typeof value.then === "function";
}

async function callSafely(disposer) {
  const result = disposer();
  if (isPromiseLike(result)) await result;
}

export function createLifecycle() {
  let disposed = false;
  const disposers = [];

  const add = (disposer) => {
    if (typeof disposer !== "function") throw new TypeError("A disposer must be a function");
    if (disposed) {
      void callSafely(disposer).catch((error) => console.error("[plexus-diagram] Late cleanup failed", error));
      return disposer;
    }
    disposers.push(disposer);
    return disposer;
  };

  return {
    get disposed() {
      return disposed;
    },

    add,

    async command(commandApi, config) {
      if (!commandApi?.addCommand || !commandApi?.removeCommand) {
        throw new TypeError("A command API with addCommand/removeCommand is required");
      }
      await commandApi.addCommand(config);
      add(() => commandApi.removeCommand({ label: config.label }));
    },

    event(target, type, listener, options) {
      target.addEventListener(type, listener, options);
      add(() => target.removeEventListener(type, listener, options));
      return listener;
    },

    interval(callback, delay, ...args) {
      const guarded = guardCallback("interval", callback);
      const id = globalThis.setInterval(guarded, delay, ...args);
      add(() => globalThis.clearInterval(id));
      return id;
    },

    timeout(callback, delay, ...args) {
      const id = globalThis.setTimeout(callback, delay, ...args);
      add(() => globalThis.clearTimeout(id));
      return id;
    },

    observer(observer, target, options) {
      if (observer && typeof observer.callback === "function") observer.callback = guardCallback("observer", observer.callback);
      else if (observer && typeof observer.cb === "function") observer.cb = guardCallback("observer", observer.cb);
      observer.observe(target, options);
      add(() => observer.disconnect());
      return observer;
    },

    node(node, parent = globalThis.document?.body) {
      if (!parent) throw new Error("A parent node is required outside the browser");
      parent.append(node);
      add(() => node.remove());
      return node;
    },

    pullWatch(dataApi, pattern, entity, callback) {
      if (!dataApi?.addPullWatch || !dataApi?.removePullWatch) {
        throw new TypeError("A Roam data API with addPullWatch/removePullWatch is required");
      }
      const guarded = guardCallback("pullWatch", callback);
      dataApi.addPullWatch(pattern, entity, guarded);
      add(() => dataApi.removePullWatch(pattern, entity, guarded));
      return guarded;
    },

    async settingsPanel(extensionAPI, config) {
      // Roam owns extension-scoped panels and removes them automatically on unload.
      // Keeping creation here makes all setup flow through the same lifecycle object.
      await extensionAPI.settings.panel.create(config);
    },

    async dispose() {
      if (disposed) return;
      disposed = true;
      const errors = [];
      for (const disposer of disposers.splice(0).reverse()) {
        try {
          await callSafely(disposer);
        } catch (error) {
          errors.push(error);
        }
      }
      if (errors.length) throw new AggregateError(errors, "One or more extension cleanups failed");
    },
  };
}

