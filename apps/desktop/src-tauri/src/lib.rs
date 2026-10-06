//! Windows Tauri shell; the IPC contract and capability tests compile on all platforms.
#[cfg(windows)]
mod native;
#[cfg(windows)]
pub use native::run;
