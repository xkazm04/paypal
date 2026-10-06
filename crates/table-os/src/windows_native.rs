use async_trait::async_trait;
use table_client::{CommandError, ErrorCode};
use table_runtime::reauth::OsReauth;
use windows::{
    Security::Credentials::UI::{
        UserConsentVerificationResult, UserConsentVerifier, UserConsentVerifierAvailability,
    },
    Win32::{
        Foundation::HWND,
        System::WinRT::IUserConsentVerifierInterop,
        UI::{
            Shell::{QUNS_ACCEPTS_NOTIFICATIONS, SHQueryUserNotificationState},
            WindowsAndMessaging::{SW_SHOWNOACTIVATE, ShowWindow},
        },
    },
    core::{HSTRING, factory},
};
use windows_future::IAsyncOperation;
#[derive(Debug)]
pub struct WindowsHello;
fn error(code: ErrorCode, message: &str) -> CommandError {
    CommandError {
        code,
        message: message.into(),
    }
}
#[async_trait]
impl OsReauth for WindowsHello {
    fn supported(&self) -> bool {
        true
    }
    async fn authenticate(&self, window: isize) -> Result<(), CommandError> {
        if window == 0 {
            return Err(error(ErrorCode::Permission, "Approval window is missing"));
        }
        tokio::task::spawn_blocking(move || {
            let availability = UserConsentVerifier::CheckAvailabilityAsync()
                .and_then(|op| op.join())
                .map_err(|_| error(ErrorCode::Unsupported, "Windows Hello is unavailable"))?;
            if availability != UserConsentVerifierAvailability::Available {
                return Err(error(
                    ErrorCode::Unavailable,
                    "Configure Windows Hello to unlock the wallet",
                ));
            }
            let interop: IUserConsentVerifierInterop =
                factory::<UserConsentVerifier, IUserConsentVerifierInterop>().map_err(|_| {
                    error(
                        ErrorCode::Unsupported,
                        "Desktop Windows Hello requires a supported Windows version",
                    )
                })?;
            // SAFETY: HWND originates exclusively from the live Tauri approval window. The
            // COM factory owns its lifetime; windows-rs validates the returned interface.
            let operation: IAsyncOperation<UserConsentVerificationResult> = unsafe {
                interop.RequestVerificationForWindowAsync(
                    HWND(window as *mut _),
                    &HSTRING::from("Unlock The Table wallet"),
                )
            }
            .map_err(|_| error(ErrorCode::Unavailable, "Windows Hello could not start"))?;
            let result = operation
                .join()
                .map_err(|_| error(ErrorCode::Unavailable, "Windows Hello verification failed"))?;
            if result == UserConsentVerificationResult::Verified {
                Ok(())
            } else {
                Err(error(
                    ErrorCode::Permission,
                    "Windows Hello did not verify the owner",
                ))
            }
        })
        .await
        .map_err(|_| error(ErrorCode::Unavailable, "Windows Hello task failed"))?
    }
}
/// Native arrival cannot activate the owner's current foreground application.
pub fn show_without_activation(window: isize) {
    if window != 0 {
        // SAFETY: caller supplies a live Tauri window HWND, never IPC input.
        let _ = unsafe { ShowWindow(HWND(window as *mut _), SW_SHOWNOACTIVATE) };
    }
}
pub fn notifications_suppressed() -> bool {
    // SAFETY: this API has no input pointer and windows-rs owns the output storage.
    (unsafe { SHQueryUserNotificationState() }) != Ok(QUNS_ACCEPTS_NOTIFICATIONS)
}
pub fn left_mouse_pressed() -> bool {
    // SAFETY: GetAsyncKeyState accepts a virtual-key value and has no input pointers.
    (unsafe { windows::Win32::UI::Input::KeyboardAndMouse::GetAsyncKeyState(1) }) < 0
}
