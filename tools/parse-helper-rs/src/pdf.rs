//! Page renders through pdfium-render and a downloaded `libpdfium.dylib`.

use std::path::Path;

use image::GrayImage;
use pdfium_render::prelude::*;

pub struct RenderedPage {
    pub image: GrayImage,
    pub w_pt: f64,
    pub h_pt: f64,
}

pub fn bind(path: &Path) -> Result<Pdfium, String> {
    let bindings = Pdfium::bind_to_library(path).map_err(|err| format!("libpdfium at {}: {err}", path.display()))?;
    Ok(Pdfium::new(bindings))
}

pub fn page_count(pdfium: &Pdfium, path: &Path) -> Result<usize, String> {
    let doc = open(pdfium, path)?;
    Ok(doc.pages().len() as usize)
}

pub fn open<'a>(pdfium: &'a Pdfium, path: &Path) -> Result<PdfDocument<'a>, String> {
    pdfium.load_pdf_from_file(path, None).map_err(|err| format!("not a pdf: {err}"))
}

pub fn render_open(doc: &PdfDocument<'_>, page_no: i32, dpi: i32) -> Result<RenderedPage, String> {
    let count = doc.pages().len() as i32;
    if page_no < 1 || page_no > count {
        return Err(format!("page {page_no} outside 1..={count}"));
    }
    let page = doc.pages().get((page_no - 1) as u16).map_err(|err| err.to_string())?;
    render_one(&page, dpi)
}

fn render_one(page: &PdfPage<'_>, dpi: i32) -> Result<RenderedPage, String> {
    // pypdfium2 uses ceil(points * dpi / 72) and a gray bitmap. pdfium-render turns
    // FPDF_REVERSE_BYTE_ORDER on by default, which blanks gray renders, so turn it off.
    let scale = dpi as f64 / 72.0;
    let w_px = (page.width().value as f64 * scale).ceil() as i32;
    let h_px = (page.height().value as f64 * scale).ceil() as i32;
    if w_px <= 0 || h_px <= 0 {
        return Err("page has no pixels".into());
    }
    let config = PdfRenderConfig::new()
        .set_target_size(w_px, h_px)
        .set_format(PdfBitmapFormat::Gray)
        .set_reverse_byte_order(false)
        .use_grayscale_rendering(true);
    let bitmap = page.render_with_config(&config).map_err(|err| err.to_string())?;
    let image = gray_image(&bitmap)?;
    let w_pt = image.width() as f64 * 72.0 / dpi as f64;
    let h_pt = image.height() as f64 * 72.0 / dpi as f64;
    Ok(RenderedPage { image, w_pt, h_pt })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn cdc_render_has_ink() {
        let pdfium = bind(Path::new(concat!(env!("CARGO_MANIFEST_DIR"), "/vendor/libpdfium.dylib"))).unwrap();
        let path = Path::new(concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/../../test/fixtures/pdf/cdc1980-p25-imageonly.pdf"
        ));
        let doc = open(&pdfium, path).unwrap();
        let rendered = render_open(&doc, 1, 300).unwrap();
        let ink = rendered.image.as_raw().iter().filter(|p| **p < 200).count();
        assert_eq!((rendered.image.width(), rendered.image.height()), (2489, 1688));
        // Same ink count as pypdfium2 grayscale at 300 dpi (pixels below 200).
        assert_eq!(ink, 459_528);
    }
}

fn gray_image(bitmap: &PdfBitmap<'_>) -> Result<GrayImage, String> {
    let raw = bitmap.as_raw_bytes();
    let w = bitmap.width() as usize;
    let h = bitmap.height() as usize;
    if w == 0 || h == 0 || raw.len() < w * h {
        return Err("empty pdfium bitmap".into());
    }
    let stride = raw.len() / h;
    if stride < w {
        return Err(format!("pdfium stride {stride} < width {w}"));
    }
    let mut pixels = Vec::with_capacity(w * h);
    for row in 0..h {
        let start = row * stride;
        pixels.extend_from_slice(&raw[start..start + w]);
    }
    GrayImage::from_raw(w as u32, h as u32, pixels).ok_or_else(|| "gray image".into())
}
