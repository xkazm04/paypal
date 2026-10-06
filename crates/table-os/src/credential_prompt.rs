use async_trait::async_trait;
use table_client::{CommandError, CredentialArgs, ErrorCode};
use table_runtime::{credentials::CredentialPrompt, vault::CredentialEntry};
use windows::{
    Win32::{
        Foundation::{ERROR_CANCELLED, ERROR_SUCCESS, HWND},
        Graphics::Gdi::HBITMAP,
        Security::Credentials::*,
    },
    core::{BOOL, PCWSTR, w},
};
use zeroize::Zeroizing;
#[derive(Debug)]
pub struct WindowsCredentialPrompt;
#[async_trait]
impl CredentialPrompt for WindowsCredentialPrompt {
    async fn prompt(
        &self,
        provider: CredentialArgs,
        window: isize,
    ) -> Result<CredentialEntry, CommandError> {
        if window == 0 {
            return Err(error(ErrorCode::Permission, "Approval window is missing"));
        }
        tokio::task::spawn_blocking(move || {
            let message = match provider {
                CredentialArgs::PaypalSandbox => {
                    "Client id in Username; client secret in Password. Sandbox only."
                }
                CredentialArgs::Channel3 => {
                    "Enter the Channel3 key in Password. Username is unused."
                }
            };
            let message = message.encode_utf16().chain(Some(0)).collect::<Vec<_>>();
            let info = CREDUI_INFOW {
                cbSize: u32::try_from(std::mem::size_of::<CREDUI_INFOW>()).map_err(|_| {
                    error(ErrorCode::Unavailable, "Native credential UI unavailable")
                })?,
                hwndParent: HWND(window as *mut _),
                pszMessageText: PCWSTR(message.as_ptr()),
                pszCaptionText: w!("The Table · API credentials"),
                hbmBanner: HBITMAP::default(),
            };
            let mut username = Zeroizing::new(vec![0u16; 514]);
            let mut password = Zeroizing::new(vec![0u16; 257]);
            let mut save = BOOL(0);
            if provider == CredentialArgs::Channel3 {
                for (slot, ch) in username.iter_mut().zip("Channel3".encode_utf16()) {
                    *slot = ch;
                }
            }
            // SAFETY: all buffers have fixed bounded lengths, remain alive for this
            // synchronous call, and contain space for a NUL. HWND comes from Tauri's
            // live approval window. DO_NOT_PERSIST forbids the dialog saving anything;
            // only the actor may write the result to its own keyring entry.
            let result = unsafe {
                CredUIPromptForCredentialsW(
                    Some(&info),
                    w!("TheTable.ApiCredentialEntry"),
                    None,
                    0,
                    &mut username,
                    &mut password,
                    Some(&mut save),
                    CREDUI_FLAGS_GENERIC_CREDENTIALS
                        | CREDUI_FLAGS_ALWAYS_SHOW_UI
                        | CREDUI_FLAGS_DO_NOT_PERSIST
                        | CREDUI_FLAGS_EXCLUDE_CERTIFICATES,
                )
            };
            if result == ERROR_CANCELLED {
                return Err(error(ErrorCode::Permission, "Credential entry cancelled"));
            }
            if result != ERROR_SUCCESS {
                return Err(error(
                    ErrorCode::Unavailable,
                    "Native credential entry failed",
                ));
            }
            let decode = |buffer: &[u16]| -> Result<Zeroizing<String>, CommandError> {
                let end = buffer
                    .iter()
                    .position(|ch| *ch == 0)
                    .ok_or_else(|| error(ErrorCode::Invalid, "Invalid credential encoding"))?;
                String::from_utf16(&buffer[..end])
                    .map(Zeroizing::new)
                    .map_err(|_| error(ErrorCode::Invalid, "Invalid credential encoding"))
            };
            let secret = decode(&password)?;
            match provider {
                CredentialArgs::PaypalSandbox => Ok(CredentialEntry::PaypalSandbox {
                    client_id: decode(&username)?,
                    client_secret: secret,
                }),
                CredentialArgs::Channel3 => Ok(CredentialEntry::Channel3 { key: secret }),
            }
        })
        .await
        .map_err(|_| {
            error(
                ErrorCode::Unavailable,
                "Native credential entry task failed",
            )
        })?
    }
}
fn error(code: ErrorCode, message: &str) -> CommandError {
    CommandError {
        code,
        message: message.into(),
    }
}
