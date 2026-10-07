# PDF parse bench: built-in engine vs Docling

Measured 2026-10-07 on the fixtures from the parse design (§8), with the pure scorer in
`test/parse-metrics.js`. Same scorer, same truth files, both engines. Re-run with:

```
node tools/parse-score.mjs parse test/fixtures/pdf/report.pdf /tmp/report.pxd.json
node tools/parse-score.mjs score /tmp/report.pxd.json test/fixtures/pdf/report.truth.json test/fixtures/pdf/src/report.html
node tools/parse-score.mjs docling /tmp/wo/pxd9/pdfs/out/report.json /tmp/report.docling.json   # Docling 2.91.0 JSON -> pxd-parse (scoring only)
node tools/parse-score.mjs score /tmp/report.docling.json test/fixtures/pdf/report.truth.json test/fixtures/pdf/src/report.html
```

Scoring rules: a cell matches when `(r, c, rowSpan, colSpan)` and NFKC-normalised text are
equal (attention tables compare with whitespace removed, since math cells differ only in
spacing); structure F1 ignores text. Reading order is Kendall τ over text blocks matched to the
HTML source order by token Jaccard ≥ 0.8. Heading accuracy is the share of truth headings
found with the right level. Docling headings are all level 1 in its JSON (it does not derive
levels), which is the 0.11 below.

## report.pdf (3 pages, born-digital, Chrome print of `test/fixtures/pdf/src/report.html`)

| Metric | Threshold (built-in) | Built-in | Docling 2.91 (accurate tables) |
|---|---|---|---|
| Table 1 ruled, 8 merges: structure F1 | 1.0 | **1.000** | 1.000 |
| Table 1 cell F1 (incl. "Product stage", "Sampling plan" ×4, "Base powder" ×3, "Absent in 10 g" ×2) | ≥ 0.98 | **1.000** | 0.921 ("Product stage" → "Product", "m(CFU/g)") |
| Table 2 borderless numeric 6×7: cell F1 | ≥ 0.95 | **1.000** | 1.000 |
| Table 2 numeric columns right-aligned | 100% | 6/6 | n/a (no alignment in JSON) |
| Appendix booktabs 7×6: cell F1 | ≥ 0.9 | **1.000** | 0.857 ("Z1- 014", "Weekly after wet clean" splits) |
| Headings with level (title 1, "1 Introduction" 2, "2.1 Sampling" 3) | ≥ 0.9 | **9/9 = 1.000** | 1/9 = 0.111 |
| Running header + "Page N of 3 — Internal use" removed, listed in `removed[]` | all pages | 6/6, 0 leaked | 6/6, 0 leaked |
| Reading order τ (two columns, wide tables/figure between) | ≥ 0.95 | **1.000** (31/32 blocks matched) | 1.000 (30/32) |
| Lists | bullet + numbered | 1 bullet (3 items, vector dots), 1 numbered (3 items) | 2 lists |
| Footnote ³ linked to its note | linked | 1/1 | note found, no ref link in JSON |
| Figure 1 (vector bars) with caption, axis labels not paragraphs | yes | yes (14 primitives, Jan–Dec absorbed) | yes |
| Equation line as `formula`, `latex: null` | yes | yes | yes, with LaTeX |
| Time per page (pure engine, node, M1 Max) | ≤ 150 ms text, ≤ 300 ms ruled | 9.5 / 2.1 / 3.5 ms (page 1 is the ruled one); +72 / 11 / 5 ms pdf.js text+ops | 88 s total (first run, model load) |

## report-scan.pdf (same pages rasterised at 150 dpi, image only)

| Metric | Built-in | Docling (ocrmac) |
|---|---|---|
| Page kinds | scan, scan, scan; 3 `scan` blocks, 0 text blocks | text via OCR |
| Table 1 / 2 / Appendix cell F1 | n/a (needs OCR → Docling) | 0.944 / 0.911 / 0.843 |
| Time | 1.0 / 0.1 / 0.1 ms pure (+72 / 48 / 43 ms pdf.js) | 40 s |

## attention.pdf (arXiv 1706.03762v7, 15 pages, booktabs; local only, not committed)

Expected cells for Tables 1–3 were hand-checked from the paper
(`/tmp/wo/pxd9/attention.expected.json`, 20 + 55 + 253 cells including empty cells; multirow
labels (A)–(D) as rowSpans, "(E)" text as an 8-column span, "Model" rowSpan 2, "BLEU" and
"Training Cost" colSpan 2, the two `3.3 · 10¹⁸` / `2.3 · 10¹⁹` cells colSpan 2).

| Table | Threshold (built-in) | Built-in (stream, rules as row bands) | Docling (TableFormer) |
|---|---|---|---|
| Table 1 (5×4, two-line header cell "Sequential Operations") | ≥ 0.85 | **1.000** | 1.000 |
| Table 2 (12×5, two header rows with spans, 10^n exponents) | ≥ 0.85 | **1.000** | 0.913 |
| Table 3 (21×13, sparse, multirow labels, 8-col span) | ≥ 0.85 | **0.994** (one span off by a column) | 0.603 |
| Pure time per page (median) | ≤ 150 ms | 2.0 ms (max 7.6 ms; pdf.js 4–88 ms) | 180 s total with formula enrichment |

Also found on attention.pdf without a truth file: 6 figures with captions, 3 footnotes linked by
mark (†, 4, 5), 2 display formulas, Table 4 (13×3) matching Docling's shape. Known misses: the
author/affiliation grid on page 1 is detected as two small tables; the "Provided proper
attribution…" notice is read as a heading (12 pt bold).

## What the numbers mean

- On born-digital pages the built-in engine meets every design threshold and beats Docling on
  merged-cell text, wrapped cells, heading levels and footnote linking, because it reads the
  PDF's own glyphs, sizes and baselines. Docling's advantages remain OCR (scans) and LaTeX for
  formulas; the design's refine pass on the helper closes its text gaps.
- Speed: the pure pass is 1–10 ms per page; pdf.js `getTextContent` + `getOperatorList`
  dominate (5–90 ms). Both are far under the 150 / 300 ms budgets. `extractGraphics` caps at
  5000 segments per page and flags `truncated`.
- Not measured here: rotated pages, right-to-left text, multi-page tables, scanned PDFs with
  a text layer (would parse as `mixed`).
