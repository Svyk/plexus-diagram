//! Bearer token in `~/Library/Application Support/plexus-parse-helper/token` (mode 0600).

use std::fs::{self, OpenOptions};
use std::io::{self, Read, Write};
use std::path::{Path, PathBuf};

use std::os::unix::fs::OpenOptionsExt;

pub fn app_support_dir() -> PathBuf {
    home_dir().join("Library").join("Application Support").join("plexus-parse-helper")
}

pub fn default_token_file() -> PathBuf {
    app_support_dir().join("token")
}

pub fn home_dir() -> PathBuf {
    std::env::var_os("HOME").map(PathBuf::from).unwrap_or_else(|| PathBuf::from("/tmp"))
}

pub fn load_or_create_token(path: &Path) -> io::Result<(String, bool)> {
    if path.is_file() {
        let token = fs::read_to_string(path)?.trim().to_string();
        if !token.is_empty() {
            return Ok((token, false));
        }
    }
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    let token = token_urlsafe(32);
    let mut file = OpenOptions::new().write(true).create(true).truncate(true).mode(0o600).open(path)?;
    file.write_all(token.as_bytes())?;
    file.write_all(b"\n")?;
    file.sync_all()?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(path, fs::Permissions::from_mode(0o600))?;
    }
    Ok((token, true))
}

pub fn token_matches(header: Option<&str>, token: &str) -> bool {
    let Some(header) = header else { return false };
    if token.is_empty() {
        return false;
    }
    let Some(rest) = header.strip_prefix("Bearer ") else { return false };
    ct_eq(rest.trim().as_bytes(), token.as_bytes())
}

fn ct_eq(a: &[u8], b: &[u8]) -> bool {
    let n = a.len().max(b.len());
    let mut diff = (a.len() ^ b.len()) as u8;
    for i in 0..n {
        let x = if i < a.len() { a[i] } else { 0 };
        let y = if i < b.len() { b[i] } else { 0 };
        diff |= x ^ y;
    }
    diff == 0
}

fn token_urlsafe(nbytes: usize) -> String {
    let mut buf = vec![0u8; nbytes];
    let mut urandom = fs::File::open("/dev/urandom").expect("urandom");
    urandom.read_exact(&mut buf).expect("urandom");
    const TABLE: &[u8] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
    let mut out = String::new();
    let mut i = 0;
    while i + 3 <= buf.len() {
        let n = ((buf[i] as u32) << 16) | ((buf[i + 1] as u32) << 8) | buf[i + 2] as u32;
        out.push(TABLE[((n >> 18) & 63) as usize] as char);
        out.push(TABLE[((n >> 12) & 63) as usize] as char);
        out.push(TABLE[((n >> 6) & 63) as usize] as char);
        out.push(TABLE[(n & 63) as usize] as char);
        i += 3;
    }
    if i < buf.len() {
        let mut n = (buf[i] as u32) << 16;
        out.push(TABLE[((n >> 18) & 63) as usize] as char);
        if i + 1 < buf.len() {
            n |= (buf[i + 1] as u32) << 8;
            out.push(TABLE[((n >> 12) & 63) as usize] as char);
            out.push(TABLE[((n >> 6) & 63) as usize] as char);
        } else {
            out.push(TABLE[((n >> 12) & 63) as usize] as char);
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn bearer_compare_trims_and_rejects_a_mismatch() {
        assert!(token_matches(Some("Bearer secret"), "secret"));
        assert!(token_matches(Some("Bearer  secret  "), "secret"));
        assert!(!token_matches(Some("Bearer secre"), "secret"));
        assert!(!token_matches(Some("secret"), "secret"));
        assert!(!token_matches(None, "secret"));
        assert!(!token_matches(Some("Bearer secret"), ""));
    }
}
