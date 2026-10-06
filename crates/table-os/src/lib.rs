//! Narrow, audited OS interop boundary. Unsafe calls are confined to the Windows module.
#[cfg(windows)]
#[allow(unsafe_code)]
mod windows_native;
#[cfg(not(windows))]
pub use table_runtime::credentials::UnsupportedCredentialPrompt as WindowsCredentialPrompt;
#[cfg(not(windows))]
pub use table_runtime::reauth::UnsupportedReauth as WindowsHello;
#[cfg(windows)]
pub use windows_native::*;
#[cfg(windows)]
#[allow(unsafe_code)]
mod credential_prompt;
#[cfg(windows)]
pub use credential_prompt::*;
