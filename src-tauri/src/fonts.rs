/// Probe the same system font families used by the interface. GTK objects must
/// stay on the main thread. No fonts are installed or system settings changed.
#[tauri::command]
pub async fn chinese_font_support(
    window: tauri::WebviewWindow,
    text: String,
) -> Result<bool, String> {
    if text.trim().is_empty() || text.len() > 32 * 1024 {
        return Err("Invalid font probe text".into());
    }
    #[cfg(target_os = "linux")]
    {
        use gtk::prelude::*;
        let (sender, receiver) = tokio::sync::oneshot::channel();
        let target = window.clone();
        window
            .run_on_main_thread(move || {
                let result = target
                    .gtk_window()
                    .map_err(|e| e.to_string())
                    .and_then(|widget| {
                        let context = widget.pango_context();
                        if context.font_map().is_none() {
                            return Err("System font map is unavailable".into());
                        }
                        let layout = gtk::pango::Layout::new(&context);
                        layout.set_font_description(Some(
                            &gtk::pango::FontDescription::from_string(
                                "Segoe UI,Microsoft YaHei UI,sans-serif 14",
                            ),
                        ));
                        layout.set_text(&text);
                        Ok(layout.unknown_glyphs_count() == 0)
                    });
                let _ = sender.send(result);
            })
            .map_err(|e| e.to_string())?;
        receiver.await.map_err(|e| e.to_string())?
    }
    #[cfg(not(target_os = "linux"))]
    {
        let _ = window;
        Ok(true)
    }
}
