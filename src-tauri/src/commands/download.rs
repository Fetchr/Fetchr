use std::sync::Arc;

use tauri::State;

use crate::jobs::types::{Job, JobSpec};
use crate::AppState;

#[tauri::command]
pub fn enqueue_job(state: State<'_, AppState>, spec: JobSpec) -> Job {
    state.queue.enqueue(spec)
}

#[tauri::command]
pub fn start_queue(state: State<'_, AppState>, max_concurrent: Option<usize>) {
    let q: Arc<_> = state.queue.clone();
    // reset the paused flag and start draining
    q.clone().resume(max_concurrent.unwrap_or(1));
}

#[tauri::command]
pub fn pause_queue(state: State<'_, AppState>) {
    state.queue.pause();
}

#[tauri::command]
pub fn cancel_job(state: State<'_, AppState>, id: String) {
    state.queue.cancel(&id);
}

#[tauri::command]
pub fn remove_job(state: State<'_, AppState>, id: String) -> bool {
    state.queue.remove(&id)
}

#[tauri::command]
pub fn move_job(state: State<'_, AppState>, id: String, direction: String) -> bool {
    state.queue.move_job(&id, &direction)
}

#[tauri::command]
pub fn list_jobs(state: State<'_, AppState>) -> Vec<Job> {
    state.queue.list()
}

#[tauri::command]
pub fn clear_completed(state: State<'_, AppState>) {
    state.queue.clear_completed();
}
