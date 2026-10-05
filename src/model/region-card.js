// ECO-3. region-ref is in memory only. supported false is a valid Roam Plexus region.

import { parseRegion } from "./regions.js";

function accepted(targetString, api) {
  if (api == null || typeof api.apiVersion !== "number" || api.apiVersion < 6) return null;
  const region = parseRegion(targetString);
  if (!region || region.owner !== "roam-plexus" || region.error != null) return null;
  return region;
}

export function regionRefKind(targetString, api) {
  return accepted(targetString, api) ? "region-ref" : null;
}

export function regionRefModel(targetString, api) {
  const region = accepted(targetString, api);
  if (!region) return null;
  return {
    kind: "region-ref",
    caption: region.caption,
    drawingUid: region.drawingUid,
    regionKind: region.kind,
  };
}
