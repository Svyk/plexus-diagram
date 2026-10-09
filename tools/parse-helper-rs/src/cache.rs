//! OCR JSON cache. Separate from the Python helper's directory so a spike cannot
//! poison the LaunchAgent that is already serving `~/Library/Caches/plexus-parse-helper`.

use std::fs::{self, File};
use std::io::{self, Write};
use std::path::{Path, PathBuf};
use std::time::SystemTime;

use serde_json::Value;

use crate::auth::home_dir;

pub fn default_cache_root() -> PathBuf {
    home_dir().join("Library").join("Caches").join("plexus-parse-helper-rs")
}

#[derive(Clone)]
pub struct ParseCache {
    root: PathBuf,
    max_bytes: u64,
}

impl ParseCache {
    pub fn new(root: PathBuf, max_bytes: u64) -> Self {
        Self { root, max_bytes }
    }

    fn path_for(&self, sha256: &str, opts_hash: &str) -> PathBuf {
        self.root.join(sha256).join(format!("{opts_hash}.json"))
    }

    pub fn get(&self, sha256: &str, opts_hash: &str) -> Option<Value> {
        let path = self.path_for(sha256, opts_hash);
        let text = fs::read_to_string(&path).ok()?;
        let _ = filetime_touch(&path);
        serde_json::from_str(&text).ok()
    }

    pub fn put(&self, sha256: &str, opts_hash: &str, doc: &Value) -> io::Result<()> {
        let path = self.path_for(sha256, opts_hash);
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent)?;
        }
        let tmp = path.with_extension("json.tmp");
        {
            let mut file = File::create(&tmp)?;
            let text = serde_json::to_string(doc).map_err(io::Error::other)?;
            file.write_all(text.as_bytes())?;
            file.sync_all()?;
        }
        fs::rename(&tmp, &path)?;
        self.evict();
        Ok(())
    }

    fn evict(&self) {
        let Ok(shas) = fs::read_dir(&self.root) else { return };
        let mut files = Vec::new();
        for sha in shas.flatten() {
            let Ok(entries) = fs::read_dir(sha.path()) else { continue };
            for entry in entries.flatten() {
                let path = entry.path();
                if path.extension().and_then(|e| e.to_str()) != Some("json") {
                    continue;
                }
                if let Ok(meta) = entry.metadata() {
                    let modified = meta.modified().unwrap_or(SystemTime::UNIX_EPOCH);
                    files.push((modified, meta.len(), path));
                }
            }
        }
        files.sort_by_key(|(modified, _, _)| *modified);
        let mut total: u64 = files.iter().map(|(_, len, _)| *len).sum();
        for (_, len, path) in files {
            if total <= self.max_bytes {
                break;
            }
            if fs::remove_file(&path).is_ok() {
                total = total.saturating_sub(len);
                if let Some(parent) = path.parent() {
                    let _ = fs::remove_dir(parent);
                }
            }
        }
    }
}

fn filetime_touch(path: &Path) -> io::Result<()> {
    let file = File::options().write(true).open(path)?;
    file.sync_all()?;
    Ok(())
}
