//! Which URLs the app's webviews may navigate to: the Tauri app origin, and in debug builds the
//! loopback dev server. Everything else (external sites, `file:`, look-alike hosts) is refused.
use tauri::Url;

/// Whether a webview may navigate to `url`. Pure: the dev-server allowance is a parameter so both
/// build flavours can be tested.
fn allowed(url: &Url, dev: bool) -> bool {
    if !url.username().is_empty() || url.password().is_some() {
        return false;
    }
    match (url.scheme(), url.host_str(), url.port()) {
        // Windows and Android serve the bundle from `http(s)://tauri.localhost`.
        ("http" | "https", Some("tauri.localhost"), None) => true,
        // macOS and Linux serve it from `tauri://localhost`.
        ("tauri", Some("localhost"), None) => true,
        ("http" | "https", Some("localhost" | "127.0.0.1" | "[::1]"), _) => dev,
        _ => false,
    }
}

/// The `on_navigation` handler of every window: the app origin only (plus loopback when debugging).
pub(super) fn permits(url: &Url) -> bool {
    allowed(url, cfg!(debug_assertions))
}

#[cfg(test)]
#[path = "navigation_tests.rs"]
mod tests;
