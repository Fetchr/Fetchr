use std::path::{Path, PathBuf};

use tauri::AppHandle;
use tauri_plugin_dialog::DialogExt;
use tauri_plugin_opener::OpenerExt;

#[derive(serde::Serialize)]
pub struct ImageFilePayload {
    bytes: Vec<u8>,
    mime: String,
}

#[tauri::command]
pub fn open_folder(app: AppHandle, path: String) -> Result<(), String> {
    app.opener()
        .open_path(path, None::<&str>)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn reveal_file(app: AppHandle, path: String) -> Result<(), String> {
    let p = PathBuf::from(&path);
    let target = if p.is_file() {
        p.parent().map(|x| x.to_path_buf()).unwrap_or(p.clone())
    } else {
        p
    };
    app.opener()
        .open_path(target.to_string_lossy().to_string(), None::<&str>)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn default_download_dir() -> String {
    dirs::download_dir()
        .or_else(dirs::home_dir)
        .map(|p| p.to_string_lossy().to_string())
        .unwrap_or_default()
}

#[tauri::command]
pub async fn choose_directory(app: AppHandle) -> Option<String> {
    let (tx, rx) = tokio::sync::oneshot::channel::<Option<String>>();
    let tx = std::sync::Mutex::new(Some(tx));
    app.dialog().file().pick_folder(move |path| {
        let p = path.map(|fp| fp.to_string());
        if let Some(sender) = tx.lock().ok().and_then(|mut g| g.take()) {
            let _ = sender.send(p);
        }
    });
    rx.await.ok().flatten()
}

#[tauri::command]
pub async fn choose_image_file(app: AppHandle) -> Option<String> {
    let (tx, rx) = tokio::sync::oneshot::channel::<Option<String>>();
    let tx = std::sync::Mutex::new(Some(tx));
    app.dialog()
        .file()
        .add_filter("Images", &["png", "jpg", "jpeg", "webp"])
        .pick_file(move |path| {
            let p = path.map(|fp| fp.to_string());
            if let Some(sender) = tx.lock().ok().and_then(|mut g| g.take()) {
                let _ = sender.send(p);
            }
        });
    rx.await.ok().flatten()
}

#[tauri::command]
pub async fn read_image_file(path: String) -> Result<ImageFilePayload, String> {
    let path_buf = PathBuf::from(&path);
    let bytes = tokio::fs::read(&path_buf)
        .await
        .map_err(|err| format!("Failed to read image file: {err}"))?;
    Ok(ImageFilePayload {
        bytes,
        mime: image_mime(&path_buf).to_string(),
    })
}

#[tauri::command]
pub async fn write_text_file(path: String, contents: String) -> Result<(), String> {
    let path_buf = PathBuf::from(&path);
    if let Some(parent) = path_buf.parent() {
        tokio::fs::create_dir_all(parent)
            .await
            .map_err(|err| format!("Failed to prepare output directory: {err}"))?;
    }
    tokio::fs::write(&path_buf, contents)
        .await
        .map_err(|err| format!("Failed to write file: {err}"))
}

#[tauri::command]
pub async fn save_text_file_dialog(
    app: AppHandle,
    default_name: String,
    contents: String,
) -> Result<Option<String>, String> {
    let (tx, rx) = tokio::sync::oneshot::channel::<Option<String>>();
    let tx = std::sync::Mutex::new(Some(tx));
    app.dialog()
        .file()
        .set_file_name(&default_name)
        .add_filter("Text logs", &["txt", "jsonl", "log"])
        .save_file(move |path| {
            let p = path.map(|fp| fp.to_string());
            if let Some(sender) = tx.lock().ok().and_then(|mut g| g.take()) {
                let _ = sender.send(p);
            }
        });
    let Some(path) = rx.await.ok().flatten() else {
        return Ok(None);
    };
    write_text_file(path.clone(), contents).await?;
    Ok(Some(path))
}

fn image_mime(path: &Path) -> &'static str {
    match path
        .extension()
        .and_then(|ext| ext.to_str())
        .unwrap_or_default()
        .to_ascii_lowercase()
        .as_str()
    {
        "jpg" | "jpeg" => "image/jpeg",
        "webp" => "image/webp",
        "gif" => "image/gif",
        _ => "image/png",
    }
}
