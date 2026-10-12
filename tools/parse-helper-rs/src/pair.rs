//! Pairing window. `pair` writes an expiry; GET /v1/pair reads it and hands the token out once.

use std::fs::{self, OpenOptions};
use std::io::{self, Write};
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use std::os::unix::fs::OpenOptionsExt;

use crate::auth::app_support_dir;

pub const PAIR_SECONDS: f64 = 90.0;

pub fn default_pair_file() -> PathBuf {
    app_support_dir().join("pair-until")
}

pub fn open_window(path: &Path, seconds: f64) -> io::Result<f64> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    let until = now() + seconds;
    let mut file = OpenOptions::new().write(true).create(true).truncate(true).mode(0o600).open(path)?;
    write!(file, "{until:.3}\n")?;
    file.sync_all()?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(path, fs::Permissions::from_mode(0o600))?;
    }
    Ok(until)
}

pub fn window_open(path: &Path) -> bool {
    let Ok(text) = fs::read_to_string(path) else { return false };
    let Ok(until) = text.trim().parse::<f64>() else { return false };
    let t = now();
    t < until && until <= t + PAIR_SECONDS + 5.0
}

pub fn close_window(path: &Path) -> bool {
    match fs::remove_file(path) {
        Ok(()) => true,
        Err(err) if err.kind() == io::ErrorKind::NotFound => false,
        Err(_) => false,
    }
}

fn applescript_quote(text: &str) -> String {
    text.replace('\\', "\\\\").replace('"', "\\\"")
}

/// Ask on this Mac whether the page at `origin` may use the helper. True only on Allow.
/// Anywhere but macOS there is no dialog, so the answer is no.
pub fn mac_consent(origin: &str) -> bool {
    if !cfg!(target_os = "macos") {
        return false;
    }
    let prompt = format!(
        "Allow Plexus Diagram in Roam ({}) to use the parse helper on this Mac?",
        applescript_quote(origin)
    );
    let script = format!(
        "display dialog \"{prompt}\" buttons {{\"Don\u{2019}t Allow\", \"Allow\"}} default button \"Allow\" with title \"Plexus parse helper\" giving up after 60"
    );
    let Ok(done) = std::process::Command::new("osascript").arg("-e").arg(script).output() else {
        return false;
    };
    let out = String::from_utf8_lossy(&done.stdout);
    done.status.success() && out.contains("button returned:Allow") && !out.contains("gave up:true")
}

fn now() -> f64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_secs_f64()).unwrap_or(0.0)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn window_is_one_shot() {
        let path = std::env::temp_dir().join(format!("pxd-pair-{}-{}.txt", std::process::id(), now() as u64));
        let _ = fs::remove_file(&path);
        open_window(&path, PAIR_SECONDS).unwrap();
        assert!(window_open(&path));
        assert!(close_window(&path));
        assert!(!window_open(&path));
        assert!(!close_window(&path));
    }

    #[test]
    fn applescript_quote_escapes_quotes_and_backslashes() {
        assert_eq!(applescript_quote(r#"a"b\c"#), r#"a\"b\\c"#);
    }
}
