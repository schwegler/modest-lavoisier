// Prevents additional console window on Windows in release, DO NOT REMOVE!!
// Touch timestamp: 2026-06-03T20:10:30Z
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    native_nodes_lib::run()
}
