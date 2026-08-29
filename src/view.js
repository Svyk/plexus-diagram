import { createCanvasRoot } from "./canvas.js";
import { diagramUidFromLocation, NATIVE_HIDDEN_CLASS, PENDING_CLASS } from "./discovery.js";

// True only for a zoomed block page (`#/app/<graph>/page/<uid>` or a
// `.rm-zoom-block-wrapper` host), never for an inline daily-page embed.
export function isZoomedDiagramPage(nativeElement, diagramUid, hash) {
  if (nativeElement?.closest?.(".rm-zoom-block-wrapper")) return true;
  const pageUid = diagramUidFromLocation(hash);
  return Boolean(diagramUid && pageUid && pageUid === diagramUid);
}

export function mountDiagramView({ nativeElement, session, settings, version, lifecycle, onAction }) {
  const host = nativeElement.parentElement || nativeElement;
  const defaultHeight = Number(settings.get("default-height")) || 560;
  const nativeRect = nativeElement.getBoundingClientRect();
  const zoomed = nativeElement.closest(".rm-zoom-block-wrapper") || nativeElement.closest(".roam-article");
  const articleRect = zoomed?.getBoundingClientRect();
  const wrapperHeight = zoomed
    ? Math.max((articleRect?.height || window.innerHeight) - 24, defaultHeight)
    : Math.max(nativeRect.height || 0, defaultHeight);

  nativeElement.classList.add(NATIVE_HIDDEN_CLASS);
  nativeElement.classList.remove(PENDING_CLASS);
  const wrapper = document.createElement("div");
  wrapper.className = "pxd-mount";
  if (zoomed) wrapper.classList.add("pxd-mount--zoomed");
  if (session?.diagramUid) wrapper.dataset.diagramUid = String(session.diagramUid);
  wrapper.style.width = "100%";
  wrapper.style.height = `${wrapperHeight}px`;
  wrapper.style.minHeight = `${wrapperHeight}px`;
  wrapper.style.position = "relative";

  const canvas = createCanvasRoot({
    session,
    settings,
    version,
    onPersist: async (action) => {
      if (action.persistLayout) await session.persistLayout();
      if (action.persistViewport) await session.persistViewport();
      if (action.toggleLibrary) onAction?.({ type: "library" });
      if (action.openNested) onAction?.({ type: "nested", uid: action.openNested });
      if (action.openCrumb) onAction?.({ type: "crumb", uid: action.openCrumb });
      if (action.openBlock) onAction?.({ type: "open-block", uid: action.openBlock });
      if (action.addCard) {
        const uid = await session.addCard(action.string ?? "", action.addCard);
        if (uid && action.addEdge?.source) {
          session.model.addEdge(
            action.addEdge.source,
            uid,
            action.addEdge.kind || settings.get("connector-style") || "bezier",
          );
          await session.persistLayout();
        }
        canvas.render();
        if (uid && !action.string) canvas.editCard?.(uid);
      }
      if (action.addSection) {
        await session.addSection(action.addSection);
        canvas.render();
      }
    },
  });

  wrapper.append(canvas.root);
  host.insertBefore(wrapper, nativeElement.nextSibling);

  // A zoomed diagram page *is* the whiteboard: open it full-bleed. Inline embeds
  // stay inline.
  if (settings.get("fullscreen-on-zoom") !== false
    && isZoomedDiagramPage(nativeElement, session?.diagramUid)) {
    canvas.setFullscreen(true);
  }

  const dispose = () => {
    canvas.dispose();
    wrapper.remove();
    nativeElement.classList.remove(NATIVE_HIDDEN_CLASS);
  };
  lifecycle.add(dispose);
  session.addView({ refresh: () => canvas.render(), dispose, canvas, wrapper, setFullscreen: canvas.setFullscreen });

  return { wrapper, canvas, dispose };
}

export function markNativePending(nativeElement) {
  nativeElement.classList.add(PENDING_CLASS);
}
