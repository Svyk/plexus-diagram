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

## ICDAR 2013 Table Competition (round 2, 2026-10-07)

Born-digital EU and US government PDFs, 67 files, 156 table regions on 238 pages, with the
competition ground truth (`<name>-reg.xml` regions, `<name>-str.xml` cells). The dataset lives
outside the repo; run `node tools/parse-bench/icdar2013.mjs <dataset-dir> --docling <dir>`.
Docling 2.91 (accurate tables, no OCR) ran once over all 67 files and its JSON is scored
through the same `doclingToPxd` converter and the same metrics.

**EU is the development split; US is held out.** Every engine change in round 2 was tuned on
the EU files plus three unseen papers (below). The US numbers were read once, at the end, and
nothing was changed after reading them.

Metrics. Detection: predicted tables matched to GT regions per page by bbox IoU ≥ 0.5.
Structure: the ICDAR 2013 adjacency-relation metric (Göbel et al.): for every non-empty GT cell
the nearest non-empty neighbour to the right and below, as (content, neighbour, direction)
relations, matched as multisets and micro-averaged over all GT tables; a GT table with no
predicted table scores zero recall. Content is NFKC-normalised with all whitespace removed,
because the GT itself writes "domestic(%)" for "domestic (%)". Predicted tables chained by
`continues` count as one table. "Adj F1 (e2e)" also counts relations of unmatched predicted
tables as false positives. Cell F1 is the stricter exact match on (r, c, rowSpan, colSpan,
text). Speed is the built-in engine end to end (pdf.js text + ops + pure pass) in node.

| Split | Engine | Docs | GT regions | Det P | Det R | Det F1 | Adj P | Adj R | Adj F1 | Adj F1 (e2e) | Cell F1 | ms/page (median) | total s |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| EU (dev) | Built-in | 27 | 76 | 0.987 | 1.000 | **0.993** | 0.999 | 0.994 | **0.997** | 0.996 | 0.940 | 9.8 | 1.2 |
| EU (dev) | Docling 2.91 | 27 | 76 | 1.000 | 1.000 | 1.000 | 0.989 | 0.985 | 0.987 | 0.987 | 0.975 | n/a | n/a |
| US (held out) | Built-in | 40 | 80 | 0.962 | 0.938 | **0.949** | 0.904 | 0.813 | **0.856** | 0.856 | 0.636 | 9.4 | 1.3 |
| US (held out) | Docling 2.91 | 40 | 80 | 0.975 | 0.975 | 0.975 | 0.845 | 0.803 | 0.824 | 0.812 | 0.729 | n/a | n/a |
| All | Built-in | 67 | 156 | 0.974 | 0.968 | 0.971 | 0.929 | 0.858 | 0.892 | 0.892 | 0.718 | 9.6 | 2.5 |
| All | Docling 2.91 | 67 | 156 | 0.987 | 0.987 | 0.987 | 0.882 | 0.849 | 0.865 | 0.856 | 0.795 | n/a | n/a |

Round 1 on the same harness, before any change: EU detection F1 0.427, adjacency F1 0.477;
US detection F1 0.532, adjacency F1 0.799 (with whitespace-collapsed content).

Targets on the held-out US split were detection F1 ≥ 0.90 (met: 0.949) and adjacency F1
≥ 0.90 (not met: 0.856, above Docling's 0.824). Docling is not timed per file here; the
fixture runs above put it at 40–180 s per file against 1–3 s for the built-in engine.

### US failure classes (observed after the run, not tuned)

- Under-segmented columns in dense numeric tables (us-037 16×13 → 15×6, us-002 32×8 → 33×3,
  us-001 26×11 → 26×8, us-033 15×10 → 14×6). `projectColumns` takes column intervals from the
  fullest rows and merges intervals that touch; group headers ("Weight Relative to Controls")
  and sparse rows bridge neighbouring numeric columns. A per-column alignment profile over the
  body rows would separate them.
- Ruled tables whose rows are not ruled and whose cells are prose (us-032 7×3 → 3×3): the
  text-row splitter needs a numeric column, so description rows stay merged.
- Tables absorbed into figures (us-010, us-013, us-022): shaded cells and many short rules
  cluster as a drawing before the stream pass sees the words; the GT region sits inside the
  predicted figure.
- Wide sparse tables with year headers read as paragraphs (us-023 9×12): label rows carry one
  token, so the run never starts.
- Ruled exhibit frames that enclose the title and the notes (us-014: 8×3 for a 6×3 GT): the
  frame's rows above and below the data are counted as table rows.

### Unseen PDFs: before and after round 2

The orchestrator ran round 1 on three papers it had never seen; `/tmp/wo/pxd9/unseen/*.pxd.json`
holds the round-1 output and `*.r2.json` the round-2 output.

| File | Round 1 | Round 2 |
|---|---|---|
| risk.pdf p5 Table 2 (7×7 booktabs) | two tables 4×7 + 3×7, row Attr3 lost, last cell of Attr6 lost | one 7×7 table, every row and cell present |
| risk.pdf eqs (9), (14), (15) (bracketed matrices) | tables with rows like "D ¼ 6" | `formula` blocks with `number` "(14)", "(15)", "ð9Þ" (Elsevier math font text kept as extracted) |
| risk.pdf headings | 3 (title, journal, author marks) | 21 numbered headings "1. Introduction" … "5. Discussion and conclusion", depth from numbering (2.1 → level 5 under the two size classes) plus the unnumbered back-matter headings |
| llama.pdf p3 Table 2 | 13×4, four numeric columns in one cell, bbox swallowed the caption, body text and Figure 1's axis numbers | 5×7 with "n heads", "learning rate" as header cells, bbox ends above the caption |
| llama.pdf p19–27 framed prompt and code boxes | 1×1 / 3×1 lattice tables | prose boxes flow as paragraphs; numbered monospace listings are `code` blocks (5 on pages 19–22) |
| goal.pdf Table 1 over pages 9–12 ("Table 1. Continued.") | four unrelated tables | four tables, each carrying `continues: <previous id>`; headings "Introduction", "Methods", "Search strategy" found (AdvOT ".B"/".BI" font suffixes read as bold / bold italic) |

### What changed in the engine (all general rules, no per-file thresholds)

- Lattice connectivity: rules connect only where they cross or touch (a double rule within
  4 pt is one boundary); parallel horizontals never join. Stacked tables of the same width and
  tables beside chart axes are separate components.
- Booktabs bands: free horizontal rules join into a band only when the text between them reads
  as table rows (`tabularBetween`: no full-width prose line, no caption line, gap-separated
  tokens; a lone short label row or wrapped-cell fragments are allowed). A hollow grid with an
  inner vertical is a band on its own.
- Lattice cells: a region spanning columns without a rule splits when its text falls into
  gap-separated tokens in distinct sub-columns; a grid row holding three or more aligned text
  rows with a numeric column splits at the baselines. Grids with text in under 30 % of cells
  (chart axes) and 1×n or n×1 grids (frames) are not tables.
- Gates on every table candidate: equation runs (equation number at the column edge plus a
  "D =" lead, oversized delimiters or math glyphs) become `formula`; numbered monospace rows
  (pdf.js `fontFamily: "monospace"` or a typewriter font name) become `code`; a framed box of
  prose is paragraphs; a heading over one spanning line is a titled box; bands over chart bars
  (several non-light filled boxes narrower than the band) are skipped.
- Stream runs stop at prose rows (long full-width lines with no short or numeric token) and
  captions; two runs in one column with matching columns and nothing between them stitch;
  a table at the top of a page continues the previous page's table when the caption says
  "Continued" or both sit at the page edges with the same column count (`continues`).
- Headings: numbered lines at body size ("3.2. The …") in bold or italic, or standing alone
  above their paragraph, are headings with the numbering depth; bold body-size headings are
  ranked by size then style (bold above bold italic).

Contracts added for other units: table blocks may carry `continues: "<table id>"`; `code`
blocks (`k…`) carry `text` with `\n` between lines; `formula.number` may be an Elsevier-font
"ðNÞ". `detectStreamRuns` now returns typed items (`type: "table" | "formula" | "code"`).
Everything else in `pxd-parse/1` is unchanged.

## ICDAR 2013 (round 3, 2026-10-07)

Round 3 tuned on both splits (the WO allowed it) and kept a new held-out set honest instead:
EU Regulation 2073/2005 (Annex I), two arXiv papers on table structure, and two scanned CDC
pages with an OCR text layer. Same harness, same metrics, same Docling JSON as round 2.

| Split | Engine | Docs | GT regions | Det P | Det R | Det F1 | Adj P | Adj R | Adj F1 | Adj F1 (e2e) | Cell F1 | ms/page (median) | total s |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| EU | Built-in r3 | 27 | 76 | 0.987 | 1.000 | 0.993 | 0.999 | 0.993 | **0.996** | 0.995 | **0.942** | 10.1 | 1.2 |
| EU | Built-in r2 | 27 | 76 | 0.987 | 1.000 | 0.993 | 0.999 | 0.994 | 0.997 | 0.996 | 0.940 | 9.8 | 1.2 |
| EU | Docling 2.91 | 27 | 76 | 1.000 | 1.000 | 1.000 | 0.989 | 0.985 | 0.987 | 0.987 | 0.975 | n/a | n/a |
| US | Built-in r3 | 40 | 80 | 0.988 | 0.988 | **0.988** | 0.979 | 0.968 | **0.974** | 0.973 | **0.928** | 9.1 | 1.3 |
| US | Built-in r2 | 40 | 80 | 0.962 | 0.938 | 0.949 | 0.904 | 0.813 | 0.856 | 0.856 | 0.636 | 9.4 | 1.3 |
| US | Docling 2.91 | 40 | 80 | 0.975 | 0.975 | 0.975 | 0.845 | 0.803 | 0.824 | 0.812 | 0.729 | n/a | n/a |
| All | Built-in r3 | 67 | 156 | 0.987 | 0.994 | 0.990 | 0.984 | 0.975 | 0.979 | 0.979 | 0.932 | 9.1 | 2.4 |
| All | Docling 2.91 | 67 | 156 | 0.987 | 0.987 | 0.987 | 0.882 | 0.849 | 0.865 | 0.856 | 0.795 | n/a | n/a |

Every round-2 US failure class is closed: us-037 16×13 (was 15×6), us-002 32×8, us-001
26×11, us-033 15×10, us-032 7×3, us-010 / us-013 / us-022 found (were figures or absent),
us-023 9×12 (was paragraphs), us-014 6×3 (was 8×3), us-034 two 19×8 tables, us-007 header
in one row, us-024 header spans and wrapped labels. Cell F1 is now where the engine beats
Docling most (0.928 vs 0.729 on US). Files still under 0.9 on cells: us-001 (0.75: a
dense table whose header row the GT splits differently), us-040 (0.21: the GT has an empty
spacer row the page does not rule), us-003 / us-004 (0.89 / 0.92).

### What changed in the engine (general rules, no per-file thresholds)

- Columns: after the coarse projection, every coarse column is scanned for whitespace shared
  by at least 80 % of its rows (`refineColumns`); a gap counts when the text beside it is
  aligned (tight left or right edges) or numeric on both sides, not a space thousands
  separator ("15 455") and not a repeated unit ("40 years"). Tokens that part exactly at such
  a gap split (`splitTokensAt`); ink across it stays one spanning cell. Dot leaders stay
  with their label and leave the cell text.
- Lattice: filled boxes that tile a rectangle (coloured headers, zebra stripes, per-cell
  fills) supply the grid as rules (`boxGridRules`), white boxes and nested insets excluded;
  rules connect across a 4 pt cell-spacing gap; a frame's title row (caption-like, full width)
  and trailing notes rows (`Note:`, `Source:`, `Exhibit reads:`, long prose) are stripped and
  handed back to the text pass; unruled prose rows inside a ruled row split at a blank line
  when the new row starts with a label in column 0; a ruled row with stacked header words
  stays one row (numeric sub-rows need two baselines with numbers in two columns); the header
  fill is the fill that covers only the leading rows (zebra striping is not a header).
- Bands: between two full rules the text is one row unless it holds data sub-rows; later
  bands with partial rules and no values are header bands too; header baselines without
  rules group by font size and by a token spanning two tokens below; a label-only line
  flush under a data row, followed by a row that is not indented under it, is the label's
  second line.
- Stream runs: a text rule ("------") is a header boundary, not a row; a single-token line
  attaches to the cell above as a wrapped line (lower-case, bracketed, indented, or a short
  capitalised line between two data rows), leads the next row when its values sit on the
  next baseline, joins as a group label at the left edge, or opens a run as a centred group
  header (stacked headers look one line further); a centred header after body rows starts
  the next table and two stacked tables with their own headers are never stitched; run gaps
  are measured from the last consumed line.
- Header spans: a partial rule under a header cell fixes its span; header cells widen
  symmetrically over empty neighbours (with slack when the text is wider than its columns)
  and fall back to the narrowest centred span; a header cell with nothing above it starts at
  the top of the header band; a lower-case or bracketed header line below a single-column
  header cell is its wrapped second line.
- Gates: a sparse stream table beside a drawing is the drawing's labels (pie chart legends);
  three rows of ticks with mostly empty cells on a scan page are an axis; a bare line number
  without code keeps a listing a `code` block; a row of four-digit years over decimals is a
  header row; a pure-number line in the page margin is a page number only when nothing
  shares its baseline (years in a table header at the page top are not).

### Scans with an OCR text layer

A page-sized image under text is a scan with an OCR layer (`pages[].scanLayer`): the image
is the background, not a figure, and the text parses as on any page. Letter-spaced OCR items
("N O T I F I A B L E") join into one word (word breaks inside such an item are not
recoverable from pdf.js items). Text set sideways (every item's matrix rotated by a multiple
of 90°) is read in its own frame; `pages[].textRotation` reports the angle and every bbox
on that page is in the rotated frame.

| File | Result |
|---|---|
| `cdc1980-p25.pdf` (1980 CDC summary p25, landscape scan with OCR layer) | one 50×11 stream table, header row `Disease, 1980 … 1971`, 49 disease rows (page kind `mixed`, scanLayer true, no figure). The OCR layer carries 51 label baselines; wrong cells, all from the layer itself: `Shigellosis Smallpox` (Smallpox's note "Last documented case occurred in 1949" is not in the layer, so the bare label attached to the row above), a footnote mark `•` placed as a cell beside `Hepatitis, unspecified`, `Brucellosis` 1973 = `. 0.10`, `Chickenpox` 1971 = `*`, `Yellow fever` note read as `Last inHinennus r.as` over three columns, `(Carriers)` cells after 1978 = `NA . .`. Every numeric cell checked by eye against the render is right. Title heading `NOTIFIABLE DISEASES—Summaryofreportedcasesper 100,000population…` (letter-spaced OCR, word breaks lost). |
| `cdc1980-p25-imageonly.pdf` | page kind `scan`, one `scan` block (needs OCR on the helper) |
| `cdc1970-p3.pdf` (MMWR 1970 p3) | the page holds Figure 2 (diphtheria cases by week) and prose, no table; 0 tables (round 2 read the figure's axis ticks as a 3×8 table) |
| original `cdc-morbidity-summary-1980.pdf` p25 | the PDF already stores the page as 597×405 landscape with upright OCR text; the rotation code was exercised by the EU regulation below and by a synthetic test |

### New held-out set (not tuned on; read once at the end, by eye against the render)

| File | What the engine produces |
|---|---|
| `eu-reg-2073-2005.pdf` p9 (Chapter 1 food safety criteria) | text matrices rotated 90°, read upright (`textRotation -90`); one 19×8 stream table: `Food category (span 2) \| Micro-organisms \| Sampling plan n, c \| Limits \| Analytical reference method \| Stage`, two header rows. Right by eye: column set, the n/c sub-header, every criterion's first line. Wrong: the food-category number ("1.1.") is its own column; the m/M limit columns are one column; wrapped criteria still leave 8 extra fragment rows (the page has 8 criteria plus the header). The ruled grid did not form because the vertical rules are segmented per row group; the band path builds it. |
| `eu-reg-2073-2005.pdf` p15 (process hygiene) | 32×7 stream, two header rows; `3,5 log / 5,0 log` m/M pairs stay in one cell (narrow gap, wrapped units), carcass entries split into several rows. |
| `arxiv-tables-structure.pdf` p6 (Tables 2, 3) | 16×6 and 13×6, N row-spans right, every number right except `0.38.0` for `38.0` (a stray glyph in the PDF text). |
| `arxiv-tables-structure.pdf` p7 (Table 5) | 12×5: TaBERT and TABBIE (FREQ) lines merge into one row per corruption (small-caps rows whose boxes overlap); TABBIE (MIX) rows right. |
| `arxiv-tables-structure.pdf` p8 (Figures 5, 6) | the figure's small example tables come out as 7×3, 7×6 and one 41×25 lattice of the nearest-neighbour boxes; a figure, not a table. |
| `arxiv-tabdata-2025.pdf` p7 (Table 1) | 12×11, body right; group headers UNIQUE / COUNT / DIAMOND found, COUNT(=) and DOUBLE missed, the `Transactions synthetic data` section row sits in the middle columns instead of spanning. |
| `arxiv-tabdata-2025.pdf` p24 (Tables 7, 8) | 11×5 right; 11×6 right except small-caps headers read as `T ASK`, `M ETRIC` (the first letter is a separate pdf.js item). |
| `arxiv-tabdata-2025.pdf` p27 (Table 10) | 11×9: `Orig Clean` of the second group merged into one column (a late change moved it from 12×10); body values right. |

Unseen PDFs from round 2 (`risk`, `llama`, `goal`): risk p5 Table 1 7×5 and Table 2 7×7,
llama p3 Table 2 5×7 and Table 7 11×4 unchanged; llama Table 8 is 10×6 (was 10×5, the
pass@ columns were merged); goal Table 1 pages 9–12 are 28/25/29/26 rows (were 33/34/33/29:
wrapped cells such as "Within-subjects design, one session" are one row now, checked against
the render), still chained by `continues`.

Contracts added: `pages[].textRotation` (0, 90, -90, 180) and `pages[].scanLayer`
(boolean); table geometry on a rotated page is in the rotated frame. `detectStreamRuns`
takes `rules` (the page's raw rules, for header underlines). New exports used by tests:
`refineColumns`, `splitTokensAt`, `headerRowGroups` (stream), `boxGridRules`, `LEADER_RE`
(lattice), `letterSpaced`, `dominantRotation` (lines), `figureLabels` (index). Everything
else in `pxd-parse/1` is unchanged.

## Scanned tables (round 4, 2026-10-07): OCR word geometry + the built-in engine

The helper's `/v1/ocr` renders the page at 300 dpi (pypdfium2), deskews by the dominant
text-line angle, reads it with Apple Vision in overlapping tiles (Vision returns at most
~250 observations per image, so a full page of numbers loses half its cells unless tiled;
a full tile splits 2×2), takes WORD boxes from `boundingBoxForRange`, and sets each word's
baseline from the ink inside its box (Vision's boxes are padded unevenly, by up to two
points on a 6 pt table, which stacks neighbouring rows). A second Vision pass with
language correction on replaces words that have letters when it is at least as confident
(numbers keep the raw reading). OpenCV morphological opening gives the ruling lines. The
engine takes the page record as if it came from pdf.js, with the rules standing in for the
operator list, and the round-3 stream logic structures the table. Afterwards: numeric
columns (≥ 80 % numbers) get their digit confusions mapped back (O/D/Q→0, B→8, S→5,
l/I/|→1, Z→2, G→6, Б→6, stray spaces, the column's decimal mark, a leading "0."), a year
header is fitted by majority vote, a dotted note row becomes one spanning cell, a value
the stream pass widened over an empty neighbour goes back to its column, and cells that
are still unreadable or empty are cropped at 3× and read alone (a dash or star comes from
an ink check, never from Vision's reading of a mark). Text columns are never corrected.

Scores are `tools/parse-score.mjs score` against the truth files; the CDC truth was
double-entered (531 cells, 51×11, five column-spanning notes). Seconds are wall clock
through `tools/parse-bench/scan.mjs` (helper CLI; one cold Python process per call, so the
in-process server is a little faster). The helper's page OCR is ~10 s for the CDC page:
3 s raw Vision over 12 tiles, 6 s for the language-correction pass, the rest render,
deskew, rules and ink refinement; the cell re-read is ~1.6 s.

| input | pipeline | structure F1 | cell F1 | seconds |
|---|---|---|---|---|
| cdc1980-p25-imageonly.pdf (200 dpi gray JPEG, no text) | built-in alone | no table (one `scan` block) | — | 0.3 |
| cdc1980-p25-imageonly.pdf | Docling 2.91 + ocrmac (helper `parse`) | 0.821 | 0.082 | 13 |
| cdc1980-p25-imageonly.pdf | **Vision words + rules + built-in + repair + re-read** | **1.000** | **0.957** | 14.3 (OCR 12.1, cells 1.7) |
| cdc1980-p25.pdf (old OCR text layer) | built-in on the layer | 0.968 | 0.779 | 0.4 |
| cdc1980-p25.pdf | fresh OCR (same flow) | 0.983 | 0.952 | 13.7 |
| cdc1980-p25.pdf | auto: layer vs fresh per table by numeric validity | chose fresh → 0.983 | 0.952 | 13.7 |
| report-scan.pdf (3 pages, 150 dpi, 0.4° skew) | Docling 2.91 + ocrmac | 1.000 | 0.918 | 13.3 |
| report-scan.pdf | **this flow** (deskew −0.38/−0.60/−0.38°) | **1.000** (3/3 tables) | **0.975** (119/122 cells: T1 0.974, T2 0.952, Appendix 1.000) | 11.3 |

The CDC image-only target (cell F1 ≥ 0.95) and the report-scan target (≥ 0.97) are met.
The same engine on the two renders of the CDC page (the image-only fixture and the page
with its layer) gives 51×11 both times; the layer-vs-fresh choice picked fresh (numeric
validity 0.996 on 462 cells vs the layer's 0.998 on 466, but the fresh table reads 51 rows
where the layer collapses Smallpox into Shigellosis), and on the held-out p24 it picked
the layer for the second (bottom) table and fresh for the main one.

### Every remaining wrong cell, cdc1980-p25-imageonly (23 of 531)

| r,c | expected | got | class |
|---|---|---|---|
| 0,0 | Disease | (empty) | smudged header word in the scan; Vision reads nothing |
| 2,0 | Anthrax | Anth rax | word split by the scan (two Vision words) |
| 5,0 | Foodborne | Foodboma | label misread |
| 7,0 | Brucellois (undulant fever) | Brucellois lundulant faver) | `(`→`l`, `e`→`a` |
| 9,5 | 96.06 | 96.08 | digit misread (6/8), a valid number so not repairable |
| 10,0 | Cholera | Cholara | label misread |
| 13,8 | 0.69 | 0.60 | digit misread (9/0) |
| 14,0 | Post childhood infections | Past childhood infections | label misread |
| 18,0 | Hepatitis B | Hepatitis 8 | B/8 in a text column (never corrected by design) |
| 19,1 | 5.25 | 6.25 | digit misread (5/6) |
| 20,0 | Legionellosis | Legianellosis | label misread |
| 21,0 | Leprosy | Laprost | label misread |
| 25,0 | Measles (rubeola) | Measles (rubeala) | label misread |
| 28,0 | Pertussis (whooping cough) | Pertussis (whaoping coughi | label misread |
| 30,0 | Poliomyelitis, total | Paliomyelitis, ta1al | label misread |
| 34,0 | Rheumatic fever, acute | Rhaumatic lever, acute | label misread |
| 38,0 | Shigellosis | Shigellasis | label misread |
| 38,2 | 9.15 | 9.16 | digit misread (5/6) |
| 42,0 | Tetanus | Totan us | label misread + split |
| 46,0 | Typhoid fever (cases) | Typhoid fever (cares) | label misread |
| 48,0 | Typhus fever, flea-borne (endemic, murine) | Typhus faver, flea-borne landemic, murine) | label misread |
| 49,0 | Typhus fever, tick-borne (Rocky Mountain spotted) | Typhus fever, tick-borne (Racky Mountain spotted) | label misread |
| 50,1 | Last indigenous case reported 1911; last imported, 1924 [10] | Lact indigannus case reporter 1911; lner imported, 1924 [10] | note text misread (span right) |

Every number the repair touched (19 cells such as `0.D3`, `D.OD`, `12.B4`, `1.1Б`, the year
`1876`) is right; the four numeric errors left are valid numbers with one wrong digit.
All 18 label errors are Vision misreads of 6 pt type at 200 dpi; the 3× crop re-read with
language correction fixes some ("Aseptic", "Legionellosis", "Rocky Mountain spotted") but
breaks others ("Tetanus" → "Totanus", "Shigellosis" → "Shigellasis"), so text cells keep
the page reading. The layer PDF reads 29 wrong: the same classes plus five cells where
the re-read filled a dotted note row with a neighbouring number (`20,7 → 0.06`).

### Held-out CDC pages (by eye, no truth; `qpdf … --pages . N --` from the 144-page scan)

| page | what is on it | engine result | error classes seen |
|---|---|---|---|
| p24, landscape "Summary of reported cases, United States, 1971–1980" (counts): 11 columns, population row + 59 disease rows, group rules, two dotted note rows, footnote marks on numbers | fresh table 46×11 (chosen over the layer's 46×11, validity 0.983 vs 0.966) plus a second table 12×17 for the last group (Tularemia … Yellow fever), where the layer was kept | (a) the bottom group splits off as its own table at the `Tuberculosis⁴` row and comes out 17 columns wide (footnote marks become columns); (b) the narrow label column wraps "Granuloma inguinale" and the wrap is not re-joined (one extra row); (c) "Trichinosis"/"Tuberculosis" rows merge (a footnote mark ⁴ between them); (d) `1972 1971` header read as one cell; (e) footnote marks on numbers (`264¹` → `264'`) are flagged low-confidence, 7 unrepaired; (f) `1,004,029` read as `1.004,029` (comma/period mix not covered by the decimal-style rule). Everything else: 46 rows, 11 columns, the `Last documented case occurred in 1949` span, the dashes, all right by eye. |
| p35, portrait "Aseptic meningitis, reported cases by state and by month, 1980": 15 columns (State, Total, Jan–Dec, Unk.), 1 header row + 70 rows of regions and states, most cells `—` or one digit | fresh OCR finds only 286 words (38×15); the comparison keeps the OCR layer's 69×15 table (validity 0.945 on 813 cells vs 0.956 on 136) | Vision recall collapses on dense 5 pt single digits and dashes (hundreds of cells read as nothing), so the fresh table is a third of the real one; the automatic choice correctly falls back to the layer. The layer table is right in shape (69 of 71 rows, 15 columns) with the known layer misreads. A denser tile grid or a 400 dpi render for pages whose body size is under 6 pt is the next step. |

Contracts added in this round: helper `POST /v1/ocr` and CLI `plexus-parse-helper ocr`
(`pxd-ocr/1` page records, see the helper README); engine `parsePageGeometry` accepts a
page record with `scan: true` and `rules` (items with `fontName: "ocr"`, `conf`, `y0`,
`y1`; page `transform [1,0,0,1,0,0]`); `pages[].ocr`, `pages[].ocrChoice`; table blocks
on such pages carry `engine: "ocr+builtin"`, `repairs {fixed, unrepaired, spans,
numericCols}`, `ocrSource` (`fresh` | `layer`), `ocrCompare`; cells carry `conf`, `wbox`,
`wbase`, `wsize`, `repaired`, `reread`. `src/model/parse/ocr-fix.js` (pure repair),
`src/model/parse/ocr-merge.js` (`mergeOcrDocument`, `chooseTable`, `scanPagesOf`),
`readScan` in `src/view/parse-engine.js`, `createHelperClient().ocr({bytes, sha256, pages |
cells})`, the view's "Read the scan" button (auto with engine `auto` and a ready helper),
and `tools/parse-score.mjs diff` (every wrong cell).

## In-browser OCR

`createOcrWeb` returns `pxd-ocr/1` (`engine: "ppocr-web"`). Fetch starts at `ocr()`, not at load. The parse view accepts `ocrSource`. No Settings row. Models are Apache-2.0 PP-OCRv5 mobile det plus English rec (RapidOCR v3.9.2). SHA-256 is in `src/model/ocr/manifest.js`. onnxruntime-web 1.30.0 loads from jsDelivr into Cache Storage `plexus-diagram-models`. WebGPU, then wasm. The build copies `assets/` to `deploy/assets/`.

Word boxes come from the image, not from CTC frames (round 2, 2026-10-07). Inside each det line box: ink mask (page Otsu, then a local Otsu per box so a blue or grey cell fill is not ink), vertical projection, and a break wherever the empty run is at least 0.9× the line's ink height (`src/model/ocr/word-split.js`). Each segment is read on its own; CTC spaces inside a segment snap to the projection's inner gaps. Baseline and size come from the ink rows (baseline = last row with a quarter of the busiest row; size = cap height / 0.64, Vision's scale), per word, with the block around the busiest row cut at the thinnest row before the next line. Rows that run through both box edges or fill 85% of a segment (rules, underlines) do not count as text.

The first-version faults were not the CTC mapping: (1) rec batches padded every crop to the widest crop of the page with white (1.0); a 528 px label padded to 2256 px read `SloSExCNTMPILE`, and white padding beyond ~35% turned `Weekly` into `cYanmaGnel`. Batches now hold crops within 1.3× width and pad with 0, as PaddleOCR does. (2) det ran on a 960 px map, so 6 pt CDC text was 7 px tall; the det scale is now chosen per page so the median det box is ~27 map px (probe at 1600, `detLimitFor`). (3) DB det never boxes a lone `-` or `1` in a cell (44 of 392 cells on eu-001): uncovered ink components are grouped and read on their own (`src/model/ocr/orphans.js`), dash-shaped bars become `-`/`–`/`—` by width. (4) The English rec dict has no en dash, so `$9,595–$17,992` read `$9,595$17,992`; a free-standing mid-height bar between glyphs is put back as `–`.

Node, onnxruntime-node, same mobile models, 300 dpi:

| Bench | Before (f0fac1e) | Now | Gate | Vision |
|---|---|---|---|---|
| CDC image-only, structure / cell F1 | 0.930 / 0.425 | 0.983 / 0.922 | 1.0 / 0.93 | 1.0 / 0.957 |
| report-scan cell F1 t1 / t2 / t3 | 0.400 / 0.927 / 0.489 | 0.947 / 0.976 / 0.444 | 0.95 | 0.974 / 0.952 / 1.000 |
| ICDAR 2013 at 300 dpi, adjacency / detection / cell | 0.508 / 0.866 / 0.399 | 0.871 / 0.932 / 0.780 | 0.90 | n/a |
| ICDAR 2013 at 150 dpi, adjacency / detection / cell | 0.434 / 0.813 / 0.359 | 0.843 / 0.929 / 0.774 | 0.85 | n/a |
| CDC words vs Vision, IoU ≥ 0.5 and equal text / box only | 9/30 on ocr-table.png | 545/651 (83.7%) / 630/651 (96.8%) | 95% | — |
| ocr-table.png (deduplicated Vision tiles) | 9/30 | 9/9 | 95% | — |

CDC per page: 6.8 s (det 0.55 s incl. the scale probe, rec 5.5 s over ~660 crops, ~106k padded columns at height 48). eu-001 p1: 4.9 s. ICDAR 300 dpi: 1766 s for 238 pages (7.4 s/page, partly run alongside other benches). Rec dominates; batch size (8–32), width ratio and ORT thread count change it by under 5%. WebGPU is not measured here; the rec column count suggests 0.5–1 s per warm page, above the 0.4 s target.

Every CDC text mismatch against Vision was checked: about half are Vision's own misreads (`7979`, `D.OD`, `0.0B`, `Laprost`, `Foodboma`); ours are o/a/e confusions in 6 pt degraded type (`Granulama`, `Paliomyelitis`, `fover`). Gate misses, with their class:

- CDC cell 0.922: o/e/a letter confusions in labels and a few digit swaps (`9.15`→`9.16`); geometry is right (box agreement 96.8%, baselines within 0.15 pt of Vision's median).
- report-scan t3 0.444: one wrapped row (`Z3-` / `007` with a centred middle line) splits in the stream engine: the scan keeps ~0.17° of skew after the det-based deskew, so the middle line sits 0.96 pt further from the first than in the PDF, past the 0.7 em join. `Z1-014` reads `21-014` on that page.
- ICDAR: three of 67 documents have no table found (us-010, us-011a, us-022 are colour-filled tables; the text-layer path sees the fills in the operator list, the OCR record has only rules: `ocrGraphics` returns `boxes: []`). Next: emit filled-region boxes from `rulesFromCanvas` and pass them through `ocrGraphics`. Superscripts and `l`/`I` confusions (`HCl`→`HCI`, `Triphenyltin`→`TriphenyItin`) are the main text class.
- PP-OCRv5 server det + rec (88 MB + 85 MB, multilingual dict) gave CDC cell 0.924 / 0.926 against 0.922 for mobile at 4–9× the time: not worth the download.

Sweeps (`PXD_OCR_OPTS` JSON overrides `preparePageImage` options, `PXD_OCR_MODELS` swaps the ONNX files): `node tools/parse-bench/scan.mjs <pdf> <truth> --source ppocr-web`, `node tools/parse-bench/ocr-agree.mjs --pdf <pdf> --vision <helper ocr json> [--page n]`, `node tools/parse-bench/icdar2013-scan.mjs <dataset> --dpi 300|150`.

### Round 3 (2026-10-07): filled tables, fine deskew, in-browser reading in the pane

Filled tables. `fillsFromCanvas` (`src/model/ocr/rules-from-canvas.js`) finds flat regions of one grey darker than the paper on a ~0.5 pt grid: region growing from flat 3×3 seeds within ±14 grey levels, a 3-sample close (mends the anti-aliased seam between two abutting fills of one colour), a 2 pt open (cuts a same-colour table frame that joins every fill), pieces of one region on the same row band merged again (text that nearly fills a short cell cuts it under the open), then four straight edges (70 %), three square corners (a rounded bar or badge fails) and 55 % solidity. The page record carries them as `fills: [{ x0, y0, x1, y1, gray }]` (points, grey 0–1). `rulesFromCanvas(…, { fills })` drops rule fragments strictly inside a fill (the bars between white letters on a dark header). `ocrGraphics` turns fills into engine boxes (`light` at luminance ≥ 0.7), so cell tilings reach `boxGridRules` as in the text-layer path; fills that repeat at one width and mostly hold words also give their top and bottom edges as rules (full-width zebra rows have no tiling); light fill clusters that mostly hold no word (a chart's plot area cut into strips by its grid lines) are dropped. White text on a dark fill is ink too: `localMask` takes the minority class as ink when the dark class covers over 60 % of a det box.

Fine deskew. `baselineSkew` (`src/model/ocr/fine-skew.js`) fits the per-word ink baselines of rows of 3+ words spanning 150 pt and takes the span-weighted median slope; a residual of 0.05–1° turns the image (rules, fills and the cell re-read use it) and moves the words with `rotateItems`, so nothing is read twice. report-scan pages go from 0.47/0.51/0.54° (det-box angle) to 0.40° on all three, the scan's real skew; the t3 wrapped row joins. On born-digital rasters it takes back det-box rotations of 0.15–0.21° that were never there (eu-020, eu-023, us-035a).

Node, onnxruntime-node, PP-OCRv5 mobile, round 2 (533b48f) against this round:

| Bench | Round 2 | Round 3 | Gate | Vision |
|---|---|---|---|---|
| CDC image-only, structure / cell F1 | 0.983 / 0.922 | 0.983 / 0.922 | cell ≥ 0.92 | 1.000 / 0.957 |
| report-scan cell F1 t1 / t2 / t3 | 0.947 / 0.976 / 0.444 | 0.947 / 0.976 / 0.952 | 0.95 | 0.974 / 0.952 / 1.000 |
| ICDAR 2013 at 300 dpi, adjacency / detection / cell | 0.871 / 0.932 / 0.780 | 0.876 / 0.957 / 0.787 | adjacency 0.90 | n/a |
| ICDAR 2013 at 150 dpi, adjacency / detection / cell | 0.843 / 0.929 / 0.774 | 0.850 / 0.945 / 0.792 | 0.85 | n/a |
| us-010 / us-011a / us-022 at 300 dpi, adjacency | 0 / 0 / 0 (no table) | 0.930 / 1.000 / 1.000 | | |
| us-010 / us-011a / us-022 at 300 dpi, cell | 0 / 0 / 0 | 0.945 / 0.987 / 1.000 | | |
| ICDAR 2013 born-digital (text layer), adjacency / cell | 0.979 / 0.932 | 0.979 / 0.932 | unchanged | |

Per-document moves beyond 0.005 (both dpi): better on us-001, us-028 (a table now found), eu-015, eu-022, eu-024, eu-025 (150), eu-017 (150), eu-021 (150 cell 0.000 → 0.836); worse on eu-011 at 150 dpi (an extra two-column table from a chart legend, detection 1.000 → 0.667; the same page without fills reads the same), eu-018 (adjacency −0.02, cell +0.05 to +0.13), eu-021 at 300 (cell 0.016 → 0.005), us-035a (adjacency −0.01, 150 dpi cell 0.196 → 0.099: the det-box rotation of −0.19° is taken back and two 6 pt rows of the age table merge; both readings are poor). The ICDAR adjacency gate at 300 dpi (0.90) is still missed: the main classes are unchanged from round 2 (superscripts, `l`/`I`, small type).

The reading pane wires this source as `deviceOcr` (`src/host/device-ocr.js`, see the README). The pane's device read merges pages into the outline without the cell re-read pass that the bench (and Read the scan with the helper) runs.

### Round 4 (2026-10-08): text lines (headings, notes, captions)

Table cells had a doubtful-cell re-read; the words outside tables had nothing, so the CDC title came back as `NOTiFIABlE DISEASeS - Summary of reported cases per 100,000 populetion, Unitmd States, 1980` (live wasm read: `NOtiFIABLE DISEASes - Summary of reparted 100,000 populetion, Unitmd Stares, 1971-1980 csses 2`). Two passes now run after the first merge and before the cell re-read, on in-browser OCR pages only (`engine: "ppocr-web"`; the helper's Vision words are left alone):

- Line re-read (`src/model/parse/ocr-lines.js`, `rereadLines` in `src/view/parse-engine.js`). Words outside every table are grouped into lines (same baseline within half a size, gaps under 2.5 sizes; rotated page-edge words skipped). A line is doubtful when a word has a low confidence bucket, odd case inside a word, digits inside letters, punctuation inside letters, or a word the word list does not hold. Each doubtful line goes to the same cell source (`ocr({ cells })` with `line: true`) under the same AbortSignal; `readCell` reads the whole line at 1×, 2× and 3× with a cell's side pad but no vertical pad (the box is clipped clear of the lines and tables above and below; a cell's 1.5 pt pad took the next line's ascenders and turned a 6 pt note into `latn l`). Lines wider than 38 heights go in pieces at word gaps. The device source answers nothing without cached models, so this never starts a download.
- Choice and lexicon (`src/model/ocr/lexicon.js`). Every read and the first read are scored after the case and lexicon fixes: suspicious words, plus what a read lost from the first read (numbers, dashes, non-ASCII marks such as superscripts, and any word with nothing within edit distance len/3). The lowest score wins; a tie goes to the first read unless two scales returned the same text. A suspicious word then takes a clean, close word from another scale (`reparted` at 1× → `reported` at 2×), and a dictionary word of the first read comes back where the read has it one letter off (`Note:` read again as `Not:`). A lone hyphen the first read also saw as a dash takes the glyph its ink width gives (about an em → `—`).
- Lexicon fixes: odd case inside a word goes to the line's dominant case (`NOtiFIABLE` → `NOTIFIABLE`; CamelCase names such as `BlendHouse` stay). A word not in the list is corrected only through letters read below 0.9 confidence, within the recogniser's confusion pairs (a/e/o/c/s, i/l, t/f, n/m/h/u, rn/m, cl/d …, at most two swaps), only when exactly one listed word is reachable. Numbers, mixed alphanumerics, footnote-marked words (`Kleshchev1`) and capitalised words seen twice are never changed. A run-together word splits only when its read was doubtful (a letter below 0.9) and it is no listed word, and then only where exactly one cut gives two listed words of 4+ letters (`Environmentalmonitoring`) or the title rule holds (18+ letters, 3+ pieces, a function word, every other piece a listed word of 4+ letters). A confidently read word (`traceability`) is never split.
- Word list: SCOWL 2020.12.07 sizes 10–40 (english + american), lowercase alphabetic words, 43,778 words, gzip 115,131 bytes, `assets/ocr/en-words.txt.gz` (licence in `assets/ocr/LICENCE.md`). SHA-256 in `LEXICON_FILE` (`src/model/ocr/manifest.js`). `createOcrWeb().lexicon()` reads it from Cache Storage `plexus-diagram-models` or our Pages origin, gunzips with `DecompressionStream`, and caches it; `prefetch()` (the explicit download) takes it along; `deviceOcr.lexicon()` returns null until the models are cached. Nothing is fetched at load.

Wiring: `readScan` (bench and Read the scan) and the pane's on-device read (`applyOcr(pages, { readCells, lexicon })`, `read-pane.js` passes `deviceOcr.lexicon`) run the line pass, merge again when a line changed, then run the cell re-read on the final document. The pane stores the corrected page records (`onOcrPages`), so a reopened PDF restores the fixed text.

Node, onnxruntime-node, PP-OCRv5 mobile, 300 dpi. Before = `PXD_OCR_LINES=0` (main at 32a3f91), after = this round. Text-line word accuracy is the longest common subsequence of word tokens over truth words (`--text`, `tools/parse-bench/text-lines.mjs`); CDC truth lines are `test/fixtures/pdf/cdc1980-p25.lines.json` (title and four notes), report-scan uses the paragraphs, headings, list items and captions of `src/report.html`.

| Bench | Before | After | Gate |
|---|---|---|---|
| CDC image-only title line | `NOTiFIABlE DISEASeS - Summary of reported cases per 100,000 populetion, Unitmd States, 1980` | `NOTIFIABLE DISEASES — Summary of reported cases per 100,000 population, United States, 1971-1980` (exact) | exact |
| CDC image-only, text-line word accuracy / exact lines | 0.733 (44/60) / 0/5 | **0.950** (57/60) / 1/5 | |
| CDC image-only, structure / cell F1 | 0.983 / 0.922 | 0.983 / 0.922 | cell ≥ 0.922 |
| CDC with OCR layer (fresh read), text-line word accuracy / exact lines | 0.933 / 1/5 | 0.983 / 2/5 | |
| CDC with OCR layer, structure / cell F1 | 0.994 / 0.947 | 0.994 / 0.947 | |
| report-scan, text-line word accuracy / exact lines | 0.952 (514/540) / 18/32 | 0.956 (516/540) / 18/32 | |
| report-scan cell F1 t1 / t2 / t3 | 0.947 / 0.976 / 0.952 | 0.947 / 0.976 / 0.952 | |
| ICDAR 2013 at 300 dpi, adjacency / detection / cell | 0.876 / 0.957 / 0.787 | 0.876 / 0.957 / 0.787 | no move > 0.005 on any document |
| ICDAR 2013 at 150 dpi, adjacency / detection / cell | 0.850 / 0.945 / 0.792 | 0.850 / 0.945 / 0.792 | no move > 0.005 on any document |

Cost: three rec runs per doubtful line, about 160 ms a line in node (CDC: 7 lines, 1.1 s on a 6.6 s page; report-scan p1: 10 lines, 1.3 s). ICDAR re-read 530 lines in 57 of 67 documents at 300 dpi and 564 in 62 at 150 dpi; table metrics do not move because the pass never touches words inside a table.

What is still wrong on CDC: `sh wn` for `shown` (a split the line read keeps), `gonarrhee` (two letters off; `gonorrhea` is in the list but the line read gave both letters at 0.9+ confidence, so the lexicon leaves it) and `venareum` (`venereum` is not in the list), the `**` footnote marks read as `"` or dropped. The title block is still a paragraph, not a heading (heading level accuracy 0/1 before and after).

### Round 5 (2026-10-08): the browser's raster

Live, the CDC title still read `NOTIFIABLE DISEASES — Summary of reparted 100,000 populetion, United Stares, 1971-1980 csses 2` after round 4. Cause: the bench rendered with pypdfium2, the pane renders with pdf.js, and pdf.js turns image smoothing off when an image is drawn larger than its pixels relative to the display's pixel ratio (`getImageSmoothingEnabled`: smooth only up to 1.33 × devicePixelRatio). The CDC scan is a 200 dpi image drawn at 300 dpi (1.5×): on a 1.1× window that is nearest-neighbour with uneven pixel rows; on a 2× Retina screen it is smoothed. The same PDF read differently per screen. `PXD_RENDER=pdfjs node tools/parse-bench/scan.mjs …` (pdf.js on @napi-rs/canvas, `PXD_STEADY=0` for pdf.js's own choice) reproduced the live text word for word.

Fix: `steadyImageScaling` (`src/host/ocr-web.js`) decides per image draw on the OCR canvas: a whole-number upscale copies pixels, any other upscale is bilinear, a downscale is smoothed. Forcing smoothing everywhere was tried and dropped: on report-scan (150 dpi drawn 2×) it broke the two-column reading order (text 0.969 → 0.772).

Second cause, same title: on the pdf.js raster the recogniser boxed `cases per` on its own, 1 pt wide and 3.8 pt below the line, so the line pass read those words inside the title line and the paragraph kept them again at its end. `textLines` now puts a short run of words (or a squeezed one, a line high) that sits in a gap of a longer line, under 0.8 of a size off its baseline and overlapping it, back into that line.

| Bench (node, PP-OCRv5 mobile, 300 dpi) | pdf.js before | pdf.js after | pypdfium2 after |
|---|---|---|---|
| CDC title line | `NOTIFIABLE DISEASES — Summary of reparted 100,000 populetion, United Stares, 1971-1980` + `csses per` | exact | exact |
| CDC structure / cell F1 | 0.992 / 0.918 | 0.983 / 0.932 | 0.983 / 0.922 |
| CDC text-line word accuracy | 0.717 | 0.900 | 0.950 |
| report-scan cell F1 t1 / t2 / t3, text | 0.895 / 1.000 / 0.356, 0.969 | unchanged | 0.947 / 0.976 / 0.952, 0.956 |
| ICDAR 2013 at 300 dpi (pypdfium2), adjacency / detection / cell | | | 0.876 / 0.957 / 0.787, every count identical to round 4 |

Live (Readwisenotes, window dpr 1.095, helper stopped, in-browser read on open): CDC title exact, cell F1 0.932, text 0.900; open → title on the card and in the pane about 27 s (built-in parse +0.9 s, OCR read with line and cell passes ~25 s). The read runs on the main thread: `new Worker()` for `assets/ocr/ocr-worker.js` on our Pages origin throws SecurityError from roamresearch.com, and `createOcrWeb` falls back to the inline engine. report-scan t3 on a pdf.js raster (0.356) against pypdfium2 (0.952) was open; round 6 closes it. The main-thread read is fixed by the next section.

### In-browser OCR off the main thread (fix/ocr-worker)

Cause: `new Worker("https://svyk.github.io/plexus-diagram/assets/ocr/ocr-worker.js")` throws SecurityError on roamresearch.com (a worker script must be same-origin), so `createOcrWeb` ran the whole read on Roam's main thread. Fix: `createOcrWeb` fetches the worker bundle from our Pages origin like the models (Cache Storage `plexus-diagram-models`, SHA-256 and size checked against `OCR_WORKER` in `src/model/ocr/worker-asset.js`, which `build.mjs` generates from the same bundle it writes to `deploy/assets/ocr/ocr-worker.js`) and starts it as a module worker from a blob URL. ORT, its wasm glue, and the wasm go in as blob URLs; the models are transferred. An AbortSignal rejects the pending call at once and posts `abort`; the worker starts its next job with a fresh signal. `prefetch()` takes the worker bundle along; `cached()` still asks only for the models. Only if the blob worker also fails (constructor throws, or `error` before `ready`) does OCR run on the page, with a `setTimeout(0)` before every det and rec run. `scheduler.yield()` was tried there and dropped: its continuations run ahead of other tasks, so Roam's timers and message tasks waited 20 s (and the longtask observer did not report it).

| Live, CDC fresh read (Readwisenotes, helper stopped, models cached) | before (main thread) | after (blob worker) | fallback (blob worker forced to fail) |
|---|---|---|---|
| read start → title | 24.9 s | 24.7 s | 25.7 s |
| longest main-thread task during the read | 23 415 ms | 269 ms (not OCR: another extension's mutation handler as the text layer lands) | 1 662 ms (one wasm model run) |
| total blocked (long-task time over 50 ms) | 24.5 s | 1.2 s (the whole run, including opening the pane) | 19.8 s |
| longest gap between frames / 100 ms timer drift | 23.4 s / 23.8 s | 269 ms / 298 ms | 1.7 s / 2.5 s |

OCR words (`ocr-layer`) and both stored parses are identical before and after; the title is exact.

### Round 6 (2026-10-08): the wrapped row on the pdf.js raster

report-scan t3 read cell F1 0.356 on the pdf.js raster because one table row split in two. The intermediate stages for page 3 were diffed between the two renders: the ruling lines are the same three rules (within 0.5 pt), neither render has fills, the det-box deskew is 0.39° vs 0.40°, and every word has the same text and box within about 0.4 pt. The difference is the baseline of one line. The `Z2-` / `031` row wraps over two lines, and its single-line cells (`2`, `Painted steel`, `4.5`, `Monthly`) are centred between them. In the PDF those cells sit exactly half a pitch (6.0 pt) below the first line. The OCR size estimate is 9.0 for 8.5 pt type, so `visualRows` (`src/model/parse/stream.js`) joins a word to the row within 0.7 em = 6.3 pt. On the pdf.js raster the centred line measured 6.34 pt below the first, so it started a new row, and the second line (`031`, `motor`) then joined that new row. The wrapped-cell rule only looked back at words already in the row, and the centred cell arrives before the second line. The pypdfium2 raster passed by 0.11 pt on that row and by 0.04 pt on the `Z3-` / `007` row, so both renders were one baseline wobble from the same failure.

Fix: `ocrApart` now also looks ahead (`centredLine`). A word up to 0.8 em below the row's first baseline joins when a later word stacks under a first-line row word at line pitch (0.8–1.6 em, overlapping it horizontally), the word sits within 0.15 em of the middle of that pair, and no word on its own line overlaps that column. Evenly pitched rows with every column filled stay apart, because the middle row has a word in the stacked column. Born-digital words (no `conf`) are unchanged.

Node, onnxruntime-node, PP-OCRv5 mobile, 300 dpi, main (56abf84) against this round:

| Bench | pdf.js before | pdf.js after | pypdfium2 before | pypdfium2 after |
|---|---|---|---|---|
| report-scan cell F1 t1 / t2 / t3 | 0.895 / 1.000 / 0.356 | 0.895 / 1.000 / **0.976** | 0.947 / 0.976 / 0.952 | 0.947 / 0.976 / 0.952 |
| report-scan t3 structure F1, rows | 0.933, 8 rows | 1.000, 7 rows | 1.000, 7 rows | 1.000, 7 rows |
| report-scan text-line word accuracy | 0.969 | 0.969 | 0.956 | 0.956 |
| CDC image-only, structure / cell F1 | 0.983 / 0.932 | 0.983 / 0.932 | 0.983 / 0.922 | 0.983 / 0.922 |
| CDC image-only, text-line word accuracy | 0.900 | 0.900 | 0.950 | 0.950 |
| ICDAR 2013 at 300 dpi, adjacency / detection / cell | | | 0.876 / 0.957 / 0.787 | 0.876 / 0.957 / 0.787 |
| ICDAR 2013 at 150 dpi, adjacency / detection / cell | | | 0.850 / 0.945 / 0.792 | 0.850 / 0.945 / 0.792 |

ICDAR runs through pypdfium2 (`icdar2013-scan.mjs`); every per-document score is identical before and after at both dpi. What t3 still gets wrong on the pdf.js raster: `Z1-014` reads `21-014` (one cell), the same misread as on pypdfium2. t1 on the pdf.js raster (0.895 vs 0.947) is a separate open item: `c`→`*` and `2`→empty in a re-read, and a stray `1` joins `Absent in 25 g` and `5`.

## Scanned technical PDFs, 1900–1950

Sixty-two pages from sixteen public-domain scans (NACA technical notes, Bureau of Standards circulars, a USDA bulletin, Smithsonian Physical Tables, a 1919 drawing manual, and US patent 600,014). The PDFs are not in git. The manifest is `tools/parse-bench/scan-corpus.json`: each file has `url`, `year`, `licence`, and `sha256`. Fetch into a directory of this shape (the default root is `/tmp/wo/pxd14/scans`, override with `PXD_SCAN_DIR`):

```
pdfs/<file>          # the sha256 in the manifest
truth/<id>.json      # one file per pages[] entry; not committed, except the six fixtures below
```

```
node tools/parse-bench/scan-corpus.mjs
node tools/parse-bench/scan-corpus.mjs --engines web-ocr --only naca-supercharger-1932-p15
node tools/parse-bench/scan-corpus.mjs --json /tmp/scan-corpus.json
```

`builtin` is the shipped parse of the PDF as it stands (embedded text, or a scan block). `web-ocr` is that parse plus `readScan` with `--source ppocr-web` (in-browser OCR, what a user without the helper gets). `helper` is `readScan` through the local Vision CLI. `helper-rs` is the same path with `tools/parse-helper-rs/target/release/plexus-parse-helper-rs` (`--helper rust` points the `helper` engine at that binary). `helper-vlm` reuses that Vision page cache and posts the PDF to `POST /v1/vlm` (layout boxes, then PaddleOCR-VL) on the helper named by `PXD_VLM_URL`. Both Vision engines then vote page words against the cached PP-OCR reading (`src/model/parse/ocr-vote.js`); cell re-reads stay on Vision, and words inside a ruled table are not replaced. OCR answers are cached under `<root>/cache`, keyed by the OCR sources, so a parse-only change re-scores without reading the page again.

A truth file is `{ id, source, class, quality, tables?, figures?, lines?, textComplete? }`. A table cell is `{ r, c, rowSpan, colSpan, text, header, unsure? }`. A figure is `{ bbox, caption }` with `bbox` page-normalised, origin top-left. `unsure: true` drops that cell from both sides. Figure hit is IoU ≥ 0.5. A caption links when token Jaccard ≥ 0.5, or the shorter caption's tokens all sit inside the longer one (`Fig.2` and `Fig. 2` are the same pair). Character error is scored only when `textComplete` is true. Figure pages transcribe captions and a few checked lines. Six typewritten pages set `textComplete`, and those lines are the CER/WER on the round 2 board.

Ten pages, 661 KB of PDF, are committed under `test/fixtures/pdf/scans/` with their truth so CI parses them. The fold-out (`naca-diesel-viscosity-1929-p12`) must come back `scanLayer` with no figure: the art is horizontal image strips, not a page-sized drawing.

Round 1, 2026-10-09, forty pages. Caption recall in the before column is recomputed with the same `Fig.2` matcher as the after column (the first print was 0.115 web-ocr and 0.231 helper). First-run seconds per page, before the cache: builtin 0.05, web-ocr 7.69, helper 4.89.

| Engine | Cell F1 before | after | Structure F1 before | after | Figure F1 before | after | Caption recall before | after |
|---|---|---|---|---|---|---|---|---|
| builtin | 0.005 | 0.004 | 0.128 | 0.121 | 0.207 | 0.074 | 0.038 | 0.038 |
| web-ocr | 0.075 | **0.170** | 0.121 | **0.275** | 0.367 | **0.490** | 0.154 | **0.346** |
| helper | 0.048 | 0.048 | 0.057 | 0.057 | 0.612 | 0.612 | 0.308 | 0.385 |

The built-in figure drop is the fold-out. A full-page box had IoU 0.51 against the plot, which counted as a hit and was not the drawing. Strips are now the scan background (`stripTiles` in `src/model/parse/index.js`, only when the page has under 400 characters of text, so a journal PDF painted in bands stays a text page). web-ocr and the helper then read the page: diesel p12 figure F1 goes from a miss on web-ocr to 1.

The other parse change is `chartGrid` in `src/model/parse/lattice.js`. A ruled grid whose cells are tick marks was a table, its rules were consumed, and the figure was the leftover axis. Those rules now stay with the figure. A column of words, or two header words, keeps the table. Propeller p10 and p11 go from figure F1 0 to 1 on web-ocr, and the false 22×12 tick table is gone.

ICDAR 2013 text layer, same command as the table above this section, every document unchanged: EU detection F1 0.993, adjacency 0.996; US adjacency 0.974, cell F1 0.928. `scan.mjs` on the CDC page is unchanged (text layer structure 0.968 / cell 0.779; Vision fresh 0.983 / 0.952). report-scan through Vision is unchanged (cell F1 0.974 / 0.952 / 1.000). `PARSE_REV` is 9.

Round 2, 2026-10-09, adds 16 table pages and 6 full-text pages (27 tables, 1,605 scored cells). The before column is the round 1 parser plus the `chartGrid` interior test below, scored on this set before the stream changes. The old forty pages and the new twenty-two are scored apart because the new pages are almost all tables.

Old forty pages (round 1 after → round 2):

| Engine | Cell F1 | Structure F1 | Figure F1 | Caption recall |
|---|---|---|---|---|
| builtin | 0.004 → 0.004 | 0.121 → 0.122 | 0.074 → 0.074 | 0.038 → 0.038 |
| web-ocr | 0.170 → **0.331** | 0.275 → **0.427** | 0.490 → 0.490 | 0.346 → 0.346 |
| helper | 0.048 → 0.048 | 0.057 → 0.057 | 0.612 → 0.612 | 0.385 → 0.385 |

New twenty-two pages (before the stream changes → after):

| Engine | Cell F1 | Structure F1 | Figure F1 | CER | WER |
|---|---|---|---|---|---|
| builtin | 0.026 → 0.026 | 0.498 → 0.502 | 1.000 → 1.000 | 0.118 | 0.724 |
| web-ocr | 0.061 → 0.063 | 0.379 → 0.396 | 0.000 → 0.000 | 0.031 | 0.139 |
| helper | 0.124 → 0.123 | 0.692 → 0.668 | 0.000 → 0.000 | 0.241 | 1.272 |

`chartGrid` now keeps a table whose interior is at least 45% filled. The first cut (interior under 15%, and 80% of the labels on the outer frame) also dropped the propeller tick grids: those pages fill 0.25–0.35 of the interior, because a tick sits on an inner ruling. A dense numeric grid fills the interior (about 1) and stays a table. A 10×6 numeric header is a table; a 12×8 axis and a 22×12 sheet of short ticks are charts.

Stream tables (`detectStreamRuns` in `src/model/parse/stream.js`): a double-spaced numeric row stays in the run when its numbers sit on the columns already found, or when the next line repeats the column heads, out to 3.4 em. A second copy of the same short title still starts a new table. A row that is only a dash rule, a leader, or a stray `;` is not a cell; a bullet stays, because the CDC page uses one as a mark. A table of phrases (half the filled cells are five or more words) is rejected. Leader dots are not a column. A footnote letter glued to the following number stays in that cell (`c 0.1654`). A chart axis whose few short numbers span an otherwise empty grid is not a table. A title sitting above a year header (1971, 1980, …) is not the first row of that table.

web-ocr on supercharger p15 (Table II, no rules, three speed sections) goes from no table to cell F1 0.857, one 14×4 table. That is the old-forty cell move. The new table pages are ruled yield tables with spanning headers: web-ocr cell F1 stays near 0.06. Helper structure on those pages falls 0.692 → 0.668; cell F1 is flat. Redwood p21 (leader dots) stays at helper cell F1 0.277 after a `;` from a broken leader was stopped from splitting the Engler table.

The six `textComplete` pages are typewritten NACA prose. web-ocr CER 0.031 / WER 0.139. Helper CER 0.241 / WER 1.272. Built-in, which reads the text layer, is CER 0.118 / WER 0.724.

ICDAR 2013 text layer is unchanged (EU detection 0.993, adjacency 0.996, cell 0.942; US adjacency 0.974, cell 0.928). The raster bench (`icdar2013-scan.mjs`, PP-OCR, 300 dpi, 67 documents, 1625 s) is detection F1 0.951, adjacency 0.876, cell F1 0.788 (EU 0.920 / 0.822 / 0.665, US 0.981 / 0.893 / 0.832). CDC text layer is 0.968 / 0.779. CDC Vision fresh is 0.983 / 0.952 (image-only 1.000 / 0.957). report-scan Vision is 0.974 / 0.952 / 1.000. `PARSE_REV` is 10.

Figures and captions round (feat/scan-figs), 2026-10-09, same forty pages. The before column is the round-1 board above. A plate is the ink and the rule fragments that share one figure line (`Fig.`, `Figure`, `Plate`, including `Fig.2`, `F1g. 2`, `FIG,2`, and a short header such as `Note No. 315 Fig. 3`). Two different numbers stay two figures. The in-browser OCR worker adds `ink` boxes from a connected-components pass on the page it already decoded (about 50 ms on a 1800×2800 raster). The helper has no raster ink; its plates are rules only. A tick grid or a block of sketch labels inside the plate is not a table. A ruled table of labels and numbers is.

| Engine | Cell F1 before | after | Structure F1 before | after | Figure F1 before | after | Caption recall before | after |
|---|---|---|---|---|---|---|---|---|
| builtin | 0.004 | 0.004 | 0.121 | 0.119 | 0.074 | 0.074 | 0.038 | 0.038 |
| web-ocr | 0.170 | **0.258** | 0.275 | **0.418** | 0.490 | **0.836** | 0.346 | **0.731** |
| helper | 0.048 | **0.062** | 0.057 | **0.074** | 0.612 | **0.868** | 0.385 | **0.692** |

Fold-out diesel p12 stays a scan layer with no figure on the built-in parse, and figure F1 1 after OCR (web-ocr IoU 0.642, helper 0.737). Ice p17, accelerometer p8, copper p20, wind p18, and supercharger p21 go from figure F1 0 to 1 on web-ocr. Propeller p13 stays two figures (web-ocr F1 0.5 → 1). Diesel p14's false table is gone (web-ocr cell F1 0 → 1) and the chart remains. Ice p19 is still a miss on both engines: two captions, neither hull reaches IoU 0.5. Wind p18's figure hits and the caption does not (the OCR line is not the truth sentence). Supercharger p15 web-ocr cell F1 goes from 0.857 to 0: the fresh in-browser reading does not form a stream table. The same page from the round-1 cache still does, with this parser and with the previous one.

ICDAR 2013 text layer again, every document the same totals: EU detection F1 0.993, adjacency 0.996, cell F1 0.942; US detection 0.988, adjacency 0.974, cell F1 0.928. Born-digital figures are unchanged: ViT 14 (20 captions), U-Net 4 (5), patent 7 (7), LDM 34 (50). CDC text layer 0.968 / 0.779. CDC Vision fresh 0.983 / 0.952. CDC image-only through the in-browser models: structure 0.983, cell F1 0.922. report-scan Vision on this read: cell F1 0.974 / 0.976 / 0.976 (t3's site count on `Z1-014` is empty; the previous parser on the same OCR page leaves it empty too). report-scan through the in-browser models: 0.974 / 0.976 / 0.952.

Round 3, 2026-10-09, same 62 pages. The before column is the round 2 parser scored on this set. `cell@0.9` is cell F1 when a matched cell counts at normalised edit similarity ≥ 0.9. `cellSim` is the mean of that similarity over cells that share a position. Exact cell F1 is still exact after `normText`. Two scorer fixes, both exact: a space inside a decimal (`8. 059` and `8.059`) and a single letter before a number (`e 7.67` and `e7.67`). Trailing leader dots are not folded into exact F1.

| Engine | Cell F1 | cell@0.9 | cellSim | Structure F1 | Figure F1 | Caption recall | CER | WER |
|---|---|---|---|---|---|---|---|---|
| builtin | 0.023 → 0.022 | 0.022 | 0.321 | 0.441 → 0.440 | 0.074 → 0.074 | 0.038 → 0.038 | 0.118 → 0.118 | 0.724 → 0.724 |
| web-ocr | 0.092 → **0.109** | 0.114 | 0.404 | 0.400 → **0.534** | 0.471 → 0.471 | 0.346 → 0.346 | 0.031 → 0.031 | 0.139 → 0.137 |
| helper | 0.113 → **0.124** | 0.128 | 0.457 | 0.591 → **0.632** | 0.588 → 0.577 | 0.385 → 0.385 | 0.241 → **0.060** | 1.272 → **0.282** |

`cell@0.9` and `cellSim` are new; they have no before column. On the six full-text pages, helper CER/WER went from 0.241 / 1.272 to 0.060 / 0.282. web-ocr on those pages stayed 0.031 / 0.137.

Vision's box for a short lowercase word is the line box. Sized as an x-height it lands near 1.7× the body size, so `buildLines` kept it off the line and reading order followed the tall box. The same line's right half often sits about a third of an em higher, so it was read before the left half. OCR words on one baseline now join across that size step and that jitter. A row that then splits at a hole shares one baseline, so the pieces stay left to right. An unsplit line keeps its own baseline. Born-digital lines are unchanged. The helper also snaps a word with no ascender up to 1.85× body size onto the body size. Redwood labels lose a trailing leader (`d..`) in `cellTextOf` when the words are OCR; a placeholder of only dots stays, and `c 0.1654` stays. A page that already has a ruled table does not bridge a stream gap.

ICDAR 2013 text layer matches main on every document (us-009 is pred 1, fp 0). CDC text layer is 0.968 / 0.779. CDC Vision fresh is 0.991 / 0.964. report-scan Vision is 0.974 / 0.976 / 1.000. Helper figure F1 drops 0.588 → 0.577 because supercharger p21 gains a second figure on the running header. `PARSE_REV` is 12.

Figures round 2, 2026-10-09, `PARSE_REV` 13, same forty pages. The before column is the figures-round table above.

| Engine | Cell F1 before | after | Structure F1 before | after | Figure F1 before | after | Caption recall before | after |
|---|---|---|---|---|---|---|---|---|
| builtin | 0.004 | 0.004 | 0.119 | 0.120 | 0.074 | 0.074 | 0.038 | 0.038 |
| web-ocr | 0.258 | **0.421** | 0.418 | **0.544** | 0.836 | **0.980** | 0.731 | **0.923** |
| helper | 0.062 | 0.053 | 0.074 | 0.064 | 0.868 | **0.920** | 0.692 | **0.769** |

web-ocr hits 25 of 26 figures (25 predictions). The miss is inductance p13: the coil drawing is not boxed. Patent 600,014 p1 hits (IoU 0.73) and the caption does not, because the truth caption is the sheet title, not a figure line. Helper hits 23 of 26 (24 predictions): ice p19 is still one rules hull (the cached helper page has no `ink`), inductance p13 is missed, and the unlinked captions are propeller p10 (`Fig.`), wind p18 (`seclions`), and the patent title.

Ice p19 web-ocr is two figures (Fig. 5 and Fig. 6), each on its own caption baseline. A thin stroke that crosses the cut is dropped. Gas burners p27 reads `FIG. II` as 11 only when the numeral is the uppercase roman `II` (the crop on p27 is already `FIG. 11`; `FIG. III` and `fig. ii` stay). Accelerometer p8 keeps the digit that OCR put on the next header, so web-ocr caption recall is 1. Propeller p13 stops the caption at the ordinate note: helper is `Fig.5 Navy section curve. Ordinates in terms of`, and `orainate` stays off the caption. A label-only caption (`Fig. 1`) does not join the next paragraph. Copper p20 helper caption is `Fig. 1`.

False plates are gone on wind p14, patent p2, diesel p7, accelerometer p6, and USDA p10. `plate 14 inches` is not Plate 14. `Figure 1 is a side elevation` and `Figure 2 herewith.` are sentences, not the caption under the ink. An uncaptioned rule cluster on a page of 400 or more characters is not a figure (USDA's table). A short patent sheet still clusters (p1, 238 characters). USDA p10 cell F1 stays 0. Removing the false figure lets the unread table through: web-ocr predicts 39 cells and the helper 48, all misses. That is the cell dip on the helper column. The cells belong to the table branch.

The twenty-two table and text pages, against the pre-figure board: web-ocr and helper figure F1 go from 0 to 1 because the two false boxes are gone and the truth has no figures. Cell F1 is unchanged (web-ocr 0.063, helper 0.123, built-in 0.026). Structure F1 moves by at most 0.002 (web-ocr 0.396 → 0.394, built-in 0.502 → 0.503, helper 0.668).

All 62 pages this round: built-in cell 0.022, structure 0.440, figure 0.074, caption recall 0.038. web-ocr cell 0.095, structure 0.407, figure 0.980, caption recall 0.923. Helper cell 0.116, structure 0.600, figure 0.920, caption recall 0.769.

Supercharger p15 web-ocr cell F1 is 0.857 on the current cache (`2de29618f0b053467a93b245`, deskew −0.29°, 240 items, 64 ink boxes), one 12×4 stream before the cell reread and the reread score on the board. The same cache scores cell F1 0.833 with the previous parser, so this round did not make the table. The round-1 cache (`04398a7659c3361b99200194`, deskew 0, 239 items, no ink) still scores 0.183, four stream tables, with both parsers. The two readings share no word whose rounded x, y, and text all match. `inkBoxesFromCanvas` runs after recognition, so it does not move the words. `stream.js` was not edited. A row leaves the run when `row.base - lastBase > 2.2 * row.size` and the keep at that gap fails: the gap is over 3.4 em, or the row is a repeated title, or it is not aligned with the run and not a short banner over a numeric line.

The Rust helper page record now includes `ink`: `[{x0, y0, x1, y1}, …]`, at most 400 boxes in points, words wider than 80 pt or taller than 36 pt left unmasked, same filters as `inkBoxesFromCanvas`. `ocrGraphics` copies `data.ink` onto `graphics.ink`. A debug build of `ink_boxes` on a 2550×3300 raster at 300 dpi took 170 ms. The published helper column is still the cached Python pages, which have no ink, so ice p19 helper stays the one rules hull until a fresh helper OCR. The Python helper writes the same `ink` array; that does not invalidate the board cache.

ICDAR 2013 text layer matches this branch's HEAD on all 67 documents (EU detection 0.993, adjacency 0.996, cell 0.942; US detection 0.981, adjacency 0.974, cell 0.928). The US detection gap against the figures-round log (0.988) is us-009's second stream table, which HEAD already emits. No other document moved. Born-digital figures are unchanged: ViT 14 (20 captions), U-Net 4 (5), patent 7 (7), LDM 34 (50). CDC text layer is 0.968 / 0.779. report-scan Vision was not re-read.

## Paired statistics against another parser

`node tools/parse-bench/paired-stats.mjs --root <corpus dir> --manifest <manifest.json> --a <docs dir> --b <docs dir> [--a-name Plexus] [--b-name LlamaParse] [--fold-quotes] [--gate dev|sealed] [--seed 20261009] [--json out.json] [--md out.md]` compares two engines page by page on the same truth. Pages come from the manifest's `pages` (same shape as `scan-corpus.json`); truth is `<root>/truth/<id>.json`. A docs dir holds `<id>.pxd.json` (a `scan-corpus.mjs --dump` folder) or `<pdf file>.p<N>.<anything>.pxd.json` (a `cloud-run.mjs` folder); the id is tried first. A page with no readable doc counts as a failed read (every applicable component 0) and is reported. Scoring is `scorePage` (and `foldQuotes` with `--fold-quotes`); the tool adds only the page score and the statistics.

Page score S is the mean of the components the truth supports: table cell F1 and structure F1 (when `tables` is an array), figure F1 (when `figures` is an array), caption recall (when a truth figure has a caption), and `max(0, 1 - CER)` (when `textComplete` with lines). On d = S_a - S_b over the kept pages it reports the one-sided Wilcoxon signed-rank test (zeros dropped, average ranks; exact p by dynamic programming over doubled ranks, plus the normal approximation with tie and continuity correction), matched-pairs rank-biserial r, Cohen's d_z, a 10,000-resample bootstrap 95% percentile CI of the mean (mulberry32, `--seed`), per-component non-inferiority for cell, text and figure (CI lower bound above -0.05 over the pages where the component applies; a component with no pages fails), and a breakdown by manifest `category` (first `class` when absent). `--gate sealed` is the loop's pass rule (n >= 30, five pages in each of rough-scan, modern-digital, photo, handwritten, mixed, exact p < 0.01, r >= 0.5, d_z >= 0.8, CI lower bound > 0, three non-inferiority checks); `--gate dev` drops the n and category conditions. Tests are in `test/paired-stats.test.js` (reference values from scipy 1.17.1 and a brute-force sign enumeration for tied vectors).

## Which model reads a table crop best (tables round 11, 2026-10-10)

The crops High accuracy sends today (layout boxes united with the rule boxes, same `PAD` / `TOP_PAD`, 200 dpi) on every
development page with a truth table: 48 pages, 69 crops (A old scans 19 pages / 28 crops, B spent held-out 12 / 17, C new dev
17 / 24). Each crop was read alone by three readers, greedy, temperature 0, seed 0, each in its own documented output format
(`Table Recognition:` OTSL for the two PaddleOCR-VL models, an HTML-table instruction for Qwen), converted with
`tables_from_text`, and scored with GriTS-Con / GriTS-Top against the truth (quotes and leader dots folded, as in the loop).
The reading alone, no rule table, no arbitration.

| Reader | Licence | Cell | Structure | s / crop | Peak GB | A cell | B cell | C cell |
|---|---|---|---|---|---|---|---|---|
| PaddleOCR-VL-0.9B (shipped) | Apache-2.0 | 0.837 | 0.877 | 9.2 | 3.0 | 0.899 | 0.857 | 0.753 |
| PaddleOCR-VL-1.6-0.9B | Apache-2.0 | 0.842 | 0.876 | 6.7 | 3.0 | 0.847 | 0.888 | 0.806 |
| Qwen3-VL-8B-Instruct-4bit | Apache-2.0 | 0.709 | 0.757 | 47.6 | 7.1 | 0.690 | 0.696 | 0.739 |

By class (cell): typeset-table 27 pages 0.903 / 0.863 / 0.674; modern-digital 11 pages 0.890 / 0.933 / 0.790; rough-scan 4
pages 0.344 / 0.450 / 0.670; typewritten-table 4 pages 0.744 / 0.860 / 0.815. Page by page, 1.6 beats 0.9B by more than 0.01
on 12 pages and loses on 24; Qwen wins 8, loses 31. The 0.9B / 1.6 oracle (best of the two per page) is 0.888, but the
shipped arbitration (rule table against the 0.9B reading) already averages 0.960 on these pages, and the oracle of that with
the 1.6 reading is 0.965: one page (nist-jres126-008 p1, 0.801 → 0.858) is all a second reader could add. Nothing was wired.

What the bake-off did find: the loop stop in `_RepeatStop` fired on twelve identical `<lcel>` tokens, which is a caption spanning
thirteen columns, not a loop (coal-fatalities-1916 p1 stopped after its caption row; the shipped page scored 0.77 on cells from
the rule table). Span tokens now run to 64 before the stop fires. The 0.9B crop on that page reads 0.950 / 0.961; the full
bench page is S 0.904 → 0.970 (cell 0.77 → 0.95), every other A, B and C page unchanged against 3.17.0 (int-18695d1).

The shipped 0.9B pin names the MLX re-save of `model.safetensors` (1 811 260 812 bytes), not the file the Hub serves at the pinned
revision (1 917 255 968 bytes, `pt` format), so `ensure_reader` on a fresh machine downloads the Hub file and fails its own SHA-256
check. Not fixed in this round; the pin should be re-measured from a real `hf_hub_download` at that revision. The 1.6 files at
`c5630abae1d940eafe0697512a0325494b02ab42` match the Hub exactly and were downloaded that way, should a later round want them.
