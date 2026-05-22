use serde::Serialize;
use std::sync::Mutex;
use tauri::{Emitter, Manager};
use tauri_plugin_cli::CliExt;

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct FileRequest {
    path: String,
    start_line: Option<u32>,
    end_line: Option<u32>,
}

struct InitialRequest(Mutex<Option<FileRequest>>);

fn parse_args_to_request(args: &[String]) -> Option<FileRequest> {
    let mut path: Option<String> = None;
    let mut start_line: Option<u32> = None;
    let mut end_line: Option<u32> = None;

    let mut i = 1;
    while i < args.len() {
        match args[i].as_str() {
            "--start-line" => {
                if i + 1 < args.len() {
                    start_line = args[i + 1].parse().ok();
                    i += 2;
                    continue;
                }
            }
            "--end-line" => {
                if i + 1 < args.len() {
                    end_line = args[i + 1].parse().ok();
                    i += 2;
                    continue;
                }
            }
            arg if !arg.starts_with('-') => {
                if path.is_none() {
                    path = Some(arg.to_string());
                }
            }
            _ => {}
        }
        i += 1;
    }

    path.map(|p| FileRequest {
        path: p,
        start_line,
        end_line,
    })
}

#[tauri::command]
fn get_initial_request(state: tauri::State<'_, InitialRequest>) -> Option<FileRequest> {
    state.0.lock().unwrap().take()
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_cli::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_single_instance::init(|app, argv, _cwd| {
            if let Some(request) = parse_args_to_request(&argv) {
                let _ = app.emit("new-file-request", request);
            }
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.show();
                let _ = window.set_focus();
            }
        }))
        .setup(|app| {
            let initial_request = match app.cli().matches() {
                Ok(matches) => {
                    if let Some(path_arg) = matches.args.get("path") {
                        if let Some(path_str) = path_arg.value.as_str() {
                            if !path_str.is_empty() {
                                let mut start_line: Option<u32> = None;
                                let mut end_line: Option<u32> = None;

                                if let Some(sl) = matches.args.get("start-line") {
                                    if let Some(n) = sl.value.as_str().and_then(|s| s.parse().ok()) {
                                        start_line = Some(n);
                                    }
                                }
                                if let Some(el) = matches.args.get("end-line") {
                                    if let Some(n) = el.value.as_str().and_then(|s| s.parse().ok()) {
                                        end_line = Some(n);
                                    }
                                }

                                Some(FileRequest {
                                    path: path_str.to_string(),
                                    start_line,
                                    end_line,
                                })
                            } else {
                                None
                            }
                        } else {
                            None
                        }
                    } else {
                        None
                    }
                }
                Err(e) => {
                    eprintln!("CLI parse error: {e}");
                    None
                }
            };
            app.manage(InitialRequest(Mutex::new(initial_request)));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![get_initial_request])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
