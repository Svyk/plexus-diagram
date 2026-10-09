//! SLANet-plus table structure. The ONNX file is downloaded on first use, checked
//! against its SHA-256, and kept under the helper cache. It is not in git.
//!
//! Preprocess and decode follow RapidTable's SLANet-plus path: gray stacked to
//! three equal channels, ImageNet norm, pad top-left to 488, then the HTML token
//! grid. Cell text is filled later from Vision words.

use std::fs;
use std::path::{Path, PathBuf};
use std::time::Duration;

use image::imageops;
use image::{GrayImage, Luma};
use ndarray::Array4;
use ort::session::Session;
use ort::value::TensorRef;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};

use crate::cache::default_cache_root;
use crate::hashutil::sha256_hex;

pub const MODEL_NAME: &str = "slanet-plus";
pub const MODEL_SHA: &str = "d57a942af6a2f57d6a4a0372573c696a2379bf5857c45e2ac69993f3b334514b";
const MODEL_URL: &str = "https://www.modelscope.cn/models/RapidAI/RapidTable/resolve/v2.0.0/slanet-plus.onnx";
const SIDE: usize = 488;
const PAD_PT: f64 = 6.0;
const SCALE: f64 = 300.0 / 72.0;

const VOCAB: [&str; 50] = [
    "sos",
    "<thead>",
    "</thead>",
    "<tbody>",
    "</tbody>",
    "<tr>",
    "</tr>",
    "<td",
    ">",
    "</td>",
    " colspan=\"2\"",
    " colspan=\"3\"",
    " colspan=\"4\"",
    " colspan=\"5\"",
    " colspan=\"6\"",
    " colspan=\"7\"",
    " colspan=\"8\"",
    " colspan=\"9\"",
    " colspan=\"10\"",
    " colspan=\"11\"",
    " colspan=\"12\"",
    " colspan=\"13\"",
    " colspan=\"14\"",
    " colspan=\"15\"",
    " colspan=\"16\"",
    " colspan=\"17\"",
    " colspan=\"18\"",
    " colspan=\"19\"",
    " colspan=\"20\"",
    " rowspan=\"2\"",
    " rowspan=\"3\"",
    " rowspan=\"4\"",
    " rowspan=\"5\"",
    " rowspan=\"6\"",
    " rowspan=\"7\"",
    " rowspan=\"8\"",
    " rowspan=\"9\"",
    " rowspan=\"10\"",
    " rowspan=\"11\"",
    " rowspan=\"12\"",
    " rowspan=\"13\"",
    " rowspan=\"14\"",
    " rowspan=\"15\"",
    " rowspan=\"16\"",
    " rowspan=\"17\"",
    " rowspan=\"18\"",
    " rowspan=\"19\"",
    " rowspan=\"20\"",
    "<td></td>",
    "eos",
];

pub fn model_path() -> PathBuf {
    default_cache_root().join("models").join("slanet-plus.onnx")
}

pub fn model_ready() -> bool {
    let path = model_path();
    path.is_file() && sha256_file(&path).as_deref() == Some(MODEL_SHA)
}

fn sha256_file(path: &Path) -> Option<String> {
    let bytes = fs::read(path).ok()?;
    Some(sha256_hex(&bytes))
}

pub async fn ensure_model() -> Result<PathBuf, String> {
    let path = model_path();
    if model_ready() {
        return Ok(path);
    }
    if path.is_file() {
        let _ = fs::remove_file(&path);
    }
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|err| err.to_string())?;
    }
    let client = reqwest::Client::builder()
        .connect_timeout(Duration::from_secs(15))
        .timeout(Duration::from_secs(120))
        .redirect(reqwest::redirect::Policy::limited(5))
        .build()
        .map_err(|err| err.to_string())?;
    let bytes = client
        .get(MODEL_URL)
        .send()
        .await
        .map_err(|err| format!("slanet download: {err}"))?
        .error_for_status()
        .map_err(|err| format!("slanet download: {err}"))?
        .bytes()
        .await
        .map_err(|err| format!("slanet download: {err}"))?;
    let got = hex::encode(Sha256::digest(&bytes));
    if got != MODEL_SHA {
        return Err(format!("slanet-plus sha256 {got} != {MODEL_SHA}"));
    }
    let tmp = path.with_extension("onnx.part");
    fs::write(&tmp, &bytes).map_err(|err| err.to_string())?;
    fs::rename(&tmp, &path).map_err(|err| err.to_string())?;
    Ok(path)
}

struct Cell {
    r: i64,
    c: i64,
    row_span: i64,
    col_span: i64,
    bbox: [f64; 4],
    header: bool,
}

fn open_session() -> Result<Session, String> {
    let path = model_path();
    if !model_ready() {
        return Err("slanet-plus is not downloaded".into());
    }
    Session::builder()
        .map_err(|err| err.to_string())?
        .commit_from_file(path)
        .map_err(|err| format!("slanet session: {err}"))
}

pub fn recognize_crop(image: &GrayImage, origin: (u32, u32)) -> Result<Value, String> {
    let mut session = open_session()?;
    recognize_with(&mut session, image, origin)
}

fn recognize_with(session: &mut Session, image: &GrayImage, origin: (u32, u32)) -> Result<Value, String> {
    let (h, w) = (image.height(), image.width());
    if h < 8 || w < 8 {
        return Ok(json!({"rows": 0, "cols": 0, "headerRows": 0, "cells": []}));
    }
    let chw = preprocess(image);
    let input = Array4::from_shape_vec((1, 3, SIDE, SIDE), chw).map_err(|err| err.to_string())?;
    let outputs = session
        .run(ort::inputs!["x" => TensorRef::from_array_view(&input).map_err(|err| err.to_string())?])
        .map_err(|err| format!("slanet run: {err}"))?;
    let loc = outputs["save_infer_model/scale_0.tmp_0"]
        .try_extract_array::<f32>()
        .map_err(|err| err.to_string())?;
    let prob = outputs["save_infer_model/scale_1.tmp_0"]
        .try_extract_array::<f32>()
        .map_err(|err| err.to_string())?;
    let cells = decode(&loc, &prob, h, w, origin);
    let rows = cells.iter().map(|c| c.r + c.row_span).max().unwrap_or(0);
    let cols = cells.iter().map(|c| c.c + c.col_span).max().unwrap_or(0);
    let header_rows = {
        let mut n = 0;
        while n < rows && cells.iter().filter(|c| c.r == n).all(|c| c.header) && cells.iter().any(|c| c.r == n) {
            n += 1;
        }
        n
    };
    Ok(json!({
        "rows": rows,
        "cols": cols,
        "headerRows": header_rows,
        "cells": cells.into_iter().map(|c| json!({
            "r": c.r,
            "c": c.c,
            "rowSpan": c.row_span,
            "colSpan": c.col_span,
            "bbox": c.bbox,
            "header": c.header,
        })).collect::<Vec<_>>(),
    }))
}

/// OpenCV `INTER_LINEAR`: destination pixel (x + 0.5) maps to source ((x + 0.5) * scale - 0.5).
fn resize_linear(image: &GrayImage, nw: u32, nh: u32) -> GrayImage {
    let mut out = GrayImage::new(nw, nh);
    let sx = image.width() as f32 / nw as f32;
    let sy = image.height() as f32 / nh as f32;
    for y in 0..nh {
        let fy = (y as f32 + 0.5) * sy - 0.5;
        let y0 = fy.floor();
        let wy = fy - y0;
        let y0i = y0 as i32;
        for x in 0..nw {
            let fx = (x as f32 + 0.5) * sx - 0.5;
            let x0 = fx.floor();
            let wx = fx - x0;
            let x0i = x0 as i32;
            let sample = |ix: i32, iy: i32| -> f32 {
                let ix = ix.clamp(0, image.width() as i32 - 1) as u32;
                let iy = iy.clamp(0, image.height() as i32 - 1) as u32;
                image.get_pixel(ix, iy)[0] as f32
            };
            let v = sample(x0i, y0i) * (1.0 - wx) * (1.0 - wy)
                + sample(x0i + 1, y0i) * wx * (1.0 - wy)
                + sample(x0i, y0i + 1) * (1.0 - wx) * wy
                + sample(x0i + 1, y0i + 1) * wx * wy;
            out.put_pixel(x, y, Luma([v.round().clamp(0.0, 255.0) as u8]));
        }
    }
    out
}

fn preprocess(image: &GrayImage) -> Vec<f32> {
    let (h, w) = (image.height().max(1), image.width().max(1));
    let ratio = (SIDE as f32) / (h.max(w) as f32);
    let nw = ((w as f32) * ratio) as u32;
    let nh = ((h as f32) * ratio) as u32;
    let nw = nw.max(1).min(SIDE as u32);
    let nh = nh.max(1).min(SIDE as u32);
    let resized = resize_linear(image, nw, nh);
    let mean = [0.485_f32, 0.456, 0.406];
    let std = [0.229_f32, 0.224, 0.225];
    let mut chw = vec![0.0; 3 * SIDE * SIDE];
    for y in 0..nh {
        for x in 0..nw {
            let g = resized.get_pixel(x, y)[0] as f32 / 255.0;
            for c in 0..3 {
                chw[c * SIDE * SIDE + y as usize * SIDE + x as usize] = (g - mean[c]) / std[c];
            }
        }
    }
    chw
}

fn decode(loc: &ndarray::ArrayViewD<f32>, prob: &ndarray::ArrayViewD<f32>, h: u32, w: u32, origin: (u32, u32)) -> Vec<Cell> {
    let seq = prob.shape().get(1).copied().unwrap_or(0);
    let classes = prob.shape().get(2).copied().unwrap_or(0);
    let mut tokens = Vec::new();
    let mut boxes = Vec::new();
    for i in 0..seq {
        let mut best = 0usize;
        let mut best_v = f32::NEG_INFINITY;
        for c in 0..classes {
            let v = prob[[0, i, c]];
            if v > best_v {
                best_v = v;
                best = c;
            }
        }
        if i > 0 && best + 1 == VOCAB.len() {
            break;
        }
        if best == 0 || best + 1 == VOCAB.len() || best >= VOCAB.len() {
            continue;
        }
        let text = VOCAB[best];
        if text == "<td" || text == "<td></td>" {
            let mut bb = [0.0_f64; 8];
            for k in 0..8 {
                let raw = loc[[0, i, k]] as f64;
                bb[k] = if k % 2 == 0 { raw * w as f64 } else { raw * h as f64 };
            }
            boxes.push(bb);
        }
        tokens.push(text);
    }
    let ratio = (SIDE as f64 / h as f64).min(SIDE as f64 / w as f64);
    if ratio > 0.0 {
        let sx = SIDE as f64 / (w as f64 * ratio);
        let sy = SIDE as f64 / (h as f64 * ratio);
        for bb in &mut boxes {
            for k in 0..8 {
                if k % 2 == 0 {
                    bb[k] *= sx;
                } else {
                    bb[k] *= sy;
                }
            }
        }
    }
    let points = logic_points(&tokens);
    let header_rows = thead_rows(&tokens, &points);
    let mut cells = Vec::new();
    for (point, bb) in points.iter().zip(boxes.iter()) {
        let xs = [bb[0], bb[2], bb[4], bb[6]];
        let ys = [bb[1], bb[3], bb[5], bb[7]];
        let x0 = xs.into_iter().fold(f64::INFINITY, f64::min);
        let x1 = xs.into_iter().fold(f64::NEG_INFINITY, f64::max);
        let y0 = ys.into_iter().fold(f64::INFINITY, f64::min);
        let y1 = ys.into_iter().fold(f64::NEG_INFINITY, f64::max);
        if x1 - x0 < 1.0 || y1 - y0 < 1.0 {
            continue;
        }
        let (ox, oy) = origin;
        cells.push(Cell {
            r: point[0],
            c: point[2],
            row_span: point[1] - point[0] + 1,
            col_span: point[3] - point[2] + 1,
            bbox: [
                (x0 + ox as f64) / SCALE,
                (y0 + oy as f64) / SCALE,
                (x1 + ox as f64) / SCALE,
                (y1 + oy as f64) / SCALE,
            ],
            header: point[0] < header_rows,
        });
    }
    cells
}

fn logic_points(tokens: &[&str]) -> Vec<[i64; 4]> {
    let mut points = Vec::new();
    let mut row = 0_i64;
    let mut col = 0_i64;
    let mut occupied = std::collections::BTreeSet::new();
    let mut i = 0;
    while i < tokens.len() {
        let token = tokens[i];
        if token == "<tr>" {
            col = 0;
        } else if token == "</tr>" {
            row += 1;
        } else if token.starts_with("<td") {
            let mut colspan = 1_i64;
            let mut rowspan = 1_i64;
            let mut j = i;
            if token != "<td></td>" {
                j += 1;
                while j < tokens.len() && !tokens[j].starts_with('>') {
                    if tokens[j].contains("colspan=") {
                        colspan = attr_int(tokens[j]);
                    } else if tokens[j].contains("rowspan=") {
                        rowspan = attr_int(tokens[j]);
                    }
                    j += 1;
                }
            }
            i = j;
            while occupied.contains(&(row, col)) {
                col += 1;
            }
            points.push([row, row + rowspan - 1, col, col + colspan - 1]);
            for rr in row..(row + rowspan) {
                for cc in col..(col + colspan) {
                    occupied.insert((rr, cc));
                }
            }
            col += colspan;
        }
        i += 1;
    }
    points
}

fn attr_int(token: &str) -> i64 {
    token
        .split_once('=')
        .map(|(_, rest)| rest.trim_matches(|c| c == '"' || c == '\'').parse().unwrap_or(1))
        .unwrap_or(1)
}

fn thead_rows(tokens: &[&str], points: &[[i64; 4]]) -> i64 {
    let mut in_head = false;
    let mut td = 0usize;
    let mut rows = std::collections::BTreeSet::new();
    let mut i = 0;
    while i < tokens.len() {
        let token = tokens[i];
        if token == "<thead>" {
            in_head = true;
        } else if token == "</thead>" {
            in_head = false;
        } else if token.starts_with("<td") {
            if in_head {
                if let Some(point) = points.get(td) {
                    rows.insert(point[0]);
                }
            }
            td += 1;
            if token != "<td></td>" {
                let mut j = i + 1;
                while j < tokens.len() && !tokens[j].starts_with('>') {
                    j += 1;
                }
                i = j;
            }
        }
        i += 1;
    }
    let mut n = 0;
    while rows.contains(&n) {
        n += 1;
    }
    n
}

pub fn crop_region(image: &GrayImage, bbox: [f64; 4]) -> Option<(GrayImage, (u32, u32))> {
    let w = image.width();
    let h = image.height();
    let x0 = ((bbox[0] - PAD_PT) * SCALE).floor().max(0.0) as u32;
    let y0 = ((bbox[1] - PAD_PT) * SCALE).floor().max(0.0) as u32;
    let x1 = ((bbox[2] + PAD_PT) * SCALE).ceil().max(0.0) as u32;
    let y1 = ((bbox[3] + PAD_PT) * SCALE).ceil().max(0.0) as u32;
    let x0 = x0.min(w.saturating_sub(1));
    let y0 = y0.min(h.saturating_sub(1));
    let x1 = x1.min(w);
    let y1 = y1.min(h);
    if x1.saturating_sub(x0) < 8 || y1.saturating_sub(y0) < 8 {
        return None;
    }
    Some((imageops::crop_imm(image, x0, y0, x1 - x0, y1 - y0).to_image(), (x0, y0)))
}

/// One page raster and the request regions on that page.
pub fn tables_on_page(image: &GrayImage, page: i64, regions: &[Value]) -> Result<Vec<Value>, String> {
    let mut session = open_session()?;
    let mut out = Vec::new();
    for region in regions {
        let bbox = match region.get("bbox").and_then(Value::as_array) {
            Some(items) if items.len() == 4 => items,
            _ => continue,
        };
        let mut nums = [0.0; 4];
        let mut ok = true;
        for (i, value) in bbox.iter().enumerate() {
            match value.as_f64() {
                Some(n) => nums[i] = n,
                None => ok = false,
            }
        }
        if !ok {
            continue;
        }
        let Some((crop, origin)) = crop_region(image, nums) else { continue };
        let mut table = recognize_with(&mut session, &crop, origin)?;
        if table.get("cells").and_then(Value::as_array).map(|c| c.is_empty()).unwrap_or(true) {
            continue;
        }
        if let Some(obj) = table.as_object_mut() {
            obj.insert("page".into(), json!(page));
            obj.insert("bbox".into(), json!(nums));
        }
        out.push(table);
    }
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn spanned_header_grid_matches_the_html_tokens() {
        let tokens = [
            "<thead>", "<tr>", "<td", " rowspan=\"2\"", ">", "</td>", "<td", " colspan=\"3\"", ">", "</td>", "</tr>",
            "<tr>", "<td></td>", "<td></td>", "<td></td>", "</tr>", "</thead>", "<tr>", "<td></td>", "<td></td>",
            "<td></td>", "<td></td>", "</tr>",
        ];
        let points = logic_points(&tokens);
        assert_eq!(
            points,
            vec![[0, 1, 0, 0], [0, 0, 1, 3], [1, 1, 1, 1], [1, 1, 2, 2], [1, 1, 3, 3], [2, 2, 0, 0], [2, 2, 1, 1], [2, 2, 2, 2], [2, 2, 3, 3]]
        );
        assert_eq!(thead_rows(&tokens, &points), 2);
    }

    #[test]
    fn rescale_uses_the_unpadded_side() {
        // h=100, w=50. ratio = min(488/100, 488/50) = 4.88. x grows by 2, y stays.
        let ratio = (488.0_f64 / 100.0).min(488.0 / 50.0);
        let sx = 488.0 / (50.0 * ratio);
        let sy = 488.0 / (100.0 * ratio);
        assert!((sx - 2.0).abs() < 1e-9);
        assert!((sy - 1.0).abs() < 1e-9);
    }

    #[test]
    fn python_crop_matches_when_the_bench_file_is_present() {
        let path = std::path::Path::new("/tmp/pxd-table-bench/crop-p12.png");
        if !path.is_file() || !model_path().is_file() {
            return;
        }
        let image = image::open(path).expect("png").into_luma8();
        let table = recognize_crop(&image, (160, 218)).expect("run");
        assert_eq!(table["rows"], 3, "{table}");
        assert_eq!(table["cols"], 7, "{table}");
        let cells = table["cells"].as_array().unwrap();
        assert_eq!(cells.len(), 16, "{table}");
        assert_eq!(cells[0]["r"], 0);
        assert_eq!(cells[0]["rowSpan"], 2);
        assert_eq!(cells[0]["colSpan"], 1);
        assert_eq!(cells[1]["colSpan"], 3);
        let bbox = cells[0]["bbox"].as_array().unwrap();
        let x0 = bbox[0].as_f64().unwrap();
        assert!((x0 - 46.98).abs() < 1.5, "x0 {x0}");
    }

    #[test]
    fn cached_model_reads_a_blank_crop() {
        let path = model_path();
        if !path.is_file() {
            return;
        }
        assert_eq!(sha256_file(&path).as_deref(), Some(MODEL_SHA));
        let image = GrayImage::from_pixel(80, 40, Luma([255]));
        let table = recognize_crop(&image, (0, 0)).expect("run");
        assert!(table.get("cells").and_then(Value::as_array).is_some());
    }
}
