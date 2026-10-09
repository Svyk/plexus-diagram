//! Page and cell OCR: pdfium render, deskew, rules, tiled Vision, the same record shape as `ocr.py`.

use std::collections::HashMap;
use std::path::Path;

use image::{imageops, GrayImage, Luma};
use pdfium_render::prelude::Pdfium;
use serde_json::{json, Value};

use super::geom::{
    merge_corrected, observations_to_items, page_record, tile_grid, Observation, PageRecord, Tile, CELL_PAD_PT,
    CELL_SCALE, DPI, MAX_PAGES, TILE_COLS, TILE_FULL, TILE_MAX_DEPTH, TILE_OVERLAP_PX, TILE_ROWS,
};
use super::spell::{lexicon, prefer_spellings};
use super::imageops::{deskew, deskew_angle, ink_glyph, rules_from_image};
use super::vision;
use crate::pdf;

pub fn expand_pages(spec: Option<&Value>, page_count: i32) -> Result<Vec<i32>, String> {
    let mut pages = Vec::new();
    let absent = match spec {
        None | Some(Value::Null) => true,
        Some(Value::Array(items)) if items.is_empty() => true,
        Some(_) => false,
    };
    if absent {
        pages.extend(1..=page_count);
    } else {
        let items = spec.and_then(|v| v.as_array()).ok_or_else(|| format!("bad page spec {}", spec.unwrap_or(&Value::Null)))?;
        for item in items {
            if let Some(n) = item.as_i64() {
                pages.push(n as i32);
            } else if let Some(pair) = item.as_array() {
                if pair.len() != 2 {
                    return Err(format!("bad page spec {item}"));
                }
                let Some(mut start) = pair[0].as_i64() else { return Err(format!("bad page spec {item}")) };
                let Some(mut end) = pair[1].as_i64() else { return Err(format!("bad page spec {item}")) };
                if end < start {
                    std::mem::swap(&mut start, &mut end);
                }
                for n in start..=end {
                    pages.push(n as i32);
                }
            } else {
                return Err(format!("bad page spec {item}"));
            }
        }
    }
    let mut out: Vec<i32> = pages.into_iter().filter(|p| (1..=page_count).contains(p)).collect();
    out.sort_unstable();
    out.dedup();
    if out.len() > 400 {
        return Err("page range cap is 400".into());
    }
    if out.is_empty() {
        return Err("no pages in range".into());
    }
    Ok(out)
}

pub fn ocr_pdf(pdfium: &Pdfium, path: &Path, pages: Option<&Value>, mut on_page: impl FnMut(i32, usize)) -> Result<Value, String> {
    let doc = pdf::open(pdfium, path)?;
    let count = doc.pages().len() as i32;
    let selected = expand_pages(pages, count)?;
    if selected.len() > MAX_PAGES {
        return Err(format!("ocr page cap is {MAX_PAGES}"));
    }
    let mut records = Vec::new();
    for (i, n) in selected.iter().copied().enumerate() {
        let rendered = pdf::render_open(&doc, n, DPI)?;
        records.push(ocr_rendered(&rendered.image, rendered.w_pt, rendered.h_pt, n)?);
        on_page(n, selected.len());
        let _ = i;
    }
    Ok(json!({
        "schema": "pxd-ocr/1",
        "pageCount": count,
        "pages": records,
    }))
}

pub fn ocr_cells(pdfium: &Pdfium, path: &Path, cells: &[Value]) -> Result<Value, String> {
    if cells.len() > 400 {
        return Err("cells cap is 400".into());
    }
    let doc = pdf::open(pdfium, path)?;
    let mut pages: HashMap<i32, GrayImage> = HashMap::new();
    let scale = DPI as f64 / 72.0;
    let mut out = Vec::new();
    for cell in cells {
        let page = cell.get("page").and_then(|v| v.as_i64()).ok_or_else(|| "cell missing page".to_string())? as i32;
        let bbox = cell.get("bbox").ok_or_else(|| "cell missing bbox".to_string())?;
        let coords = bbox_coords(bbox)?;
        if !pages.contains_key(&page) {
            let rendered = pdf::render_open(&doc, page, DPI)?;
            let angle = deskew_angle(&rendered.image);
            pages.insert(page, deskew(&rendered.image, angle));
        }
        let image = pages.get(&page).expect("page render");
        out.push(read_cell(image, page, bbox.clone(), coords, scale)?);
    }
    Ok(json!({ "cells": out }))
}

fn bbox_coords(bbox: &Value) -> Result<(f64, f64, f64, f64), String> {
    let arr = bbox.as_array().ok_or_else(|| "bbox is not a list".to_string())?;
    if arr.len() != 4 {
        return Err("bbox needs 4 numbers".into());
    }
    let mut nums = [0.0; 4];
    for (i, value) in arr.iter().enumerate() {
        nums[i] = value.as_f64().ok_or_else(|| "bbox needs 4 numbers".to_string())?;
    }
    Ok((nums[0], nums[1], nums[2], nums[3]))
}

fn read_cell(img: &GrayImage, page: i32, bbox: Value, (x0, y0, x1, y1): (f64, f64, f64, f64), scale: f64) -> Result<Value, String> {
    let crop = crop_px(
        img,
        ((x0 - CELL_PAD_PT) * scale).floor().max(0.0) as u32,
        ((y0 - CELL_PAD_PT) * scale).floor().max(0.0) as u32,
        ((x1 + CELL_PAD_PT) * scale).ceil().max(0.0) as u32,
        ((y1 + CELL_PAD_PT) * scale).ceil().max(0.0) as u32,
    );
    if crop.width() < 2 || crop.height() < 2 {
        return Ok(json!({"page": page, "bbox": bbox, "text": "", "conf": 0}));
    }
    let big = imageops::resize(&crop, crop.width() * CELL_SCALE, crop.height() * CELL_SCALE, imageops::FilterType::CatmullRom);
    let mut canvas = GrayImage::from_pixel(big.width() + 48, big.height() + 48, Luma([255]));
    imageops::overlay(&mut canvas, &big, 24, 24);
    let mut observations = vision::recognize(&canvas, false)?;
    observations.sort_by(|a, b| b.bbox.1.partial_cmp(&a.bbox.1).unwrap_or(std::cmp::Ordering::Equal).then(a.bbox.0.partial_cmp(&b.bbox.0).unwrap_or(std::cmp::Ordering::Equal)));
    let text = observations.iter().map(|o| o.text.as_str()).collect::<Vec<_>>().join(" ");
    let text = text.trim().to_string();
    let conf = observations.iter().map(|o| o.conf).reduce(f64::min).unwrap_or(0.0);
    let tight = crop_px(
        img,
        ((x0 - 0.5) * scale).floor().max(0.0) as u32,
        ((y0 - 0.5) * scale).floor().max(0.0) as u32,
        ((x1 + 0.5) * scale).ceil().max(0.0) as u32,
        ((y1 + 0.5) * scale).ceil().max(0.0) as u32,
    );
    let glyph = if tight.width() >= 2 && tight.height() >= 2 { ink_glyph(&tight) } else { None };
    Ok(json!({
        "page": page,
        "bbox": bbox,
        "text": text,
        "conf": (conf * 1000.0).round() / 1000.0,
        "glyph": glyph,
    }))
}

fn ocr_rendered(img: &GrayImage, w_pt: f64, h_pt: f64, n: i32) -> Result<PageRecord, String> {
    let scale = DPI as f64 / 72.0;
    let angle = deskew_angle(img);
    let img = deskew(img, angle);
    let rules = rules_from_image(&img, scale);
    let tiled = ocr_tiles(&img, &mut |tile| vision::recognize(tile, false), 0, None)?;
    let mut items = observations_to_items(&tiled, scale, (img.width(), img.height()), Some(&img));
    let corrected = ocr_tiles(&img, &mut |tile| vision::recognize(tile, true), 0, None)?;
    let corrected_items = observations_to_items(&corrected, scale, (img.width(), img.height()), Some(&img));
    items = merge_corrected(items, corrected_items);
    items = prefer_spellings(items, &rules, w_pt, h_pt, lexicon());
    Ok(page_record(n, items, rules, w_pt, h_pt, DPI, angle))
}

fn ocr_tiles(
    img: &GrayImage,
    recognize: &mut dyn FnMut(&GrayImage) -> Result<Vec<Observation>, String>,
    depth: i32,
    tiles: Option<Vec<Tile>>,
) -> Result<Vec<(Tile, Vec<Observation>)>, String> {
    let tiles = tiles.unwrap_or_else(|| tile_grid(img.width() as i32, img.height() as i32, TILE_COLS, TILE_ROWS, TILE_OVERLAP_PX));
    let mut out = Vec::new();
    for tile in tiles {
        let (x0, y0, x1, y1) = tile;
        let crop = crop_px(img, x0.max(0) as u32, y0.max(0) as u32, x1.max(0) as u32, y1.max(0) as u32);
        let obs = recognize(&crop)?;
        if obs.len() >= TILE_FULL && depth < TILE_MAX_DEPTH && (x1 - x0) > 200 && (y1 - y0) > 200 {
            let sub = tile_grid(x1 - x0, y1 - y0, 2, 2, TILE_OVERLAP_PX);
            let shifted = sub.into_iter().map(|(a, b, c, d)| (x0 + a, y0 + b, x0 + c, y0 + d)).collect();
            out.extend(ocr_tiles(img, recognize, depth + 1, Some(shifted))?);
            continue;
        }
        out.push((tile, obs));
    }
    Ok(out)
}

fn crop_px(img: &GrayImage, x0: u32, y0: u32, x1: u32, y1: u32) -> GrayImage {
    let x0 = x0.min(img.width());
    let y0 = y0.min(img.height());
    let x1 = x1.min(img.width()).max(x0);
    let y1 = y1.min(img.height()).max(y0);
    imageops::crop_imm(img, x0, y0, x1 - x0, y1 - y0).to_image()
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn expand_pages_keeps_python_rules() {
        assert_eq!(expand_pages(None, 3).unwrap(), vec![1, 2, 3]);
        assert_eq!(expand_pages(Some(&json!([2, [4, 2]])), 5).unwrap(), vec![2, 3, 4]);
        assert!(expand_pages(Some(&json!([9])), 2).is_err());
        assert!(expand_pages(Some(&json!("nope")), 2).is_err());
    }
}
