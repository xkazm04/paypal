#![cfg_attr(all(windows, not(debug_assertions)), windows_subsystem = "windows")]
#[cfg(windows)]
fn main() {
    if let Err(error) = table_desktop::run() {
        eprintln!("The Table could not start: {error}");
        table_os::show_startup_failure(&error.to_string());
    }
}
#[cfg(not(windows))]
fn main() {
    eprintln!(
        "The desktop shell currently targets Windows; use the shared IPC contract on this platform."
    );
}
