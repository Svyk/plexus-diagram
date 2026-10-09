//! Page-consensus spelling. The same rule as `preferSpellings` in
//! `src/model/parse/ocr-vote.js`: a one-edit neighbour replaces a non-lexicon
//! core, and words inside a ruled table stay as Vision read them.

use std::collections::{HashMap, HashSet};
use std::io::Read;
use std::sync::OnceLock;

use flate2::read::GzDecoder;

use super::geom::WordItem;
use super::imageops::Rule;

static LEXICON: OnceLock<HashSet<String>> = OnceLock::new();

pub fn lexicon() -> &'static HashSet<String> {
    LEXICON.get_or_init(|| {
        let bytes = include_bytes!("../../../../assets/ocr/en-words.txt.gz");
        let mut text = String::new();
        let _ = GzDecoder::new(&bytes[..]).read_to_string(&mut text);
        text.lines().map(|line| line.trim().to_lowercase()).filter(|w| !w.is_empty()).collect()
    })
}

fn word_core(text: &str) -> String {
    let mut best = String::new();
    let mut cur = String::new();
    for ch in text.chars() {
        let cont = ch.is_ascii_alphabetic() || (!cur.is_empty() && (ch == '\'' || ch == '-'));
        if cont {
            cur.push(ch);
        } else if cur.len() > best.len() {
            best.clone_from(&cur);
            cur.clear();
        } else {
            cur.clear();
        }
    }
    if cur.len() > best.len() {
        best = cur;
    }
    best
}

fn edit_distance(a: &str, b: &str) -> usize {
    let a: Vec<char> = a.chars().collect();
    let b: Vec<char> = b.chars().collect();
    let mut prev: Vec<usize> = (0..=a.len()).collect();
    for (j, cb) in b.iter().enumerate() {
        let mut cur = vec![j + 1];
        for (i, ca) in a.iter().enumerate() {
            let cost = if ca == cb { prev[i] } else { 1 + prev[i].min(prev[i + 1]).min(*cur.last().unwrap()) };
            cur.push(cost);
        }
        prev = cur;
    }
    prev[a.len()]
}

fn apply_case(sample: &str, word: &str) -> String {
    let letters: String = sample.chars().filter(|c| c.is_ascii_alphabetic()).collect();
    if letters.len() > 1 && letters.chars().all(|c| c.is_ascii_uppercase()) {
        return word.to_uppercase();
    }
    if sample.chars().next().map(|c| c.is_uppercase()).unwrap_or(false) {
        let mut chars = word.chars();
        let mut out = String::new();
        if let Some(c) = chars.next() {
            out.extend(c.to_uppercase());
        }
        out.extend(chars);
        return out;
    }
    word.to_string()
}

fn replace_core(raw: &str, core: &str, next: &str) -> String {
    let lower = raw.to_lowercase();
    let needle = core.to_lowercase();
    match lower.find(&needle) {
        Some(i) => {
            let end = i + needle.len();
            format!("{}{}{}", &raw[..i], apply_case(&raw[i..end], next), &raw[end..])
        }
        None => raw.to_string(),
    }
}

fn ruled_regions(rules: &[Rule], page_w: f64, page_h: f64) -> Vec<(f64, f64, f64, f64)> {
    let mut horiz = Vec::new();
    let mut vert = Vec::new();
    for rule in rules {
        let x0 = rule.x0.min(rule.x1);
        let x1 = rule.x0.max(rule.x1);
        let y0 = rule.y0.min(rule.y1);
        let y1 = rule.y0.max(rule.y1);
        if y1 - y0 <= 1.5 && x1 - x0 >= 36.0 {
            horiz.push((x0, x1, (y0 + y1) / 2.0));
        } else if x1 - x0 <= 1.5 && y1 - y0 >= 36.0 {
            vert.push((y0, y1, (x0 + x1) / 2.0));
        }
    }
    let mut regions = Vec::new();
    let page_area = (page_w * page_h).max(1.0);
    for i in 0..horiz.len() {
        for j in (i + 1)..horiz.len() {
            let top = horiz[i].2.min(horiz[j].2);
            let bot = horiz[i].2.max(horiz[j].2);
            if bot - top < 20.0 {
                continue;
            }
            let x0 = horiz[i].0.max(horiz[j].0);
            let x1 = horiz[i].1.min(horiz[j].1);
            if x1 - x0 < 40.0 || (x1 - x0) * (bot - top) > 0.65 * page_area {
                continue;
            }
            let verts = vert.iter().filter(|v| v.2 >= x0 - 4.0 && v.2 <= x1 + 4.0 && (v.1.min(bot) - v.0.max(top)) >= 0.6 * (bot - top)).count();
            if verts >= 2 {
                regions.push((x0, top, x1, bot));
            }
        }
    }
    regions
}

fn in_region(item: &WordItem, regions: &[(f64, f64, f64, f64)]) -> bool {
    if regions.is_empty() {
        return false;
    }
    let x = item.transform[4];
    let cx = x + item.width / 2.0;
    let cy = (item.y0 + item.y1) / 2.0;
    regions.iter().any(|r| cx >= r.0 && cx <= r.2 && cy >= r.1 && cy <= r.3)
}

pub fn prefer_spellings(items: Vec<WordItem>, rules: &[Rule], page_w: f64, page_h: f64, words: &HashSet<String>) -> Vec<WordItem> {
    if words.is_empty() || items.is_empty() {
        return items;
    }
    let regions = ruled_regions(rules, page_w, page_h);
    let cores: Vec<String> = items.iter().map(|item| word_core(&item.text).to_lowercase()).collect();
    let mut counts: HashMap<String, usize> = HashMap::new();
    for (item, core) in items.iter().zip(cores.iter()) {
        if core.len() >= 4 && !in_region(item, &regions) {
            *counts.entry(core.clone()).or_insert(0) += 1;
        }
    }
    items
        .into_iter()
        .enumerate()
        .map(|(index, mut item)| {
            let core = &cores[index];
            if core.len() < 4 || words.contains(core) || in_region(&item, &regions) {
                return item;
            }
            let mine = counts.get(core).copied().unwrap_or(0);
            let mut best: Option<(String, bool)> = None;
            let mut best_n = 0usize;
            for (word, n) in &counts {
                if word == core || word.len().abs_diff(core.len()) > 1 || edit_distance(core, word) != 1 {
                    continue;
                }
                let known = words.contains(word);
                let ok = (known && *n >= 2 && *n >= mine * 2) || (!known && *n >= 3 && *n >= mine * 3);
                if !ok {
                    continue;
                }
                let take = match &best {
                    None => true,
                    Some(_) if *n > best_n => true,
                    Some((_, was)) if *n == best_n && known != *was => known,
                    Some((prev, _)) if *n == best_n && known == words.contains(prev) => word < prev,
                    _ => false,
                };
                if take {
                    best = Some((word.clone(), known));
                    best_n = *n;
                }
            }
            if let Some((word, _)) = best {
                let next = replace_core(&item.text, core, &word);
                if next != item.text {
                    item.text = next;
                }
            }
            item
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn word(text: &str, x: f64) -> WordItem {
        WordItem {
            text: text.into(),
            transform: [10.0, 0.0, 0.0, 10.0, x, 200.0],
            width: 40.0,
            height: 10.0,
            y0: 192.0,
            y1: 202.0,
            font_name: "ocr",
            conf: 1.0,
            raw: None,
        }
    }

    #[test]
    fn consensus_replaces_a_one_edit_miss_and_leaves_lexicon_words() {
        let words: HashSet<String> = ["pressure", "form", "from"].into_iter().map(str::to_string).collect();
        let items = vec![
            word("prossure", 40.0),
            word("pressure", 100.0),
            word("pressure", 180.0),
            word("form", 260.0),
            word("from", 320.0),
            word("from", 380.0),
        ];
        let out = prefer_spellings(items, &[], 612.0, 792.0, &words);
        let text: Vec<&str> = out.iter().map(|i| i.text.as_str()).collect();
        assert_eq!(text, ["pressure", "pressure", "pressure", "form", "from", "from"]);
    }

    #[test]
    fn unknown_frequent_spelling_wins_and_a_table_cell_stays() {
        let words: HashSet<String> = ["pressure"].into_iter().map(str::to_string).collect();
        let mut items = vec![word("suporcharger", 40.0), word("supercharger", 120.0), word("supercharger", 200.0), word("supercharger", 280.0)];
        items.push(WordItem {
            text: "suporcharger".into(),
            transform: [8.0, 0.0, 0.0, 8.0, 80.0, 50.0],
            width: 70.0,
            height: 8.0,
            y0: 44.0,
            y1: 52.0,
            font_name: "ocr",
            conf: 1.0,
            raw: None,
        });
        let rules = vec![
            Rule { x0: 20.0, y0: 30.0, x1: 200.0, y1: 30.0, thick: 0.4 },
            Rule { x0: 20.0, y0: 80.0, x1: 200.0, y1: 80.0, thick: 0.4 },
            Rule { x0: 20.0, y0: 30.0, x1: 20.0, y1: 80.0, thick: 0.4 },
            Rule { x0: 200.0, y0: 30.0, x1: 200.0, y1: 80.0, thick: 0.4 },
        ];
        let out = prefer_spellings(items, &rules, 612.0, 792.0, &words);
        assert_eq!(out[0].text, "supercharger");
        assert_eq!(out[4].text, "suporcharger");
    }

    #[test]
    fn lexicon_contains_pressure() {
        assert!(lexicon().contains("pressure"));
        assert!(!lexicon().contains("prossure"));
    }
}
