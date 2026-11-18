use std::time::Duration;

/// Foro de la comunidad de Nothing (Flarum). Toda la lectura de datos pasa por aquí,
/// así que si Nothing migra a otra plataforma solo hay que tocar este archivo.
const FORUM_BASE: &str = "https://nothing.community";

/// Pide las últimas discusiones al API JSON de Flarum y devuelve el JSON tal cual.
/// Se hace desde Rust (y no con fetch en el WebView) para evitar los bloqueos de CORS.
#[tauri::command]
async fn fetch_news(tag: Option<String>, limit: Option<u32>) -> Result<String, String> {
    let limit = limit.unwrap_or(8).clamp(1, 20).to_string();
    let tag = tag.map(|t| t.trim().to_string()).filter(|t| !t.is_empty());

    let client = reqwest::Client::builder()
        .user_agent("NothingNewsWidget/0.1 (desktop widget)")
        .timeout(Duration::from_secs(15))
        .build()
        .map_err(|e| e.to_string())?;

    // Primero intentamos incluir el primer post (para el extracto). Si el foro no
    // permite ese include, repetimos la petición sin él.
    for include in ["user,tags,firstPost", "user,tags"] {
        let mut query: Vec<(&str, &str)> = vec![
            ("sort", "-createdAt"),
            ("page[limit]", limit.as_str()),
            ("include", include),
        ];
        if let Some(t) = tag.as_deref() {
            query.push(("filter[tag]", t));
        }

        let response = client
            .get(format!("{FORUM_BASE}/api/discussions"))
            .header("Accept", "application/vnd.api+json, application/json")
            .query(&query)
            .send()
            .await
            .map_err(|e| format!("No se pudo conectar con el foro: {e}"))?;

        let status = response.status();
        if status.is_success() {
            return response.text().await.map_err(|e| e.to_string());
        }
        if status.as_u16() != 400 {
            return Err(format!("El foro respondió con el código {status}"));
        }
    }

    Err("El foro rechazó la petición (400)".into())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        // Recuerda la posición y el tamaño del widget entre arranques.
        .plugin(tauri_plugin_window_state::Builder::default().build())
        .invoke_handler(tauri::generate_handler![fetch_news])
        .run(tauri::generate_context!())
        .expect("error al arrancar el widget");
}
