/// Native Nodes — Tauri Backend
///
/// Registers plugins for filesystem access, native dialogs,
/// and persisted directory scope across restarts.

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_persisted_scope::init())
        .run(tauri::generate_context!())
        .expect("error while running Native Nodes");
}
