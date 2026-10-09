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
    // (k - 1) / 2. OpenCV's even-kernel default is k / 2, one pixel to the right.
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

// OpenCV `findContours(RETR_EXTERNAL, CHAIN_APPROX_SIMPLE)` neighbor order
// (east, then clockwise with y growing downward). `fitLine` on those corners
// matches the covariance of the same points; the filled-pixel axis does not.
const CONTOUR_DELTAS: [(i32, i32); 8] = [
    (1, 0),
    (1, -1),
    (0, -1),
    (-1, -1),
    (-1, 0),
    (-1, 1),
    (0, 1),
    (1, 1),
];

fn contour_points(mask: &Gray) -> Vec<Vec<(i32, i32)>> {
    let w = mask.w;
    let h = mask.h;
    if w == 0 || h == 0 {
        return Vec::new();
    }
    let pw = w + 2;
    let ph = h + 2;
    let mut img = vec![0i16; pw * ph];
    for y in 0..h {
        for x in 0..w {
            if mask.data[y * w + x] != 0 {
                img[(y + 1) * pw + (x + 1)] = 1;
            }
        }
    }
    let mut out = Vec::new();
    let width = pw - 1;
    let height = ph - 1;
    let mut y = 1i32;
    let mut lnbd = (0i32, 1i32);
    while y < height as i32 {
        let mut x = 1i32;
        let mut prev: i16 = 0;
        while x < width as i32 {
            let p = img[y as usize * pw + x as usize];
            if p == prev {
                prev = p;
                x += 1;
                continue;
            }
            let mut is_hole = false;
            if !(prev == 0 && p == 1) {
                if p != 0 || prev < 1 {
                    prev = p;
                    if prev & -2 != 0 {
                        lnbd = (x, y);
                    }
                    x += 1;
                    continue;
                }
                is_hole = true;
            }
            let lnbd_v = img[lnbd.1 as usize * pw + lnbd.0 as usize];
            if is_hole || lnbd_v > 0 {
                prev = p;
                if prev & -2 != 0 {
                    lnbd = (x, y);
                }
                x += 1;
                continue;
            }
            let pts = fetch_simple_contour(&mut img, pw, x, y);
            out.push(pts.into_iter().map(|(px, py)| (px - 1, py - 1)).collect());
            lnbd = (x, y);
            x += 1;
            prev = img[y as usize * pw + (x as usize - 1)];
        }
        lnbd = (0, y + 1);
        y += 1;
    }
    out
}

fn fetch_simple_contour(img: &mut [i16], pw: usize, x0: i32, y0: i32) -> Vec<(i32, i32)> {
    let pix = |img: &[i16], px: i32, py: i32| -> i16 {
        if px < 0 || py < 0 {
            return 0;
        }
        let (px, py) = (px as usize, py as usize);
        if py * pw + px >= img.len() || px >= pw {
            return 0;
        }
        img[py * pw + px]
    };
    let mut s_end = 4i32;
    let mut s = s_end;
    let i1;
    loop {
        s = (s - 1) & 7;
        let (dx, dy) = CONTOUR_DELTAS[s as usize];
        let nx = x0 + dx;
        let ny = y0 + dy;
        if pix(img, nx, ny) != 0 || s == s_end {
            i1 = (nx, ny);
            break;
        }
    }
    if s == s_end {
        img[y0 as usize * pw + x0 as usize] = 2 | -128;
        return vec![(x0, y0)];
    }
    let mut i3 = (x0, y0);
    let mut prev_s = s ^ 4;
    let mut pt = (x0, y0);
    let mut points = Vec::new();
    loop {
        s_end = s;
        s = s.min(15);
        let mut i4 = i3;
        while s < 15 {
            s += 1;
            let (dx, dy) = CONTOUR_DELTAS[(s & 7) as usize];
            let nx = i3.0 + dx;
            let ny = i3.1 + dy;
            if pix(img, nx, ny) != 0 {
                i4 = (nx, ny);
                break;
            }
        }
        s &= 7;
        let idx = i3.1 as usize * pw + i3.0 as usize;
        if ((s - 1) as u32) < (s_end as u32) {
            img[idx] = 2 | -128;
        } else if img[idx] == 1 {
            img[idx] = 2;
        }
        if s != prev_s {
            points.push(pt);
            prev_s = s;
        }
        let (dx, dy) = CONTOUR_DELTAS[s as usize];
        pt = (pt.0 + dx, pt.1 + dy);
        if i4 == (x0, y0) && i3 == i1 {
            break;
        }
        i3 = i4;
        s = (s + 4) & 7;
    }
    points
}

fn moment_angle(pts: &[(i32, i32)]) -> f64 {
    let n = pts.len() as f64;
    if n < 2.0 {
        return 0.0;
    }
    let mut sx = 0.0;
    let mut sy = 0.0;
    let mut sxx = 0.0;
    let mut syy = 0.0;
    let mut sxy = 0.0;
    for &(x, y) in pts {
        let xf = x as f64;
        let yf = y as f64;
        sx += xf;
        sy += yf;
        sxx += xf * xf;
        syy += yf * yf;
        sxy += xf * yf;
    }
    let cxx = sxx - sx * sx / n;
    let cyy = syy - sy * sy / n;
    let cxy = sxy - sx * sy / n;
    let mut deg = 0.5 * (2.0 * cxy).atan2(cxx - cyy).to_degrees();
    if deg > 90.0 {
        deg -= 180.0;
    }
    if deg < -90.0 {
        deg += 180.0;
    }
    deg
}

fn contour_line_angles(bars: &Gray, min_w: usize, tall_limit: usize) -> Vec<(f64, f64)> {
    let mut angles = Vec::new();
    for pts in contour_points(bars) {
        if pts.is_empty() {
            continue;
        }
        let mut minx = pts[0].0;
        let mut maxx = pts[0].0;
        let mut miny = pts[0].1;
        let mut maxy = pts[0].1;
        for &(x, y) in &pts {
            minx = minx.min(x);
            maxx = maxx.max(x);
            miny = miny.min(y);
            maxy = maxy.max(y);
        }
        let cw = (maxx - minx + 1) as usize;
        let ch = (maxy - miny + 1) as usize;
        if cw < min_w || ch > tall_limit {
            continue;
        }
        let angle = moment_angle(&pts);
        if angle.abs() <= 6.0 {
            angles.push((angle, cw as f64));
        }
    }
    angles
}

fn moment_line_angles(bars: &Gray, min_w: usize, tall_limit: usize) -> Vec<(f64, f64)> {
    let mut angles = Vec::new();
    for comp in components(bars) {
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
    angles
}

fn weighted_median_angle(mut angles: Vec<(f64, f64)>) -> f64 {
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
    if median.abs() < 0.05 { 0.0 } else { round_dp(-median, 3) }
}

fn collect_line_angles(img: &GrayImage, moments: bool) -> Vec<(f64, f64)> {
    let gray = Gray::from_image(img);
    let ink = ink_mask(&gray);
    let w = ink.w;
    let h = ink.h;
    if w == 0 || h == 0 {
        return Vec::new();
    }
    let kernels = [(40.max(w / 30), w / 8), (15.max(w / 120), w / 20)];
    let second = 15.max(w / 120);
    let mut angles = Vec::new();
    for (kernel_w, min_w) in kernels {
        let bars = if kernel_w == second { morph_close(&ink, kernel_w, 1) } else { morph_open(&ink, kernel_w, 1) };
        let tall_limit = 40.max(h / 25);
        if moments {
            angles.extend(moment_line_angles(&bars, min_w, tall_limit));
        } else {
            angles.extend(contour_line_angles(&bars, min_w, tall_limit));
        }
        if angles.len() >= 3 {
            break;
        }
    }
    angles
}

pub fn deskew_angle(img: &GrayImage) -> f64 {
    // A skew of a few tenths of a degree is a table-rule problem: the filled-pixel
    // axis (the previous helper) keeps those rules apart. A larger skew is a reading
    // problem: the contour fit matches the Python helper's angle, which is what
    // turns "esting" back into "resting".
    let contour = weighted_median_angle(collect_line_angles(img, false));
    // A contour angle of 0 means the text lines are already straight. The filled-pixel
    // axis can still report a tenth of a degree and rotate a straight page, which is
    // what scrambled the pitching-chart reading. Use that axis only to correct a
    // contour angle that is real but small (the case that keeps table rules apart).
    if contour == 0.0 || contour.abs() >= 0.2 {
        return contour;
    }
    weighted_median_angle(collect_line_angles(img, true))
}

pub fn deskew(img: &GrayImage, angle: f64) -> GrayImage {
    if angle.abs() < 0.05 {
        return img.clone();
    }
    // imageproc bicubic (Catmull-Rom) keeps a one-pixel gap in a ruling line. OpenCV's
    // fixed-point cubic, which matches `ocr.deskew` byte for byte, closes that gap and
    // welds table rules into page-long bars. The contour angle above is what matches
    // the Python helper's reading; the resampler is what keeps the cells.
    // imageproc is clockwise-positive. OpenCV's getRotationMatrix2D is counter-clockwise
    // and ocr.deskew passes `-angle`, so the clockwise angle is `angle` itself.
    rotate_about_center(img, angle.to_radians() as f32, Interpolation::Bicubic, Luma([255]))
}

#[cfg(test)]
fn cubic_coeffs(x: f32) -> [f32; 4] {
    // OpenCV interpolateCubic, A = -0.75.
    const A: f32 = -0.75;
    let p0 = ((A * (x + 1.0) - 5.0 * A) * (x + 1.0) + 8.0 * A) * (x + 1.0) - 4.0 * A;
    let p1 = ((A + 2.0) * x - (A + 3.0)) * x * x + 1.0;
    let one = 1.0 - x;
    let p2 = ((A + 2.0) * one - (A + 3.0)) * one * one + 1.0;
    let p3 = 1.0 - p0 - p1 - p2;
    [p0, p1, p2, p3]
}

/// OpenCV `BicubicTab_i`: INTER_TAB_SIZE=32, coefficients scaled by 2^15 and
/// corrected so each 4×4 sums to 32768.
#[cfg(test)]
fn cubic_weights() -> &'static [[i16; 16]; 1024] {
    use std::sync::OnceLock;
    static TAB: OnceLock<[[i16; 16]; 1024]> = OnceLock::new();
    TAB.get_or_init(|| {
        const TABSZ: usize = 32;
        const K: usize = 4;
        let mut tab1 = [0f32; TABSZ * K];
        for i in 0..TABSZ {
            let coeffs = cubic_coeffs(i as f32 / TABSZ as f32);
            tab1[i * K..i * K + K].copy_from_slice(&coeffs);
        }
        let mut out = [[0i16; 16]; 1024];
        for i in 0..TABSZ {
            for j in 0..TABSZ {
                let mut itab = [0i16; 16];
                let mut isum: i32 = 0;
                for k1 in 0..K {
                    let vy = tab1[i * K + k1];
                    for k2 in 0..K {
                        let v = vy * tab1[j * K + k2] * 32768.0;
                        let s = v.round_ties_even() as i32;
                        let s = s.clamp(i16::MIN as i32, i16::MAX as i32) as i16;
                        itab[k1 * K + k2] = s;
                        isum += s as i32;
                    }
                }
                if isum != 32768 {
                    let diff = isum - 32768;
                    let mut mk1 = 2usize;
                    let mut mk2 = 2usize;
                    let mut max_k1 = 2usize;
                    let mut max_k2 = 2usize;
                    for k1 in 2..4 {
                        for k2 in 2..4 {
                            if itab[k1 * K + k2] < itab[mk1 * K + mk2] {
                                mk1 = k1;
                                mk2 = k2;
                            } else if itab[k1 * K + k2] > itab[max_k1 * K + max_k2] {
                                max_k1 = k1;
                                max_k2 = k2;
                            }
                        }
                    }
                    if diff < 0 {
                        let idx = max_k1 * K + max_k2;
                        itab[idx] = (itab[idx] as i32 - diff) as i16;
                    } else {
                        let idx = mk1 * K + mk2;
                        itab[idx] = (itab[idx] as i32 - diff) as i16;
                    }
                }
                out[i * TABSZ + j] = itab;
            }
        }
        out
    })
}

#[cfg(test)]
fn cv_round(v: f64) -> i32 {
    v.round_ties_even() as i32
}

#[cfg(test)]
fn saturate_remap(sum: i32) -> u8 {
    // FixedPtCast<int, uchar, 15>: (sum + 2^14) >> 15.
    ((sum + 16384) >> 15).clamp(0, 255) as u8
}

#[cfg(test)]
fn warp_rotate_cubic(img: &GrayImage, opencv_degrees: f64) -> GrayImage {
    let w = img.width() as i32;
    let h = img.height() as i32;
    let cx = w as f64 / 2.0;
    let cy = h as f64 / 2.0;
    let theta = opencv_degrees.to_radians();
    let alpha = theta.cos();
    let beta = theta.sin();
    // Sample map equals getRotationMatrix2D(center, degrees) after warpAffine inverts
    // getRotationMatrix2D(center, -degrees). OpenCV keeps this matrix in double and
    // quantizes coordinates with AB_BITS=10, INTER_BITS=5.
    let m = [
        alpha,
        beta,
        (1.0 - alpha) * cx - beta * cy,
        -beta,
        alpha,
        beta * cx + (1.0 - alpha) * cy,
    ];
    const AB_SCALE: f64 = 1024.0;
    const SHIFT: i32 = 5;
    const INTER_BITS: i32 = 5;
    const ROUND_DELTA: i32 = 16;
    let weights = cubic_weights();
    let src = img.as_raw();
    let wu = w as usize;
    let mut dst = vec![255u8; wu * h as usize];
    let mut adelta = vec![0i32; wu];
    let mut bdelta = vec![0i32; wu];
    for x in 0..w {
        adelta[x as usize] = cv_round(m[0] * x as f64 * AB_SCALE);
        bdelta[x as usize] = cv_round(m[3] * x as f64 * AB_SCALE);
    }
    for y in 0..h {
        let x0 = cv_round((m[1] * y as f64 + m[2]) * AB_SCALE) + ROUND_DELTA;
        let y0 = cv_round((m[4] * y as f64 + m[5]) * AB_SCALE) + ROUND_DELTA;
        for x in 0..w {
            let xf = (x0 + adelta[x as usize]) >> SHIFT;
            let yf = (y0 + bdelta[x as usize]) >> SHIFT;
            let sx = (xf >> INTER_BITS) - 1;
            let sy = (yf >> INTER_BITS) - 1;
            let wts = &weights[((yf & 31) * 32 + (xf & 31)) as usize];
            let pix = if (0..w - 3).contains(&sx) && (0..h - 3).contains(&sy) {
                let mut sum = 0i32;
                for ky in 0..4 {
                    let row = (sy as usize + ky) * wu + sx as usize;
                    let base = ky * 4;
                    sum += src[row] as i32 * wts[base] as i32
                        + src[row + 1] as i32 * wts[base + 1] as i32
                        + src[row + 2] as i32 * wts[base + 2] as i32
                        + src[row + 3] as i32 * wts[base + 3] as i32;
                }
                saturate_remap(sum)
            } else if sx >= w || sx + 4 <= 0 || sy >= h || sy + 4 <= 0 {
                255
            } else {
                let mut sum = 255i32 * 32768;
                for ky in 0..4 {
                    let yy = sy + ky as i32;
                    if yy < 0 || yy >= h {
                        continue;
                    }
                    let row = yy as usize * wu;
                    for kx in 0..4 {
                        let xx = sx + kx as i32;
                        if xx < 0 || xx >= w {
                            continue;
                        }
                        sum += (src[row + xx as usize] as i32 - 255) * wts[ky * 4 + kx] as i32;
                    }
                }
                saturate_remap(sum)
            };
            dst[y as usize * wu + x as usize] = pix;
        }
    }
    GrayImage::from_raw(img.width(), img.height(), dst).expect("gray buffer")
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
    use image::Luma;

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
    fn simple_contour_matches_opencv_corners() {
        let mut mask = Gray::filled(70, 24, 0);
        for i in 0..50 {
            let y = 6 + i / 18;
            for dy in 0..3 {
                mask.data[(y + dy) * 70 + (8 + i)] = 255;
            }
        }
        let contours = contour_points(&mask);
        assert_eq!(contours.len(), 1, "{contours:?}");
        assert_eq!(
            contours[0],
            vec![
                (8, 6),
                (8, 8),
                (25, 8),
                (26, 9),
                (43, 9),
                (44, 10),
                (57, 10),
                (57, 8),
                (44, 8),
                (43, 7),
                (26, 7),
                (25, 6),
            ]
        );
        let angle = moment_angle(&contours[0]);
        assert!((angle - 2.555).abs() < 0.01, "{angle}");
    }

    #[test]
    fn cubic_rotation_matches_opencv_warp() {
        let mut img = GrayImage::from_pixel(24, 18, Luma([255]));
        for y in 8..11 {
            for x in 2..22 {
                img.put_pixel(x, y, Luma([0]));
            }
        }
        for y in 2..16 {
            for x in 11..13 {
                img.put_pixel(x, y, Luma([40]));
            }
        }
        let out = warp_rotate_cubic(&img, -1.5);
        let row = |y: u32| -> Vec<u8> { (0..24).map(|x| out.get_pixel(x, y).0[0]).collect() };
        assert_eq!(row(8), vec![255, 250, 53, 58, 50, 42, 34, 27, 20, 13, 13, 41, 39, 0, 0, 0, 0, 0, 0, 0, 0, 0, 255, 255]);
        assert_eq!(row(9), vec![255, 255, 0, 0, 0, 0, 0, 0, 0, 0, 0, 40, 40, 0, 0, 0, 0, 0, 0, 0, 0, 0, 255, 255]);
        assert_eq!(row(2), vec![255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 222, 21, 75, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255]);
        assert_eq!(row(15), vec![255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 65, 19, 227, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255]);
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
