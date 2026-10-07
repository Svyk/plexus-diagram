// Figure crops for the parsed view. bbox is in PDF points, top-left origin.

// Source rectangle inside a page rendered at `viewport` size. pageW/pageH are the page size in points.
export function cropRect(bbox, pageW, pageH, viewportW, viewportH) {
  if (!Array.isArray(bbox) || bbox.length < 4) return null;
  const sx = (Number(viewportW) || 0) / (Number(pageW) || 1);
  const sy = (Number(viewportH) || 0) / (Number(pageH) || 1);
  if (!(sx > 0) || !(sy > 0)) return null;
  const left = bbox[0] * sx;
  const top = bbox[1] * sy;
  const width = Math.max(1, Math.ceil((bbox[2] - bbox[0]) * sx));
  const height = Math.max(1, Math.ceil((bbox[3] - bbox[1]) * sy));
  return { sx, sy, left, top, width, height };
}

// Runs at most `limit` async jobs at once, in arrival order.
export function createCropQueue(limit = 2) {
  const waiting = [];
  let active = 0;
  const pump = () => {
    while (active < limit && waiting.length) {
      const job = waiting.shift();
      active += 1;
      Promise.resolve().then(job.run).then(job.resolve, job.reject).finally(() => {
        active -= 1;
        pump();
      });
    }
  };
  return {
    add(run) {
      return new Promise((resolve, reject) => {
        waiting.push({ run, resolve, reject });
        pump();
      });
    },
    get active() { return active; },
    get waiting() { return waiting.length; },
  };
}

export function dataUrlToBlob(url, BlobCtor = globalThis.Blob) {
  const m = /^data:([^;,]+)?(;base64)?,(.*)$/s.exec(String(url || ""));
  if (!m) return null;
  const type = m[1] || "image/png";
  let bytes;
  if (m[2]) {
    const bin = globalThis.atob(m[3]);
    bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i += 1) bytes[i] = bin.charCodeAt(i);
  } else {
    bytes = new TextEncoder().encode(decodeURIComponent(m[3]));
  }
  return new BlobCtor([bytes], { type });
}
