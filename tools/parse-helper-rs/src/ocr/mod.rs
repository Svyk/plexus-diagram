//! Apple Vision OCR with the Python helper's page-record shape (`pxd-ocr/1`).

mod geom;
mod imageops;
mod run;
mod vision;

pub use run::{ocr_cells, ocr_pdf};

use std::path::Path;

use pdfium_render::prelude::Pdfium;
use serde_json::Value;

pub fn run_pdf(pdfium: &Pdfium, path: &Path, pages: Option<&Value>, on_page: impl FnMut(i32, usize)) -> Result<Value, String> {
    ocr_pdf(pdfium, path, pages, on_page)
}

pub fn run_cells(pdfium: &Pdfium, path: &Path, cells: &[Value]) -> Result<Value, String> {
    ocr_cells(pdfium, path, cells)
}
