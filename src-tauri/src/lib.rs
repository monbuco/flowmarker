use std::fs::File;
use std::io::{Read, Write};
use zip::write::FileOptions;
use zip::ZipWriter;
use zip::read::ZipArchive;

#[tauri::command]
fn save_flm(path: String, document_json: String) -> Result<(), String> {
    // Create or open the ZIP file
    let file = File::create(&path).map_err(|e| format!("Failed to create file: {}", e))?;
    let mut zip = ZipWriter::new(file);
    
    // Add document.json to the ZIP
    let options = FileOptions::default()
        .compression_method(zip::CompressionMethod::Deflated)
        .unix_permissions(0o644);
    
    zip.start_file("document.json", options)
        .map_err(|e| format!("Failed to add file to ZIP: {}", e))?;
    
    zip.write_all(document_json.as_bytes())
        .map_err(|e| format!("Failed to write to ZIP: {}", e))?;
    
    zip.finish()
        .map_err(|e| format!("Failed to finalize ZIP: {}", e))?;
    
    Ok(())
}

#[tauri::command]
fn load_flm(path: String) -> Result<String, String> {
    // Open the ZIP file
    let file = File::open(&path).map_err(|e| format!("Failed to open file: {}", e))?;
    let mut archive = ZipArchive::new(file).map_err(|e| format!("Failed to read ZIP: {}", e))?;
    
    // Find and read document.json
    let mut document_file = archive
        .by_name("document.json")
        .map_err(|e| format!("document.json not found in .flm file: {}", e))?;
    
    let mut document_json = String::new();
    document_file
        .read_to_string(&mut document_json)
        .map_err(|e| format!("Failed to read document.json: {}", e))?;
    
    // Validate format (basic check)
    let doc: serde_json::Value = serde_json::from_str(&document_json)
        .map_err(|e| format!("Invalid JSON in document.json: {}", e))?;
    
    if doc.get("format").and_then(|v| v.as_str()) != Some("flowmark") {
        return Err("Invalid format: expected 'flowmark'".to_string());
    }
    
    Ok(document_json)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
    .plugin(tauri_plugin_fs::init())
    .plugin(tauri_plugin_dialog::init())
    .invoke_handler(tauri::generate_handler![save_flm, load_flm])
    .setup(|app| {
      if cfg!(debug_assertions) {
        app.handle().plugin(
          tauri_plugin_log::Builder::default()
            .level(log::LevelFilter::Info)
            .build(),
        )?;
      }
      Ok(())
    })
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}
