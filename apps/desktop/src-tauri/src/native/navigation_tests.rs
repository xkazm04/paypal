use super::*;

fn url(text: &str) -> Url {
    text.parse().unwrap_or_else(|_| panic!("{text}"))
}

#[test]
fn app_origin_is_allowed() {
    for text in [
        "http://tauri.localhost/index.html",
        "https://tauri.localhost/approval.html?x=1",
        "tauri://localhost/tumbler.html",
    ] {
        assert!(allowed(&url(text), false), "{text}");
    }
}

#[test]
fn external_and_file_urls_are_refused() {
    for text in [
        "https://example.com/",
        "http://example.com/index.html",
        "file:///C:/Windows/win.ini",
        "data:text/html,<script>1</script>",
        "javascript:alert(1)",
        "about:blank",
    ] {
        assert!(!allowed(&url(text), false), "{text}");
        assert!(!allowed(&url(text), true), "{text}");
    }
}

#[test]
fn look_alike_hosts_are_refused() {
    for text in [
        "https://tauri.localhost.evil.com/",
        "https://evil.com/tauri.localhost",
        "https://xtauri.localhost/",
        "http://tauri.localhost@evil.com/",
        "http://tauri.localhost:8080/",
        "tauri://localhost.evil.com/",
        "https://localhost.evil.com/",
        "http://127.0.0.1.evil.com/",
        "ftp://tauri.localhost/",
    ] {
        assert!(!allowed(&url(text), false), "{text}");
        assert!(!allowed(&url(text), true), "{text}");
    }
}

#[test]
fn loopback_dev_server_is_debug_only() {
    for text in ["http://localhost:1420/", "http://127.0.0.1:5173/x"] {
        assert!(allowed(&url(text), true), "{text}");
        assert!(!allowed(&url(text), false), "{text}");
    }
}
