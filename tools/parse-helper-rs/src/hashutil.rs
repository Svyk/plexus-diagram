//! Options hashes the extension and the Python helper must reproduce.
//! Canonical JSON: sorted keys, no whitespace, `pages` kept in client order.

use serde_json::{Map, Value};
use sha2::{Digest, Sha256};

pub fn sha256_hex(data: &[u8]) -> String {
    hex::encode(Sha256::digest(data))
}

fn is_present_pages(pages: &Value) -> bool {
    match pages {
        Value::Null => false,
        Value::Array(items) if items.is_empty() => false,
        Value::String(s) if s.is_empty() => false,
        Value::Bool(false) => false,
        _ => true,
    }
}

/// Fill defaults the way `normalize_options` does. `scope` is kept on the object
/// and dropped by [`canonical_options`].
pub fn normalize_options(raw: Option<&Value>) -> Map<String, Value> {
    let raw = raw.and_then(|v| v.as_object());
    let ocr = raw
        .and_then(|m| m.get("ocr"))
        .and_then(|v| v.as_str())
        .filter(|s| !s.is_empty())
        .unwrap_or("auto");
    let formula = raw.and_then(|m| m.get("formula")).map(|v| v.as_bool().unwrap_or(false)).unwrap_or(false);
    let tables = raw
        .and_then(|m| m.get("tables"))
        .and_then(|v| v.as_str())
        .filter(|s| !s.is_empty())
        .unwrap_or("accurate");
    let pictures = match raw.and_then(|m| m.get("pictures")) {
        None => true,
        Some(v) => v.as_bool().unwrap_or(false),
    };
    let mut out = Map::new();
    out.insert("ocr".into(), Value::String(ocr.to_string()));
    out.insert("formula".into(), Value::Bool(formula));
    out.insert("tables".into(), Value::String(tables.to_string()));
    out.insert("pictures".into(), Value::Bool(pictures));
    if let Some(pages) = raw.and_then(|m| m.get("pages")) {
        if is_present_pages(pages) {
            out.insert("pages".into(), pages.clone());
        }
    }
    if let Some(scope) = raw.and_then(|m| m.get("scope")) {
        if !scope.is_null() {
            out.insert("scope".into(), scope.clone());
        }
    }
    out
}

pub fn options_hash(raw: Option<&Value>) -> String {
    sha256_hex(canonical_options_json(raw).as_bytes())
}

pub fn canonical_options_json(raw: Option<&Value>) -> String {
    let norm = normalize_options(raw);
    let formula = norm.get("formula").and_then(|v| v.as_bool()).unwrap_or(false);
    let ocr = norm.get("ocr").and_then(|v| v.as_str()).unwrap_or("auto");
    let pictures = norm.get("pictures").and_then(|v| v.as_bool()).unwrap_or(true);
    let tables = norm.get("tables").and_then(|v| v.as_str()).unwrap_or("accurate");
    let mut s = format!(
        "{{\"formula\":{},\"ocr\":{},",
        if formula { "true" } else { "false" },
        serde_json::to_string(ocr).unwrap()
    );
    if let Some(pages) = norm.get("pages") {
        s.push_str("\"pages\":");
        s.push_str(&serde_json::to_string(pages).unwrap());
        s.push(',');
    }
    s.push_str(&format!(
        "\"pictures\":{},\"tables\":{}}}",
        if pictures { "true" } else { "false" },
        serde_json::to_string(tables).unwrap()
    ));
    s
}

/// Cache key beside the Docling options hash: `{"engine":"vision","op":"ocr"[,"pages"]}`.
pub fn ocr_options_hash(pages: Option<&Value>) -> String {
    let json = match pages {
        Some(p) if is_present_pages(p) => {
            format!("{{\"engine\":\"vision\",\"op\":\"ocr\",\"pages\":{}}}", serde_json::to_string(p).unwrap())
        }
        _ => "{\"engine\":\"vision\",\"op\":\"ocr\"}".to_string(),
    };
    sha256_hex(json.as_bytes())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn hashes_match_the_python_helper() {
        assert_eq!(
            options_hash(None),
            "4ad8a6dfdf951e2aa13e2cab2576ef1a45c86085fdad6ba86b1c100969c495cc"
        );
        assert_eq!(
            options_hash(Some(&json!({"pages": [1, 3, [5, 9]], "scope": {"page": 1}}))),
            "27fd23100c461e015ce4bece676697249a2d7fc4d0b6bea897b66c705dcd6696"
        );
        assert_eq!(
            ocr_options_hash(None),
            "1a169b8a576028be403a6f3800de273fc37e9092796c2d8ac7bb9ad92717f845"
        );
        assert_eq!(ocr_options_hash(Some(&json!([]))), ocr_options_hash(None));
        assert_eq!(
            ocr_options_hash(Some(&json!([1, [3, 5]]))),
            "11133bbd1c560d6a61063b816d9be2efed4954ae95da10e5c8f4bc19774fdeba"
        );
    }
}
