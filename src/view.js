import { createCanvasRoot } from "./canvas.js";
import { NATIVE_HIDDEN_CLASS, PENDING_CLASS } from "./discovery.js";

export function mountDiagramView({ nativeElement, session, settings, version, lifecycle, onAction }) {
  const host = nativeElement.parentElement || nativeElement;
  nativeElement.classList.add(NATIVE_HIDDEN_CLASS);
  nativeElement.classList.remove(PENDING_CLASS);

  const height = Number(settings.get("default-height")) || 420;
  const wrapper = document.createElement("div");
  wrapper.className = "pxd-mount";
  wrapper.style.minHeight = `${height}px`;
  wrapper.style.position = "relative";

  const canvas = createCanvasRoot({
    session,
    settings,
    version,
    onPersist: async (action) => {
      if (action.persistLayout) await session.persistLayout();
      if (action.persistViewport) await session.persistViewport();
      if (action.openLibrary) onAction?.({ type: "library" });
      if (action.openNested) onAction?.({ type: "nested", uid: action.openNested });
      if (action.addCard) {
        await session.addCard("", action.addCard);
        canvas.render();
      }
      if (action.addSection) {
        await session.addSection(action.addSection);
        canvas.render();
      }
    },
  });

  wrapper.append(canvas.root);
  host.insertBefore(wrapper, nativeElement.nextSibling);

  const dispose = () => {
    canvas.dispose();
    wrapper.remove();
    nativeElement.classList.remove(NATIVE_HIDDEN_CLASS);
  };
  lifecycle.add(dispose);
  session.addView({ refresh: () => canvas.render(), dispose });

  return { wrapper, canvas, dispose };
}

export function markNativePending(nativeElement) {
  nativeElement.classList.add(PENDING_CLASS);
}
