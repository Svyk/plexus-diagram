//! Apple Vision `VNRecognizeTextRequest`, accurate, same knobs as `ocr.py`.

use std::io::Cursor;

use image::GrayImage;
use objc2::rc::autoreleasepool;
use objc2::runtime::AnyObject;
use objc2::{AnyThread, ClassType};
use objc2_foundation::{NSArray, NSData, NSDictionary, NSError, NSRange};
use objc2_vision::{
    VNImageOption, VNImageRequestHandler, VNRecognizeTextRequest, VNRequest, VNRequestTextRecognitionLevel,
};

use super::geom::Observation;

pub fn recognize(img: &GrayImage, language_correction: bool) -> Result<Vec<Observation>, String> {
    let png = png_bytes(img)?;
    autoreleasepool(|_pool| unsafe { recognize_png(&png, language_correction) })
}

fn png_bytes(img: &GrayImage) -> Result<Vec<u8>, String> {
    let mut buf = Cursor::new(Vec::new());
    let encoder = image::codecs::png::PngEncoder::new(&mut buf);
    use image::ImageEncoder;
    encoder
        .write_image(img.as_raw(), img.width(), img.height(), image::ExtendedColorType::L8)
        .map_err(|err| err.to_string())?;
    Ok(buf.into_inner())
}

unsafe fn recognize_png(png: &[u8], language_correction: bool) -> Result<Vec<Observation>, String> {
    let data = NSData::with_bytes(png);
    let request = VNRecognizeTextRequest::new();
    request.setRecognitionLevel(VNRequestTextRecognitionLevel::Accurate);
    request.setUsesLanguageCorrection(language_correction);
    request.setMinimumTextHeight(0.0);
    let as_request: &VNRequest = request.as_super().as_super();
    let batch = NSArray::from_slice(&[as_request]);
    let options = NSDictionary::<VNImageOption, AnyObject>::new();
    let handler = VNImageRequestHandler::initWithData_options(VNImageRequestHandler::alloc(), &data, &options);
    handler.performRequests_error(&batch).map_err(|err| ns_error(&err))?;
    let Some(results) = request.results() else {
        return Ok(Vec::new());
    };
    let mut out = Vec::new();
    for obs in results.iter() {
        let candidates = obs.topCandidates(1);
        let Some(cand) = candidates.iter().next() else { continue };
        let text = cand.string().to_string();
        let obox = cg_box(obs.boundingBox());
        let mut words = Vec::new();
        let mut pos = 0usize;
        for word in py_split(&text) {
            let start = text[pos..].find(word).map(|i| pos + i).unwrap_or(pos);
            pos = start + word.len();
            let range = NSRange {
                location: utf16_index(&text, char_index_at(&text, start)),
                length: utf16_len(word),
            };
            match cand.boundingBoxForRange_error(range) {
                Ok(rect) => words.push((word.to_string(), cg_box(rect.boundingBox()))),
                Err(_) => words.push((word.to_string(), apportion(obox, &text, char_index_at(&text, start), word.chars().count()))),
            }
        }
        out.push(Observation { text, conf: cand.confidence() as f64, bbox: obox, words });
    }
    Ok(out)
}

fn ns_error(err: &NSError) -> String {
    err.localizedDescription().to_string()
}

fn cg_box(rect: objc2_core_foundation::CGRect) -> (f64, f64, f64, f64) {
    (rect.origin.x, rect.origin.y, rect.size.width, rect.size.height)
}

fn py_split(text: &str) -> Vec<&str> {
    text.split_whitespace().collect()
}

fn char_index_at(text: &str, byte: usize) -> usize {
    text[..byte.min(text.len())].chars().count()
}

fn utf16_index(text: &str, char_index: usize) -> usize {
    text.chars().take(char_index).map(|c| c.len_utf16()).sum()
}

fn utf16_len(word: &str) -> usize {
    word.chars().map(|c| c.len_utf16()).sum()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::pdf;
    use image::imageops;
    use std::path::Path;

    #[test]
    fn vision_reads_a_cdc_crop() {
        let pdfium = pdf::bind(Path::new(concat!(env!("CARGO_MANIFEST_DIR"), "/vendor/libpdfium.dylib"))).unwrap();
        let doc = pdf::open(
            &pdfium,
            Path::new(concat!(env!("CARGO_MANIFEST_DIR"), "/../../test/fixtures/pdf/cdc1980-p25-imageonly.pdf")),
        )
        .unwrap();
        let rendered = pdf::render_open(&doc, 1, 300).unwrap();
        let crop = imageops::crop_imm(&rendered.image, 400, 400, 900, 500).to_image();
        let obs = recognize(&crop, false).unwrap();
        let texts: Vec<_> = obs.iter().map(|o| o.text.as_str()).take(8).collect();
        eprintln!("obs {} {:?}", obs.len(), texts);
        assert!(!obs.is_empty(), "vision returned no text");
    }
}

fn apportion(bbox: (f64, f64, f64, f64), text: &str, start: usize, length: usize) -> (f64, f64, f64, f64) {
    let n = text.chars().count().max(1) as f64;
    let (x, y, w, h) = bbox;
    (x + w * start as f64 / n, y, w * length as f64 / n, h)
}
