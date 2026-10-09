//! `plexus-parse-helper-rs serve|ocr|token|pair`
//!
//! Listens on 127.0.0.1 only. The default port is 48766 so it can run beside the
//! Python helper on 48765.

mod auth;
mod cache;
mod hashutil;
mod ocr;
mod pair;
mod pdf;
mod server;

use std::path::{Path, PathBuf};
use std::sync::atomic::AtomicU32;
use std::sync::{Arc, Mutex};

use serde_json::Value;

use crate::auth::{default_token_file, load_or_create_token};
use crate::cache::{default_cache_root, ParseCache};
use crate::pair::{default_pair_file, open_window, PAIR_SECONDS};
use crate::server::{router, App, HELPER_NAME};

const DEFAULT_PORT: u16 = 48766;

fn main() {
    let code = match run(std::env::args().skip(1).collect()) {
        Ok(code) => code,
        Err(err) => {
            eprintln!("error: {err}");
            1
        }
    };
    std::process::exit(code);
}

fn run(args: Vec<String>) -> Result<i32, String> {
    let cmd = args.first().map(String::as_str).unwrap_or("help");
    match cmd {
        "serve" => serve(&args[1..]),
        "ocr" => ocr_cmd(&args[1..]),
        "token" => {
            let path = flag_path(&args[1..], "--token-file").unwrap_or_else(default_token_file);
            let (token, created) = load_or_create_token(&path).map_err(|err| err.to_string())?;
            if created {
                eprintln!("Token: {token}");
                eprintln!("Paste this in Roam → Settings → Plexus Diagram → Parse helper token");
            } else {
                println!("{token}");
            }
            Ok(0)
        }
        "pair" => {
            let rest = &args[1..];
            let token_path = flag_path(rest, "--token-file").unwrap_or_else(default_token_file);
            let pair_path = flag_path(rest, "--pair-file").unwrap_or_else(default_pair_file);
            let seconds = flag_value(rest, "--seconds").and_then(|s| s.parse().ok()).unwrap_or(PAIR_SECONDS);
            let _ = load_or_create_token(&token_path).map_err(|err| err.to_string())?;
            open_window(&pair_path, seconds).map_err(|err| err.to_string())?;
            println!("Pairing is open for {seconds} s.");
            println!("Back to Roam: click Pair.");
            Ok(0)
        }
        _ => {
            eprintln!(
                "usage:\n  plexus-parse-helper-rs serve [--port {DEFAULT_PORT}] [--allow-origin URL] [--token-file PATH] [--pdfium PATH]\n  plexus-parse-helper-rs ocr FILE.pdf [--pages 1,3,5-9] [--cells CELLS.json] [--json OUT]\n  plexus-parse-helper-rs token\n  plexus-parse-helper-rs pair [--seconds 90]"
            );
            Ok(if cmd == "help" || cmd == "--help" { 0 } else { 2 })
        }
    }
}

fn serve(args: &[String]) -> Result<i32, String> {
    let host = flag_value(args, "--host").unwrap_or("127.0.0.1");
    if host != "127.0.0.1" && host != "localhost" {
        return Err("refusing to bind anything but 127.0.0.1".into());
    }
    let port: u16 = flag_value(args, "--port").unwrap_or("48766").parse().map_err(|_| "bad --port".to_string())?;
    let token_path = flag_path(args, "--token-file").unwrap_or_else(default_token_file);
    let (token, created) = load_or_create_token(&token_path).map_err(|err| err.to_string())?;
    if created {
        eprintln!("Token: {token}");
        eprintln!("Paste this in Roam → Settings → Plexus Diagram → Parse helper token");
    }
    let mut allow = std::collections::HashSet::from(["https://roamresearch.com".to_string()]);
    for origin in flags(args, "--allow-origin") {
        allow.insert(origin);
    }
    let pdfium_path = flag_path(args, "--pdfium").unwrap_or_else(default_pdfium);
    if !pdfium_path.is_file() {
        return Err(format!(
            "libpdfium not found at {}. Run tools/parse-helper-rs/fetch-pdfium.sh",
            pdfium_path.display()
        ));
    }
    let cache_root = flag_path(args, "--cache-dir").unwrap_or_else(default_cache_root);
    let state = Arc::new(App {
        token,
        allow,
        pair_path: flag_path(args, "--pair-file").unwrap_or_else(default_pair_file),
        cache: ParseCache::new(cache_root, 5 * 1024 * 1024 * 1024),
        pdfium_path,
        ocr_lock: Mutex::new(()),
        busy: AtomicU32::new(0),
        pair_lock: Mutex::new(()),
    });
    let app = router(state);
    let runtime = tokio::runtime::Builder::new_multi_thread().enable_all().build().map_err(|err| err.to_string())?;
    runtime.block_on(async move {
        let listener = tokio::net::TcpListener::bind(("127.0.0.1", port)).await.map_err(|err| err.to_string())?;
        eprintln!("{HELPER_NAME} {port} (ocr only, no docling)");
        axum::serve(listener, app)
            .with_graceful_shutdown(async {
                let _ = tokio::signal::ctrl_c().await;
            })
            .await
            .map_err(|err| err.to_string())
    })?;
    Ok(0)
}

fn ocr_cmd(args: &[String]) -> Result<i32, String> {
    let pdf = args.iter().find(|a| !a.starts_with("--")).ok_or_else(|| "usage: ocr FILE.pdf".to_string())?;
    let pages = flag_value(args, "--pages").map(parse_pages).transpose()?;
    let cells_path = flag_value(args, "--cells");
    let json_path = flag_value(args, "--json");
    let pdfium_path = flag_path(args, "--pdfium").unwrap_or_else(default_pdfium);
    let pdfium = pdf::bind(&pdfium_path)?;
    let value = if let Some(cells_path) = cells_path {
        let text = std::fs::read_to_string(cells_path).map_err(|err| err.to_string())?;
        let cells: Vec<Value> = serde_json::from_str(&text).map_err(|err| err.to_string())?;
        ocr::run_cells(&pdfium, Path::new(pdf), &cells)?
    } else {
        ocr::run_pdf(&pdfium, Path::new(pdf), pages.as_ref(), |n, of| eprintln!("page {n}/{of}"))?
    };
    if let Some(path) = json_path {
        if let Some(parent) = Path::new(path).parent() {
            if !parent.as_os_str().is_empty() {
                std::fs::create_dir_all(parent).map_err(|err| err.to_string())?;
            }
        }
        std::fs::write(path, serde_json::to_string(&value).map_err(|err| err.to_string())?).map_err(|err| err.to_string())?;
    }
    if cells_path.is_some() {
        let n = value.get("cells").and_then(|v| v.as_array()).map(|a| a.len()).unwrap_or(0);
        println!("{{\"cells\":{n}}}");
    } else {
        let pages = value.get("pages").and_then(|v| v.as_array()).cloned().unwrap_or_default();
        let summary: Vec<Value> = pages
            .iter()
            .map(|page| {
                serde_json::json!({
                    "n": page.get("n"),
                    "items": page.get("items").and_then(|v| v.as_array()).map(|a| a.len()).unwrap_or(0),
                    "rules": page.get("rules").and_then(|v| v.as_array()).map(|a| a.len()).unwrap_or(0),
                    "deskew": page.get("deskew"),
                })
            })
            .collect();
        println!("{}", serde_json::to_string(&serde_json::json!({"pages": summary})).unwrap());
    }
    Ok(0)
}

fn parse_pages(text: &str) -> Result<Value, String> {
    let mut pages = Vec::new();
    for part in text.split(',') {
        let part = part.trim();
        if part.is_empty() {
            continue;
        }
        if let Some((a, b)) = part.split_once('-') {
            let a: i64 = a.parse().map_err(|_| format!("bad page {part}"))?;
            let b: i64 = b.parse().map_err(|_| format!("bad page {part}"))?;
            pages.push(serde_json::json!([a, b]));
        } else {
            let n: i64 = part.parse().map_err(|_| format!("bad page {part}"))?;
            pages.push(serde_json::json!(n));
        }
    }
    Ok(Value::Array(pages))
}

fn default_pdfium() -> PathBuf {
    PathBuf::from(concat!(env!("CARGO_MANIFEST_DIR"), "/vendor/libpdfium.dylib"))
}

fn flag_value<'a>(args: &'a [String], name: &str) -> Option<&'a str> {
    args.iter().position(|a| a == name).and_then(|i| args.get(i + 1)).map(String::as_str)
}

fn flag_path(args: &[String], name: &str) -> Option<PathBuf> {
    flag_value(args, name).map(PathBuf::from)
}

fn flags(args: &[String], name: &str) -> Vec<String> {
    let mut out = Vec::new();
    let mut i = 0;
    while i < args.len() {
        if args[i] == name {
            if let Some(value) = args.get(i + 1) {
                out.push(value.clone());
                i += 2;
                continue;
            }
        }
        i += 1;
    }
    out
}
