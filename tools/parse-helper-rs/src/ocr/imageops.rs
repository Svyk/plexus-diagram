//! Deskew, ruling lines, and placeholder glyphs. The morphology matches OpenCV's
//! rectangular kernels (center anchor, constant-0 border) used by `ocr.py`.

use std::collections::VecDeque;

use image::{GrayImage, Luma};
use imageproc::geometric_transformations::{rotate_about_center, Interpolation};
use serde::Serialize;

#[derive(Clone, Debug, Serialize)]
pub struct Rule {
    pub x0: f64,
    pub y0: f64,
    pub x1: f64,
    pub y1: f64,
    pub thick: f64,
}

struct Gray {
    w: usize,
    h: usize,
    data: Vec<u8>,
}

impl Gray {
    fn from_image(img: &GrayImage) -> Self {
        Self { w: img.width() as usize, h: img.height() as usize, data: img.as_raw().clone() }
    }

    fn to_image(&self) -> GrayImage {
        GrayImage::from_raw(self.w as u32, self.h as u32, self.data.clone()).expect("gray buffer")
    }

    fn filled(w: usize, h: usize, value: u8) -> Self {
        Self { w, h, data: vec![value; w * h] }
    }
}

fn otsu(data: &[u8]) -> u8 {
    let mut hist = [0u32; 256];
    for &p in data {
        hist[p as usize] += 1;
    }
    let total = data.len() as f64;
    if total == 0.0 {
        return 0;
    }
    let mut sum = 0.0;
    for (i, &c) in hist.iter().enumerate() {
        sum += i as f64 * c as f64;
    }
    let mut sum_b = 0.0;
    let mut w_b = 0.0;
    let mut best = -1.0;
    let mut thresh = 0u8;
    for i in 0..256 {
        w_b += hist[i] as f64;
        if w_b == 0.0 {
            continue;
        }
        let w_f = total - w_b;
        if w_f == 0.0 {
            break;
        }
        sum_b += i as f64 * hist[i] as f64;
        let m_b = sum_b / w_b;
        let m_f = (sum - sum_b) / w_f;
        let between = w_b * w_f * (m_b - m_f) * (m_b - m_f);
        if between > best {
            best = between;
            thresh = i as u8;
        }
    }
    thresh
}

fn ink_mask(src: &Gray) -> Gray {
    let thresh = otsu(&src.data);
    let mut out = Gray::filled(src.w, src.h, 0);
    for (i, &p) in src.data.iter().enumerate() {
        if p <= thresh {
            out.data[i] = 255;
        }
    }
    out
}

fn sliding_window(padded: &[u8], k: usize, dilate: bool) -> Vec<u8> {
    let mut window: VecDeque<usize> = VecDeque::new();
    let mut out = Vec::with_capacity(padded.len().saturating_sub(k - 1));
    for i in 0..padded.len() {
        while window.front().is_some_and(|front| *front + k <= i) {
            window.pop_front();
        }
        while window.back().is_some_and(|&back| {
            if dilate { padded[back] <= padded[i] } else { padded[back] >= padded[i] }
        }) {
            window.pop_back();
        }
        window.push_back(i);
        if i + 1 >= k {
            out.push(padded[*window.front().expect("window")]);
        }
    }
    out
}

fn pad_line(line: &[u8], k: usize) -> Vec<u8> {
    let ax = (k - 1) / 2;
    let right = k - 1 - ax;
    let mut padded = Vec::with_capacity(ax + line.len() + right);
    padded.extend(std::iter::repeat(0).take(ax));
    padded.extend_from_slice(line);
    padded.extend(std::iter::repeat(0).take(right));
    padded
}

fn morph(src: &Gray, kw: usize, kh: usize, dilate: bool) -> Gray {
    if src.w == 0 || src.h == 0 || kw == 0 || kh == 0 {
        return Gray::filled(src.w, src.h, 0);
    }
    if kh == 1 {
        let mut dst = Gray::filled(src.w, src.h, 0);
        let mut col = Vec::with_capacity(src.w);
        for y in 0..src.h {
            col.clear();
            col.extend_from_slice(&src.data[y * src.w..(y + 1) * src.w]);
            let padded = pad_line(&col, kw);
            let out = sliding_window(&padded, kw, dilate);
            dst.data[y * src.w..(y + 1) * src.w].copy_from_slice(&out);
        }
        return dst;
    }
    if kw == 1 {
        let mut dst = Gray::filled(src.w, src.h, 0);
        let mut col = vec![0u8; src.h];
        for x in 0..src.w {
            for y in 0..src.h {
                col[y] = src.data[y * src.w + x];
            }
            let padded = pad_line(&col, kh);
            let out = sliding_window(&padded, kh, dilate);
            for (y, v) in out.into_iter().enumerate() {
                dst.data[y * src.w + x] = v;
            }
        }
        return dst;
    }
    let ax = (kw as isize - 1) / 2;
    let ay = (kh as isize - 1) / 2;
    let mut dst = Gray::filled(src.w, src.h, 0);
    for y in 0..src.h {
        for x in 0..src.w {
            let mut acc = if dilate { 0u8 } else { 255u8 };
            let x0 = x as isize - ax;
            let y0 = y as isize - ay;
            for ky in 0..kh as isize {
                for kx in 0..kw as isize {
                    let xx = x0 + kx;
                    let yy = y0 + ky;
                    let v = if xx < 0 || yy < 0 || xx >= src.w as isize || yy >= src.h as isize {
                        0
                    } else {
                        src.data[yy as usize * src.w + xx as usize]
                    };
                    acc = if dilate { acc.max(v) } else { acc.min(v) };
                }
            }
            dst.data[y * src.w + x] = acc;
        }
    }
    dst
}

fn morph_open(src: &Gray, kw: usize, kh: usize) -> Gray {
    morph(&morph(src, kw, kh, false), kw, kh, true)
}

fn morph_close(src: &Gray, kw: usize, kh: usize) -> Gray {
    morph(&morph(src, kw, kh, true), kw, kh, false)
}

/// Connected ink that is not a straight rule: curves, sketches, a gage outline.
/// Same contract as `inkBoxesFromCanvas`: downsample to about one pixel per point,
/// punch word boxes, a 3-sample close, at most 400 boxes in points.
#[derive(Clone, Debug, Serialize)]
pub struct InkBox {
    pub x0: f64,
    pub y0: f64,
    pub x1: f64,
    pub y1: f64,
}

fn round2(n: f64) -> f64 {
    (n * 100.0).round() / 100.0
}

pub fn ink_boxes(img: &GrayImage, scale: f64, words: &[(f64, f64, f64, f64)]) -> Vec<InkBox> {
    let width = img.width() as usize;
    let height = img.height() as usize;
    if width < 8 || height < 8 || !(scale > 0.0) {
        return Vec::new();
    }
    let step = scale.round().max(1.0) as usize;
    let sw = width / step;
    let sh = height / step;
    if sw < 8 || sh < 8 {
        return Vec::new();
    }
    let raw = img.as_raw();
    let mut g = Gray::filled(sw, sh, 255);
    for y in 0..sh {
        let src = y * step * width;
        for x in 0..sw {
            g.data[y * sw + x] = raw[src + x * step];
        }
    }
    let mut mask = ink_mask(&g);
    let pt = step as f64 / scale;
    for &(x0, y0, x1, y1) in words {
        let ww = x1 - x0;
        let hh = y1 - y0;
        if ww <= 0.0 || hh <= 0.0 || ww > 80.0 || hh > 36.0 {
            continue;
        }
        let a = ((x0 - 0.6) / pt).floor().max(0.0) as isize;
        let b = ((x1 + 0.6) / pt).ceil() as isize;
        let c = ((y0 - 0.4) / pt).floor().max(0.0) as isize;
        let d = ((y1 + 0.4) / pt).ceil() as isize;
        let a = a.clamp(0, sw as isize - 1) as usize;
        let b = b.clamp(0, sw as isize - 1) as usize;
        let c = c.clamp(0, sh as isize - 1) as usize;
        let d = d.clamp(0, sh as isize - 1) as usize;
        if a > b || c > d {
            continue;
        }
        for y in c..=d {
            for x in a..=b {
                mask.data[y * sw + x] = 0;
            }
        }
    }
    let mut closed = morph(&mask, 3, 1, true);
    closed = morph(&closed, 1, 3, true);
    closed = morph(&closed, 3, 1, false);
    closed = morph(&closed, 1, 3, false);
    let page_area = (sw * sh) as f64;
    let mut out = Vec::new();
    for comp in components(&closed) {
        let bw = comp.cw();
        let bh = comp.ch();
        if comp.area < 12 {
            continue;
        }
        if bw.max(bh) < 8 && comp.area < 24 {
            continue;
        }
        if (bw * bh) as f64 >= 0.85 * page_area {
            continue;
        }
        let bw_pt = bw as f64 * pt;
        let bh_pt = bh as f64 * pt;
        if bw_pt * bh_pt < 48.0 && bw_pt.max(bh_pt) < 16.0 {
            continue;
        }
        out.push(InkBox {
            x0: round2(comp.minx as f64 * pt),
            y0: round2(comp.miny as f64 * pt),
            x1: round2((comp.maxx + 1) as f64 * pt),
            y1: round2((comp.maxy + 1) as f64 * pt),
        });
    }
    out.sort_by(|a, b| {
        let aa = (a.x1 - a.x0) * (a.y1 - a.y0);
        let bb = (b.x1 - b.x0) * (b.y1 - b.y0);
        bb.partial_cmp(&aa).unwrap_or(std::cmp::Ordering::Equal)
    });
    out.truncate(400);
    out
}

struct Comp {
    minx: usize,
    miny: usize,
    maxx: usize,
    maxy: usize,
    area: u32,
    sx: f64,
    sy: f64,
    sxx: f64,
    syy: f64,
    sxy: f64,
}

impl Comp {
    fn new() -> Self {
        Self {
            minx: usize::MAX,
            miny: usize::MAX,
            maxx: 0,
            maxy: 0,
            area: 0,
            sx: 0.0,
            sy: 0.0,
            sxx: 0.0,
            syy: 0.0,
            sxy: 0.0,
        }
    }

    fn cw(&self) -> usize {
        self.maxx - self.minx + 1
    }

    fn ch(&self) -> usize {
        self.maxy - self.miny + 1
    }

    fn angle(&self) -> f64 {
        let n = self.area as f64;
        if n < 2.0 {
            return 0.0;
        }
        let cxx = self.sxx - self.sx * self.sx / n;
        let cyy = self.syy - self.sy * self.sy / n;
        let cxy = self.sxy - self.sx * self.sy / n;
        let mut deg = 0.5 * (2.0 * cxy).atan2(cxx - cyy).to_degrees();
        if deg > 90.0 {
            deg -= 180.0;
        }
        if deg < -90.0 {
            deg += 180.0;
        }
        deg
    }
}

fn components(ink: &Gray) -> Vec<Comp> {
    let w = ink.w;
    let h = ink.h;
    let mut labels = vec![0u32; w * h];
    let mut parent = vec![0u32];
    let find = |parent: &mut [u32], mut x: u32| -> u32 {
        let mut root = x;
        while parent[root as usize] != root {
            root = parent[root as usize];
        }
        while parent[x as usize] != root {
            let next = parent[x as usize];
            parent[x as usize] = root;
            x = next;
        }
        root
    };
    for y in 0..h {
        for x in 0..w {
            if ink.data[y * w + x] == 0 {
                continue;
            }
            let mut neigh = [0u32; 4];
            let mut n = 0;
            for (dx, dy) in [(-1isize, 0isize), (-1, -1), (0, -1), (1, -1)] {
                let xx = x as isize + dx;
                let yy = y as isize + dy;
                if xx < 0 || yy < 0 || xx >= w as isize {
                    continue;
                }
                let lab = labels[yy as usize * w + xx as usize];
                if lab != 0 {
                    neigh[n] = lab;
                    n += 1;
                }
            }
            let lab = if n == 0 {
                let id = parent.len() as u32;
                parent.push(id);
                id
            } else {
                let mut root = find(&mut parent, neigh[0]);
                for i in 1..n {
                    let other = find(&mut parent, neigh[i]);
                    if root != other {
                        let (lo, hi) = if root < other { (root, other) } else { (other, root) };
                        parent[hi as usize] = lo;
                        root = lo;
                    }
                }
                root
            };
            labels[y * w + x] = lab;
        }
    }
    let mut comps: Vec<Comp> = Vec::new();
    let mut index_of: Vec<Option<usize>> = vec![None; parent.len()];
    for y in 0..h {
        for x in 0..w {
            let lab = labels[y * w + x];
            if lab == 0 {
                continue;
            }
            let root = find(&mut parent, lab);
            let idx = if let Some(i) = index_of[root as usize] {
                i
            } else {
                let i = comps.len();
                comps.push(Comp::new());
                index_of[root as usize] = Some(i);
                i
            };
            let c = &mut comps[idx];
            c.minx = c.minx.min(x);
            c.miny = c.miny.min(y);
            c.maxx = c.maxx.max(x);
            c.maxy = c.maxy.max(y);
            c.area += 1;
            let xf = x as f64;
            let yf = y as f64;
            c.sx += xf;
            c.sy += yf;
            c.sxx += xf * xf;
            c.syy += yf * yf;
            c.sxy += xf * yf;
        }
    }
    comps
}

fn round_dp(x: f64, dp: i32) -> f64 {
    let m = 10f64.powi(dp);
    (x * m).round() / m
}

pub fn deskew_angle(img: &GrayImage) -> f64 {
    let gray = Gray::from_image(img);
    let ink = ink_mask(&gray);
    let w = ink.w;
    let h = ink.h;
    if w == 0 || h == 0 {
        return 0.0;
    }
    let kernels = [(40.max(w / 30), w / 8), (15.max(w / 120), w / 20)];
    let second = 15.max(w / 120);
    let mut angles: Vec<(f64, f64)> = Vec::new();
    for (kernel_w, min_w) in kernels {
        let bars = if kernel_w == second {
            morph_close(&ink, kernel_w, 1)
        } else {
            morph_open(&ink, kernel_w, 1)
        };
        let tall_limit = 40.max(h / 25);
        for comp in components(&bars) {
            let cw = comp.cw();
            let ch = comp.ch();
            if cw < min_w || ch > tall_limit {
                continue;
            }
            let angle = comp.angle();
            if angle.abs() <= 6.0 {
                angles.push((angle, cw as f64));
            }
        }
        if angles.len() >= 3 {
            break;
        }
    }
    if angles.is_empty() {
        return 0.0;
    }
    angles.sort_by(|a, b| a.0.partial_cmp(&b.0).unwrap_or(std::cmp::Ordering::Equal));
    let half: f64 = angles.iter().map(|a| a.1).sum::<f64>() / 2.0;
    let mut acc = 0.0;
    let mut median = angles[0].0;
    for (value, weight) in &angles {
        acc += weight;
        if acc >= half {
            median = *value;
            break;
        }
    }
    if median.abs() < 0.05 {
        0.0
    } else {
        round_dp(-median, 3)
    }
}

pub fn deskew(img: &GrayImage, angle: f64) -> GrayImage {
    if angle.abs() < 0.05 {
        return img.clone();
    }
    // imageproc is clockwise-positive. OpenCV's getRotationMatrix2D is counter-clockwise,
    // and ocr.deskew passes `-angle` to it, so the clockwise angle is `angle` itself.
    rotate_about_center(img, angle.to_radians() as f32, Interpolation::Bicubic, Luma([255]))
}

pub fn rules_from_image(img: &GrayImage, scale: f64) -> Vec<Rule> {
    let gray = Gray::from_image(img);
    let ink = ink_mask(&gray);
    let w = ink.w;
    let h = ink.h;
    let min_len = 8.max((18.0 * scale) as i32);
    let thick_limit = 6.0_f64.max(4.0 * scale);
    let mut out = Vec::new();
    let kernels = [("h", 20.max(w / 60), 1usize), ("v", 1, 20.max(h / 60))];
    for (axis, kw, kh) in kernels {
        let mut opened = morph_open(&ink, kw, kh);
        let bw = (kw / 2).max(1);
        let bh = (kh / 2).max(1);
        opened = morph_close(&opened, bw, bh);
        for comp in components(&opened) {
            let cw = comp.cw() as i32;
            let ch = comp.ch() as i32;
            let (length, thick) = if axis == "h" { (cw, ch) } else { (ch, cw) };
            if length < min_len || (thick as f64) > thick_limit {
                continue;
            }
            let x = comp.minx as f64;
            let y = comp.miny as f64;
            let cw = comp.cw() as f64;
            let ch = comp.ch() as f64;
            if axis == "h" {
                let y_mid = (y + ch / 2.0) / scale;
                out.push(Rule {
                    x0: round_dp(x / scale, 2),
                    y0: round_dp(y_mid, 2),
                    x1: round_dp((x + cw) / scale, 2),
                    y1: round_dp(y_mid, 2),
                    thick: round_dp(ch / scale, 2),
                });
            } else {
                let x_mid = (x + cw / 2.0) / scale;
                out.push(Rule {
                    x0: round_dp(x_mid, 2),
                    y0: round_dp(y / scale, 2),
                    x1: round_dp(x_mid, 2),
                    y1: round_dp((y + ch) / scale, 2),
                    thick: round_dp(cw / scale, 2),
                });
            }
        }
    }
    out.sort_by(|a, b| a.y0.partial_cmp(&b.y0).unwrap_or(std::cmp::Ordering::Equal).then(a.x0.partial_cmp(&b.x0).unwrap_or(std::cmp::Ordering::Equal)));
    out
}

pub fn ink_glyph(img: &GrayImage) -> Option<String> {
    let gray = Gray::from_image(img);
    if gray.w == 0 || gray.h == 0 {
        return None;
    }
    let ink = ink_mask(&gray);
    let w = ink.w as f64;
    let h = ink.h as f64;
    let mut marks = Vec::new();
    for comp in components(&ink) {
        let y = comp.miny;
        let bw = comp.cw();
        let bh = comp.ch();
        let area = comp.area;
        if bw as f64 >= 0.8 * w || bh as f64 >= 0.8 * h {
            continue;
        }
        if area < 16 || (bw <= 4 && bh <= 5) {
            continue;
        }
        if y + bh >= ink.h.saturating_sub(1) && (bh as f64) <= 0.3 * h {
            continue;
        }
        marks.push((bw, bh, area));
    }
    if marks.len() != 1 {
        return None;
    }
    let (bw, bh, area) = marks[0];
    let bw = bw as f64;
    let bh = bh as f64;
    if bw >= 3.0 * bh && bw >= 8.0 && bh <= 0.3 * h && area as f64 >= 0.6 * bw * bh {
        return Some("—".to_string());
    }
    if (0.6..=1.6).contains(&(bw / bh.max(1.0))) && bw <= 0.5 * h && bh <= 0.5 * h && bw >= 5.0 {
        return Some("*".to_string());
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    fn paint() -> GrayImage {
        let mut img = GrayImage::from_pixel(600, 400, Luma([255]));
        for y in 100..103 {
            for x in 40..560 {
                img.put_pixel(x, y, Luma([0]));
            }
        }
        for y in 300..302 {
            for x in 40..560 {
                img.put_pixel(x, y, Luma([0]));
            }
        }
        for y in 20..380 {
            for x in 200..203 {
                img.put_pixel(x, y, Luma([0]));
            }
        }
        for y in 150..170 {
            for x in 60..120 {
                img.put_pixel(x, y, Luma([0]));
            }
        }
        img
    }

    #[test]
    fn rules_and_deskew_match_the_python_fixture() {
        let img = paint();
        let scale = 300.0 / 72.0;
        let rules = rules_from_image(&img, scale);
        let mut axes: Vec<(&str, i64)> = rules
            .iter()
            .map(|r| {
                let axis = if r.y0 == r.y1 { "h" } else { "v" };
                let length = (r.x1 - r.x0 + r.y1 - r.y0).round() as i64;
                (axis, length)
            })
            .collect();
        axes.sort();
        let hlen = (520.0 / scale).round() as i64;
        let vlen = (360.0 / scale).round() as i64;
        assert_eq!(axes, vec![("h", hlen), ("h", hlen), ("v", vlen)], "{rules:?}");
        assert_eq!(deskew_angle(&img), 0.0);
        let tilted = deskew(&img, -1.5);
        let angle = deskew_angle(&tilted);
        assert!((angle - 1.5).abs() < 0.25, "detected {angle}");
        let straight = deskew(&tilted, angle);
        assert!(deskew_angle(&straight).abs() < 0.15, "residual {}", deskew_angle(&straight));
    }

    #[test]
    fn glyph_dash_star_and_dots() {
        let mut dash = GrayImage::from_pixel(120, 30, Luma([255]));
        for y in 14..17 {
            for x in 50..70 {
                dash.put_pixel(x, y, Luma([0]));
            }
        }
        assert_eq!(ink_glyph(&dash).as_deref(), Some("—"));
        let mut star = GrayImage::from_pixel(120, 30, Luma([255]));
        for y in 8..16 {
            for x in 60..68 {
                star.put_pixel(x, y, Luma([0]));
            }
        }
        assert_eq!(ink_glyph(&star).as_deref(), Some("*"));
        let blank = GrayImage::from_pixel(120, 30, Luma([255]));
        assert_eq!(ink_glyph(&blank), None);
        let mut dots = GrayImage::from_pixel(120, 30, Luma([255]));
        let mut x = 10u32;
        while x < 110 {
            dots.put_pixel(x, 15, Luma([0]));
            dots.put_pixel(x + 1, 15, Luma([0]));
            dots.put_pixel(x, 16, Luma([0]));
            dots.put_pixel(x + 1, 16, Luma([0]));
            x += 12;
        }
        assert_eq!(ink_glyph(&dots), None);
    }

    #[test]
    fn ink_boxes_match_the_canvas_contract() {
        let scale = 4.0;
        let mut img = GrayImage::from_pixel(400, 400, Luma([255]));
        for y in 80..280 {
            for x in 80..280 {
                img.put_pixel(x, y, Luma([0]));
            }
        }
        let boxes = ink_boxes(&img, scale, &[]);
        assert_eq!(boxes.len(), 1, "{boxes:?}");
        assert!(boxes[0].x0 < 25.0 && boxes[0].y0 < 25.0, "{boxes:?}");
        assert!(boxes[0].x1 > 65.0 && boxes[0].y1 > 65.0, "{boxes:?}");
        let mut mark = GrayImage::from_pixel(200, 200, Luma([255]));
        for y in 80..100 {
            for x in 40..100 {
                mark.put_pixel(x, y, Luma([0]));
            }
        }
        assert_eq!(ink_boxes(&mark, 1.0, &[]).len(), 1);
        let punched = ink_boxes(&mark, 1.0, &[(36.0, 76.0, 104.0, 104.0)]);
        assert!(punched.is_empty(), "a word over the mark is not a drawing: {punched:?}");

        let mut specks = GrayImage::from_pixel(800, 800, Luma([255]));
        for row in 0..45 {
            for col in 0..45 {
                let x0 = 8 + col * 16;
                let y0 = 8 + row * 16;
                for dy in 0..8 {
                    for dx in 0..8 {
                        specks.put_pixel(x0 + dx, y0 + dy, Luma([0]));
                    }
                }
            }
        }
        assert_eq!(ink_boxes(&specks, 1.0, &[]).len(), 400);

        let mut page = GrayImage::from_pixel(2550, 3300, Luma([255]));
        for y in 400..1600 {
            for x in 300..1800 {
                if (x + y) % 3 == 0 {
                    page.put_pixel(x, y, Luma([0]));
                }
            }
        }
        let started = std::time::Instant::now();
        let drawn = ink_boxes(&page, 300.0 / 72.0, &[(40.0, 40.0, 80.0, 52.0)]);
        let ms = started.elapsed().as_secs_f64() * 1000.0;
        assert!(!drawn.is_empty());
        assert!(ms < 2000.0, "ink_boxes on a letter page took {ms:.1} ms");
        eprintln!("ink_boxes letter page {ms:.1} ms, {} boxes", drawn.len());
    }
}
