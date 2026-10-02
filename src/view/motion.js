// Motion levels for zoom, presentation, animated edges, and pulses.
// none stays off even when the system asks for reduced motion.
// full drops to reduced when the system asks.

export const MOTION_LEVELS = Object.freeze(["full", "reduced", "none"]);

export const MOTION_PROFILE = Object.freeze({
  full: Object.freeze({ zoomMs: 180, presentMs: 160, pulseMs: 1800, edges: true }),
  reduced: Object.freeze({ zoomMs: 70, presentMs: 60, pulseMs: 400, edges: false }),
  none: Object.freeze({ zoomMs: 0, presentMs: 0, pulseMs: 0, edges: false }),
});

export function resolveMotion(value, prefersReduced = false) {
  const level = MOTION_LEVELS.includes(value) ? value : "full";
  if (level === "none") return "none";
  if (level === "reduced" || prefersReduced) return "reduced";
  return "full";
}

export function motionProfile(level) {
  return MOTION_PROFILE[level] || MOTION_PROFILE.full;
}

export function applyMotionClasses(root, level) {
  const resolved = MOTION_LEVELS.includes(level) ? level : "full";
  const profile = motionProfile(resolved);
  root.classList.toggle("pxd-root--motion-off", resolved !== "full");
  root.classList.toggle("pxd-root--motion-reduced", resolved === "reduced");
  root.classList.toggle("pxd-root--motion-none", resolved === "none");
  if (root.dataset) root.dataset.motion = resolved;
  root.style?.setProperty?.("--pxd-zoom-ms", `${profile.zoomMs}ms`);
  root.style?.setProperty?.("--pxd-present-ms", `${profile.presentMs}ms`);
  root.style?.setProperty?.("--pxd-pulse-ms", `${profile.pulseMs}ms`);
  return profile;
}
