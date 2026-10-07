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
