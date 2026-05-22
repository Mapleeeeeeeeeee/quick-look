use serde::Serialize;
use tauri::{Emitter, Manager};
use tauri_plugin_cli::CliExt;

#[derive(Clone, Serialize)]
struct FileRequest {
    path: String,
    start_line: Option<u32>,
    end_line: Option<u32>,
}

fn parse_args_to_request(args: &[String]) -> Option<FileRequest> {
    let mut path: Option<String> = None;
    let mut start_line: Option<u32> = None;
    let mut end_line: Option<u32> = None;

    let mut i = 1; // skip argv[0]
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

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_cli::init())
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
            match app.cli().matches() {
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

                                let request = FileRequest {
                                    path: path_str.to_string(),
                                    start_line,
                                    end_line,
                                };
                                let _ = app.emit("file-ready", request);
                            }
                        }
                    }
                }
                Err(_) => {}
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
