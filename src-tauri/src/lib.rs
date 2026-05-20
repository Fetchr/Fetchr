mod app_log;
mod binaries;
mod chat_overlay;
mod commands;
mod hls_proxy;
mod jobs;
mod license;
mod proxy;
mod remote;
mod telemetry;
mod updater;

use std::sync::Arc;

use app_log::AppLogger;
use jobs::queue::QueueManager;
use tauri::Manager;

pub struct AppState {
    pub queue: Arc<QueueManager>,
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "info,fetchr_lib=debug".into()),
        )
        .init();

    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_fs::init())
        .setup(|app| {
            if let Err(err) = hls_proxy::start() {
                tracing::error!("Failed to start local HLS proxy: {err}");
            }
            let handle = app.handle().clone();
            let logger = AppLogger::new();
            let queue = Arc::new(QueueManager::new(handle, logger));
            app.manage(AppState {
                queue: queue.clone(),
            });
            telemetry::track_app_launch();
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::resolve::resolve_stream,
            commands::resolve::resolve_direct_url,
            commands::resolve::probe_duration,
            commands::resolve::fetch_text,
            commands::resolve::fetch_bytes,
            commands::preview::start_stream_preview,
            commands::preview::stop_stream_preview,
            commands::preview::capture_preview_frame,
            commands::preview::validate_chat_render_screenshot_url,
            commands::preview::chat_render_log_action,
            commands::preview::render_chat_json,
            commands::preview::save_overlay_layout_from_preview,
            hls_proxy::proxied_hls_url,
            commands::download::enqueue_job,
            commands::download::start_queue,
            commands::download::pause_queue,
            commands::download::cancel_job,
            commands::download::remove_job,
            commands::download::move_job,
            commands::download::list_jobs,
            commands::download::clear_completed,
            commands::fs_ops::open_folder,
            commands::fs_ops::reveal_file,
            commands::fs_ops::default_download_dir,
            commands::fs_ops::choose_directory,
            commands::fs_ops::choose_image_file,
            commands::fs_ops::read_image_file,
            commands::fs_ops::write_text_file,
            commands::fs_ops::save_text_file_dialog,
            commands::fonts::list_system_fonts,
            commands::system::detect_hardware_preset,
            commands::twitch::twitch_parse_url,
            commands::twitch::twitch_public_vods,
            commands::twitch::twitch_find_m3u8,
            commands::twitch::twitch_tracker_fetch,
            commands::twitch::twitch_tracker_streams,
            commands::twitch::twitch_finder_log_action,
            binaries::detect_binaries,
            license::get_machine_id,
            license::beta_activation_link,
            license::license_status,
            license::activate_license,
            license::reset_license,
            updater::check_for_update,
            updater::install_update,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
