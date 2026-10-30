// Pages that need the helper's OCR: image-only (`kind: "scan"`) and old OCR layers
// (`scanLayer`), unless already read (`ocr`).
export function scanPagesOf(doc) {
  return (doc?.pages || []).filter((p) => !p.ocr && (p.kind === "scan" || p.scanLayer)).map((p) => p.n);
}
