//! Word boxes in top-left PDF points. A direct port of the pure functions in `ocr.py`.

use image::GrayImage;
use serde::Serialize;

use super::imageops::{InkBox, Rule};

pub const DPI: i32 = 300;
pub const TILE_COLS: i32 = 3;
pub const TILE_ROWS: i32 = 2;
pub const TILE_OVERLAP_PX: i32 = 160;
pub const TILE_EDGE_PX: f64 = 10.0;
pub const TILE_FULL: usize = 180;
pub const TILE_MAX_DEPTH: i32 = 2;
pub const MAX_PAGES: usize = 50;
pub const CELL_SCALE: u32 = 3;
pub const CELL_PAD_PT: f64 = 1.5;

pub type Tile = (i32, i32, i32, i32);

#[derive(Clone, Debug)]
pub struct Observation {
    pub text: String,
    pub conf: f64,
    pub bbox: (f64, f64, f64, f64),
    pub words: Vec<(String, (f64, f64, f64, f64))>,
}

#[derive(Clone, Debug)]
struct Cand {
    text: String,
    x0: f64,
    y0: f64,
    x1: f64,
    y1: f64,
    size: f64,
    base: f64,
    conf: f64,
    margin: f64,
}

#[derive(Clone, Debug, Serialize)]
pub struct WordItem {
    #[serde(rename = "str")]
    pub text: String,
    pub transform: [f64; 6],
    pub width: f64,
    pub height: f64,
    pub y0: f64,
    pub y1: f64,
    #[serde(rename = "fontName")]
    pub font_name: &'static str,
    pub conf: f64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub raw: Option<String>,
}

#[derive(Clone, Debug, Serialize)]
pub struct PageRecord {
    pub n: i32,
    pub w: f64,
    pub h: f64,
    pub rotation: i32,
    pub transform: [f64; 6],
    pub scan: bool,
    pub dpi: i32,
    pub deskew: f64,
    pub fonts: Fonts,
    pub items: Vec<WordItem>,
    pub rules: Vec<Rule>,
    pub ink: Vec<InkBox>,
    pub ops: Ops,
}

#[derive(Clone, Debug, Serialize)]
pub struct Fonts {
    pub ocr: FontName,
}

#[derive(Clone, Debug, Serialize)]
pub struct FontName {
    pub name: &'static str,
}

#[derive(Clone, Debug, Serialize)]
pub struct Ops {
    #[serde(rename = "fnArray")]
    pub fn_array: Vec<serde_json::Value>,
    #[serde(rename = "argsArray")]
    pub args_array: Vec<serde_json::Value>,
}

pub fn round_dp(x: f64, dp: i32) -> f64 {
    let m = 10f64.powi(dp);
    (x * m).round() / m
}

fn has_descender(text: &str) -> bool {
    text.chars().any(|c| "gjpqy,;()[]{}|/_@".contains(c))
}

fn has_tall(text: &str) -> bool {
    text.chars().any(|c| {
        c.is_ascii_uppercase() || c.is_ascii_digit() || "bdfhklt'\"!?$%&*#/\\|[]{}()".contains(c)
    })
}

fn has_letters(text: &str) -> bool {
    let bytes = text.as_bytes();
    bytes.windows(2).any(|w| w[0].is_ascii_alphabetic() && w[1].is_ascii_alphabetic())
}

fn is_numberish(text: &str) -> bool {
    if text.is_empty() {
        return false;
    }
    text.chars().all(|c| c.is_digit(10) || ".,()%+-–—OoDQBSslIZG|".contains(c))
}

fn line_metrics(text: &str, y0: f64, y1: f64) -> (f64, f64) {
    let height = (y1 - y0).max(0.5);
    let descender = has_descender(text);
    let tall = has_tall(text);
    let (size, base) = if descender && tall {
        let size = height / 1.15;
        (size, y1 - 0.22 * size)
    } else if descender {
        let size = height / 0.95;
        (size, y1 - 0.22 * size)
    } else if tall {
        let size = height / 0.95;
        (size, y1 - 0.03 * size)
    } else {
        let size = height / 0.75;
        (size, y1 - 0.03 * size)
    };
    (size, base)
}

pub fn tile_grid(width: i32, height: i32, cols: i32, rows: i32, overlap: i32) -> Vec<Tile> {
    let mut tiles = Vec::new();
    for r in 0..rows {
        for c in 0..cols {
            let x0 = (c * width / cols - overlap).max(0);
            let x1 = ((c + 1) * width / cols + overlap).min(width);
            let y0 = (r * height / rows - overlap).max(0);
            let y1 = ((r + 1) * height / rows + overlap).min(height);
            tiles.push((x0, y0, x1, y1));
        }
    }
    tiles
}

struct BoxWord {
    word: String,
    px0: f64,
    px1: f64,
    py0: f64,
    py1: f64,
    size: f64,
    base: f64,
}

fn baseline_clusters(boxes: &[BoxWord]) -> Vec<Vec<usize>> {
    let mut order: Vec<usize> = (0..boxes.len()).collect();
    order.sort_by(|&a, &b| boxes[a].base.partial_cmp(&boxes[b].base).unwrap_or(std::cmp::Ordering::Equal));
    let mut clusters: Vec<Vec<usize>> = Vec::new();
    for idx in order {
        let b = &boxes[idx];
        let same = clusters.last().is_some_and(|cluster| {
            let prev = *cluster.last().unwrap();
            b.base - boxes[prev].base <= 0.45 * b.size
        });
        if same {
            clusters.last_mut().unwrap().push(idx);
        } else {
            clusters.push(vec![idx]);
        }
    }
    clusters
}

fn iou(a: &Cand, b: &Cand) -> f64 {
    let ix = a.x1.min(b.x1) - a.x0.max(b.x0);
    let iy = a.y1.min(b.y1) - a.y0.max(b.y0);
    if ix <= 0.0 || iy <= 0.0 {
        return 0.0;
    }
    let inter = ix * iy;
    let area = (a.x1 - a.x0) * (a.y1 - a.y0) + (b.x1 - b.x0) * (b.y1 - b.y0) - inter;
    if area > 0.0 { inter / area } else { 0.0 }
}

fn box_iou(a: (f64, f64, f64, f64), b: (f64, f64, f64, f64)) -> f64 {
    let (ax0, ay0, ax1, ay1) = a;
    let (bx0, by0, bx1, by1) = b;
    let ix = ax1.min(bx1) - ax0.max(bx0);
    let iy = ay1.min(by1) - ay0.max(by0);
    if ix <= 0.0 || iy <= 0.0 {
        return 0.0;
    }
    let inter = ix * iy;
    let area = (ax1 - ax0) * (ay1 - ay0) + (bx1 - bx0) * (by1 - by0) - inter;
    if area > 0.0 { inter / area } else { 0.0 }
}

fn dense_runs(ink: &[i32], limit: f64) -> Vec<(usize, usize)> {
    let mut runs = Vec::new();
    let mut start = None;
    for (i, &on) in ink.iter().enumerate() {
        let dense = on as f64 >= limit;
        if dense && start.is_none() {
            start = Some(i);
        } else if !dense && start.is_some() {
            runs.push((start.unwrap(), i - 1));
            start = None;
        }
    }
    if let Some(start) = start {
        runs.push((start, ink.len() - 1));
    }
    runs.retain(|(a, b)| b - a >= 2);
    runs
}

fn nearest_run(runs: &[(usize, usize)], centre: f64) -> Option<(usize, usize)> {
    runs.iter().copied().min_by(|a, b| {
        let da = ((a.0 + a.1) as f64 / 2.0 - centre).abs();
        let db = ((b.0 + b.1) as f64 / 2.0 - centre).abs();
        da.partial_cmp(&db).unwrap_or(std::cmp::Ordering::Equal)
    })
}

fn refine_by_ink(cands: &mut [Cand], image: &GrayImage, scale: f64) {
    let pad = 2.0;
    let w = image.width() as f64;
    let h = image.height() as f64;
    let raw = image.as_raw();
    let stride = image.width() as usize;
    for c in cands.iter_mut() {
        let x0 = (c.x0 * scale - pad).floor().max(0.0) as usize;
        let x1 = ((c.x1 * scale).ceil() + pad).min(w) as usize;
        let y0 = (c.y0 * scale - pad).floor().max(0.0) as usize;
        let y1 = ((c.y1 * scale).ceil() + pad).min(h) as usize;
        if x1.saturating_sub(x0) < 2 || y1.saturating_sub(y0) < 2 {
            continue;
        }
        let rows = y1 - y0;
        let cols = x1 - x0;
        let mut ink = vec![0i32; rows];
        for (row, count) in ink.iter_mut().enumerate() {
            let src = (y0 + row) * stride + x0;
            *count = raw[src..src + cols].iter().filter(|&&p| p < 160).count() as i32;
        }
        let peak = ink.iter().copied().max().unwrap_or(0);
        if peak < 2 {
            continue;
        }
        // `max(2, 0.25 * peak)` stays fractional, as in ocr.py. Truncating the quarter
        // treats a row of 2 ink pixels as body on a short word and the baseline joins
        // the next line.
        let centre = (y1 - y0) as f64 / 2.0;
        let Some((top, bottom)) = nearest_run(&dense_runs(&ink, (0.25 * peak as f64).max(2.0)), centre) else {
            continue;
        };
        c.base = (y0 + bottom + 1) as f64 / scale;
        let row0 = top.saturating_sub(2);
        let row1 = (bottom + 3).min(rows);
        let mut cols_on = Vec::new();
        for col in 0..cols {
            let mut any = false;
            for row in row0..row1 {
                if raw[(y0 + row) * stride + x0 + col] < 160 {
                    any = true;
                    break;
                }
            }
            if any {
                cols_on.push(col);
            }
        }
        if cols_on.len() >= 2 {
            c.x0 = (x0 + cols_on[0]) as f64 / scale;
            c.x1 = (x0 + cols_on[cols_on.len() - 1] + 1) as f64 / scale;
        }
    }
}

fn snap_baselines(items: &mut [Cand]) {
    let mut order: Vec<usize> = (0..items.len()).collect();
    order.sort_by(|&a, &b| items[a].base.partial_cmp(&items[b].base).unwrap_or(std::cmp::Ordering::Equal));
    let mut anchor: Option<f64> = None;
    for idx in order {
        let base = items[idx].base;
        let size = items[idx].size;
        if anchor.is_none_or(|anchor| base - anchor > 0.3 * size) {
            anchor = Some(base);
        }
        items[idx].base = anchor.unwrap_or(base);
    }
}

pub fn observations_to_items(
    tiled: &[(Tile, Vec<Observation>)],
    scale: f64,
    image_size: (u32, u32),
    image: Option<&GrayImage>,
) -> Vec<WordItem> {
    let width_px = image_size.0 as f64;
    let height_px = image_size.1 as f64;
    let mut candidates = Vec::new();
    for ((tx0, ty0, tx1, ty1), observations) in tiled {
        let tx0 = *tx0 as f64;
        let ty0 = *ty0 as f64;
        let tx1 = *tx1 as f64;
        let ty1 = *ty1 as f64;
        let tw = tx1 - tx0;
        let th = ty1 - ty0;
        if tw <= 0.0 || th <= 0.0 {
            continue;
        }
        for obs in observations {
            let mut boxes = Vec::new();
            for (word, (bx, by, bw, bh)) in &obs.words {
                let px0 = tx0 + bx * tw;
                let px1 = tx0 + (bx + bw) * tw;
                let py0 = ty0 + (1.0 - by - bh) * th;
                let py1 = ty0 + (1.0 - by) * th;
                let (size, base) = line_metrics(word, py0 / scale, py1 / scale);
                boxes.push(BoxWord { word: word.clone(), px0, px1, py0, py1, size, base });
            }
            for cluster in baseline_clusters(&boxes) {
                let mut bases: Vec<f64> = cluster.iter().map(|&i| boxes[i].base).collect();
                bases.sort_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));
                let base = bases[bases.len() / 2];
                for idx in cluster {
                    boxes[idx].base = base;
                }
            }
            for b in boxes {
                let mut margin = (b.px0 - tx0).min(tx1 - b.px1).min(b.py0 - ty0).min(ty1 - b.py1);
                if (tx0 > 0.0 && b.px0 - tx0 < TILE_EDGE_PX)
                    || (tx1 < width_px && tx1 - b.px1 < TILE_EDGE_PX)
                    || (ty0 > 0.0 && b.py0 - ty0 < TILE_EDGE_PX)
                    || (ty1 < height_px && ty1 - b.py1 < TILE_EDGE_PX)
                {
                    margin = -1.0;
                }
                candidates.push(Cand {
                    text: b.word,
                    x0: b.px0 / scale,
                    y0: b.py0 / scale,
                    x1: b.px1 / scale,
                    y1: b.py1 / scale,
                    size: b.size,
                    base: b.base,
                    conf: obs.conf,
                    margin,
                });
            }
        }
    }
    candidates.sort_by(|a, b| b.margin.partial_cmp(&a.margin).unwrap_or(std::cmp::Ordering::Equal));
    let mut kept: Vec<Cand> = Vec::new();
    for cand in candidates {
        if cand.margin < 0.0 {
            continue;
        }
        if kept.iter().any(|other| iou(&cand, other) > 0.4) {
            continue;
        }
        kept.push(cand);
    }
    if let Some(image) = image {
        refine_by_ink(&mut kept, image, scale);
    }
    if !kept.is_empty() {
        let mut plain: Vec<f64> = kept
            .iter()
            .filter(|c| has_tall(&c.text) && !has_descender(&c.text))
            .map(|c| c.size)
            .collect();
        if plain.is_empty() {
            plain = kept.iter().map(|c| c.size).collect();
        }
        plain.sort_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));
        let body = plain[plain.len() / 2];
        for c in &mut kept {
            // Snap only up to 1.5× body. A wider gate (the Python helper uses 1.85× for
            // words with no ascender) pulls table rows onto one size and the row pitch
            // collapses. Headings and the taller line of a tight table stay distinct.
            if 0.45 * body <= c.size && c.size <= 1.5 * body {
                c.size = body;
            }
        }
        kept.retain(|c| c.size >= 0.45 * body || (c.conf >= 1.0 && is_numberish(&c.text)));
    }
    snap_baselines(&mut kept);
    kept.sort_by(|a, b| {
        round_dp(a.base, 1)
            .partial_cmp(&round_dp(b.base, 1))
            .unwrap_or(std::cmp::Ordering::Equal)
            .then(a.x0.partial_cmp(&b.x0).unwrap_or(std::cmp::Ordering::Equal))
    });
    kept.into_iter()
        .map(|c| {
            let size = round_dp(c.size, 2);
            WordItem {
                text: c.text,
                transform: [size, 0.0, 0.0, size, round_dp(c.x0, 2), round_dp(c.base, 2)],
                width: round_dp(c.x1 - c.x0, 2),
                height: size,
                y0: round_dp(c.base - 0.8 * size, 2),
                y1: round_dp(c.base + 0.22 * size, 2),
                font_name: "ocr",
                conf: round_dp(c.conf, 3),
                raw: None,
            }
        })
        .collect()
}

fn item_box(item: &WordItem) -> (f64, f64, f64, f64) {
    let x = item.transform[4];
    (x, item.y0, x + item.width, item.y1)
}

pub fn merge_corrected(mut raw: Vec<WordItem>, corrected: Vec<WordItem>) -> Vec<WordItem> {
    let boxes: Vec<((f64, f64, f64, f64), WordItem)> = corrected.into_iter().map(|c| (item_box(&c), c)).collect();
    raw = merge_split_words(raw, &boxes);
    let mut out = Vec::new();
    for item in raw {
        let text = item.text.clone();
        if !has_letters(&text) || is_numberish(&text) {
            out.push(item);
            continue;
        }
        let box_ = item_box(&item);
        let mut best = None;
        let mut best_iou = 0.7;
        for (cbox, c) in &boxes {
            let score = box_iou(box_, *cbox);
            if score > best_iou {
                best_iou = score;
                best = Some(c);
            }
        }
        if let Some(best) = best {
            if best.text != text && best.conf >= item.conf && has_letters(&best.text) {
                let mut merged = item;
                merged.raw = Some(text);
                merged.text = best.text.clone();
                merged.conf = best.conf;
                out.push(merged);
            } else {
                out.push(item);
            }
        } else {
            out.push(item);
        }
    }
    out
}

fn merge_split_words(mut raw: Vec<WordItem>, boxes: &[((f64, f64, f64, f64), WordItem)]) -> Vec<WordItem> {
    raw.sort_by(|a, b| {
        round_dp(a.transform[5], 1)
            .partial_cmp(&round_dp(b.transform[5], 1))
            .unwrap_or(std::cmp::Ordering::Equal)
            .then(a.transform[4].partial_cmp(&b.transform[4]).unwrap_or(std::cmp::Ordering::Equal))
    });
    let mut out = Vec::new();
    let mut i = 0;
    while i < raw.len() {
        let a = &raw[i];
        let b = raw.get(i + 1);
        let mut merged = None;
        if let Some(b) = b {
            if (a.transform[5] - b.transform[5]).abs() <= 0.3 * a.transform[0] && has_letters(&(a.text.clone() + &b.text)) {
                let ab = item_box(a);
                let bb = item_box(b);
                let union = (ab.0.min(bb.0), ab.1.min(bb.1), ab.2.max(bb.2), ab.3.max(bb.3));
                let joined = format!("{}{}", a.text, b.text);
                for (cbox, c) in boxes {
                    if box_iou(union, *cbox) >= 0.7 && c.text.replace(' ', "") == joined {
                        let mut item = a.clone();
                        item.text = c.text.clone();
                        item.width = round_dp(union.2 - union.0, 2);
                        item.conf = a.conf.min(b.conf).min(c.conf);
                        merged = Some(item);
                        break;
                    }
                }
            }
        }
        if merged.is_some() {
            out.push(merged.unwrap());
            i += 2;
        } else {
            out.push(raw[i].clone());
            i += 1;
        }
    }
    out
}

pub fn page_record(n: i32, items: Vec<WordItem>, rules: Vec<Rule>, w: f64, h: f64, dpi: i32, deskew_deg: f64, ink: Vec<InkBox>) -> PageRecord {
    PageRecord {
        n,
        w: round_dp(w, 2),
        h: round_dp(h, 2),
        rotation: 0,
        transform: [1.0, 0.0, 0.0, 1.0, 0.0, 0.0],
        scan: true,
        dpi,
        deskew: deskew_deg,
        fonts: Fonts { ocr: FontName { name: "ocr" } },
        items,
        rules,
        ink,
        ops: Ops { fn_array: Vec::new(), args_array: Vec::new() },
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::Value;
    use std::fs;

    fn load_fixture() -> (Vec<(Tile, Vec<Observation>)>, u32, u32, f64) {
        let path = concat!(env!("CARGO_MANIFEST_DIR"), "/../parse-helper/tests/fixtures/ocr-table.vision.json");
        let value: Value = serde_json::from_str(&fs::read_to_string(path).unwrap()).unwrap();
        let w = value["size"][0].as_u64().unwrap() as u32;
        let h = value["size"][1].as_u64().unwrap() as u32;
        let dpi = value["dpi"].as_f64().unwrap();
        let mut tiled = Vec::new();
        for entry in value["tiles"].as_array().unwrap() {
            let t = entry["tile"].as_array().unwrap();
            let tile = (
                t[0].as_i64().unwrap() as i32,
                t[1].as_i64().unwrap() as i32,
                t[2].as_i64().unwrap() as i32,
                t[3].as_i64().unwrap() as i32,
            );
            let mut observations = Vec::new();
            for obs in entry["observations"].as_array().unwrap() {
                let box_ = obs["box"].as_array().unwrap();
                let mut words = Vec::new();
                for word in obs["words"].as_array().unwrap() {
                    let bb = word[1].as_array().unwrap();
                    words.push((
                        word[0].as_str().unwrap().to_string(),
                        (bb[0].as_f64().unwrap(), bb[1].as_f64().unwrap(), bb[2].as_f64().unwrap(), bb[3].as_f64().unwrap()),
                    ));
                }
                observations.push(Observation {
                    text: obs["text"].as_str().unwrap().to_string(),
                    conf: obs["conf"].as_f64().unwrap(),
                    bbox: (box_[0].as_f64().unwrap(), box_[1].as_f64().unwrap(), box_[2].as_f64().unwrap(), box_[3].as_f64().unwrap()),
                    words,
                });
            }
            tiled.push((tile, observations));
        }
        (tiled, w, h, dpi)
    }

    #[test]
    fn saved_vision_result_converts_to_word_items() {
        let (tiled, w, h, dpi) = load_fixture();
        let items = observations_to_items(&tiled, dpi / 72.0, (w, h), None);
        let words: Vec<&str> = items.iter().map(|i| i.text.as_str()).collect();
        assert_eq!(words, ["Item", "1980", "1979", "Alpha", "0.05", "1.20", "Beta", "12.84", "0.00"]);
        let mut sizes = std::collections::BTreeSet::new();
        let mut rows = std::collections::BTreeSet::new();
        for item in &items {
            assert_eq!(item.transform[1], 0.0);
            assert_eq!(item.transform[2], 0.0);
            assert_eq!(item.transform[3], item.transform[0]);
            assert!(item.transform[0] > 0.0);
            assert_eq!(item.font_name, "ocr");
            assert!(item.conf > 0.0 && item.conf <= 1.0);
            assert!(item.y0 < item.transform[5] && item.transform[5] < item.y1);
            sizes.insert(item.transform[0].to_bits());
            rows.insert(item.transform[5].round() as i64);
        }
        assert_eq!(sizes.len(), 1);
        assert_eq!(rows.len(), 3);
        assert_eq!(words.len(), words.iter().collect::<std::collections::BTreeSet<_>>().len());
    }

    #[test]
    fn words_above_1_5_body_keep_their_size() {
        fn obs(word: &str, x: f64, height: f64) -> (Tile, Vec<Observation>) {
            (
                (0, 0, 400, 200),
                vec![Observation {
                    text: word.into(),
                    conf: 0.9,
                    bbox: (0.0, 0.0, 0.1, 0.1),
                    words: vec![(word.into(), (x / 400.0, 0.5, 0.05, height / 200.0))],
                }],
            )
        }
        // scale 1: "AA" height 9.5 is size 10. "is" height 12.75 is 17, past 1.5×, so it stays.
        let items = observations_to_items(&[obs("AA", 10.0, 9.5), obs("is", 80.0, 12.75)], 1.0, (400, 200), None);
        let aa = items.iter().find(|i| i.text == "AA").unwrap();
        let is_ = items.iter().find(|i| i.text == "is").unwrap();
        assert!((aa.transform[0] - 10.0).abs() < 0.05, "{aa:?}");
        assert!(is_.transform[0] > aa.transform[0] * 1.5, "a word past 1.5× body stays large: {}", is_.transform[0]);
    }

    #[test]
    fn line_metrics_clusters_snap_and_merge() {
        let (size, base) = line_metrics("1980", 10.0, 15.0);
        assert!((size - 5.0 / 0.95).abs() < 1e-9);
        assert!((base - (15.0 - 0.03 * size)).abs() < 1e-9);
        let (_size2, base2) = line_metrics("gyp", 10.0, 15.0);
        assert!(base2 < 15.0);
        let boxes = [
            BoxWord { word: "a".into(), px0: 0.0, px1: 1.0, py0: 0.0, py1: 1.0, size: 6.0, base: 10.0 },
            BoxWord { word: "b".into(), px0: 0.0, px1: 1.0, py0: 0.0, py1: 1.0, size: 6.0, base: 10.5 },
            BoxWord { word: "c".into(), px0: 0.0, px1: 1.0, py0: 0.0, py1: 1.0, size: 6.0, base: 17.0 },
        ];
        assert_eq!(baseline_clusters(&boxes).iter().map(|c| c.len()).collect::<Vec<_>>(), vec![2, 1]);
        let mut items = vec![
            Cand { text: "a".into(), x0: 0.0, y0: 0.0, x1: 1.0, y1: 1.0, size: 6.0, base: 10.0, conf: 1.0, margin: 1.0 },
            Cand { text: "b".into(), x0: 0.0, y0: 0.0, x1: 1.0, y1: 1.0, size: 6.0, base: 11.0, conf: 1.0, margin: 1.0 },
            Cand { text: "c".into(), x0: 0.0, y0: 0.0, x1: 1.0, y1: 1.0, size: 6.0, base: 16.0, conf: 1.0, margin: 1.0 },
        ];
        snap_baselines(&mut items);
        assert_eq!(items.iter().map(|i| i.base).collect::<Vec<_>>(), vec![10.0, 10.0, 16.0]);

        let raw = vec![
            word("0.00", 10.0, 12.0),
            word("Anth", 30.0, 12.0),
            word("rax", 43.0, 9.0),
            word("Laprosy", 60.0, 20.0),
        ];
        let corrected = vec![word("o.oo", 10.0, 12.0), word("Anthrax", 30.0, 22.0), word("Leprosy", 60.0, 20.0)];
        let out = merge_corrected(raw, corrected);
        assert_eq!(out.iter().map(|i| i.text.as_str()).collect::<Vec<_>>(), ["0.00", "Anthrax", "Leprosy"]);
        assert_eq!(out[2].raw.as_deref(), Some("Laprosy"));
    }

    fn word(text: &str, x: f64, width: f64) -> WordItem {
        WordItem {
            text: text.into(),
            transform: [6.0, 0.0, 0.0, 6.0, x, 20.0],
            width,
            height: 6.0,
            y0: 15.0,
            y1: 21.0,
            font_name: "ocr",
            conf: 1.0,
            raw: None,
        }
    }

    #[test]
    fn tile_grid_covers_with_overlap() {
        let tiles = tile_grid(1000, 600, TILE_COLS, TILE_ROWS, TILE_OVERLAP_PX);
        assert_eq!(tiles.len(), (TILE_COLS * TILE_ROWS) as usize);
        assert_eq!((tiles[0].0, tiles[0].1), (0, 0));
        let last = tiles.last().unwrap();
        assert_eq!((last.2, last.3), (1000, 600));
        assert!(tiles[1].0 < tiles[0].2);
    }

    fn word_box(y0: f64, y1: f64) -> Cand {
        Cand {
            text: "of".into(),
            x0: 2.0,
            y0,
            x1: 14.0,
            y1,
            size: 8.0,
            base: 0.0,
            conf: 1.0,
            margin: 1.0,
        }
    }

    #[test]
    fn ink_baseline_ignores_a_row_below_a_quarter_of_the_peak() {
        // Peak 10, so a quarter is 2.5. A following row of 2 pixels is not body
        // (base stays 7). Counting it would drop the baseline onto that row (base 8).
        let mut img = image::GrayImage::from_pixel(16, 12, image::Luma([255]));
        for y in 4..7 {
            for x in 2..12 {
                img.put_pixel(x, y, image::Luma([0]));
            }
        }
        img.put_pixel(2, 7, image::Luma([0]));
        img.put_pixel(3, 7, image::Luma([0]));
        let mut cands = vec![word_box(2.0, 10.0)];
        refine_by_ink(&mut cands, &img, 1.0);
        assert_eq!(cands[0].base, 7.0);
    }

    #[test]
    fn ink_baseline_does_not_bridge_into_the_next_line() {
        // The same 2-pixel row, with a second line whose bottom is more than 8px
        // below, is the next line. The baseline stays on the upper line (base 9).
        let mut img = image::GrayImage::from_pixel(16, 19, image::Luma([255]));
        for y in 6..9 {
            for x in 2..12 {
                img.put_pixel(x, y, image::Luma([0]));
            }
        }
        img.put_pixel(2, 9, image::Luma([0]));
        img.put_pixel(3, 9, image::Luma([0]));
        for y in 10..18 {
            for x in 2..12 {
                img.put_pixel(x, y, image::Luma([0]));
            }
        }
        let mut cands = vec![word_box(2.0, 17.0)];
        refine_by_ink(&mut cands, &img, 1.0);
        assert_eq!(cands[0].base, 9.0);
    }

    #[test]
    fn page_record_shape() {
        let rec = page_record(3, Vec::new(), Vec::new(), 612.0, 792.0, DPI, 0.4, Vec::new());
        assert_eq!(rec.n, 3);
        assert!(rec.scan);
        assert_eq!(rec.transform, [1.0, 0.0, 0.0, 1.0, 0.0, 0.0]);
        assert_eq!(rec.w, 612.0);
        assert_eq!(rec.h, 792.0);
        assert_eq!(rec.deskew, 0.4);
        assert!(rec.ink.is_empty());
    }
}
