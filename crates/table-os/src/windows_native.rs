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
/// The virtual key of the button the owner treats as primary. GetAsyncKeyState reads the PHYSICAL
/// buttons, so with the buttons swapped (SM_SWAPBUTTON) the primary one is the physical right.
pub(crate) const fn primary_button_vk(swapped: bool) -> i32 {
    if swapped { 0x02 } else { 0x01 }
}
/// Whether the primary mouse button (as the owner configured it) is held down right now.
pub fn primary_mouse_pressed() -> bool {
    use windows::Win32::UI::{
        Input::KeyboardAndMouse::GetAsyncKeyState,
        WindowsAndMessaging::{GetSystemMetrics, SM_SWAPBUTTON},
    };
    // SAFETY: GetSystemMetrics takes a metric index and GetAsyncKeyState a virtual-key value;
    // neither has input pointers.
    unsafe { GetAsyncKeyState(primary_button_vk(GetSystemMetrics(SM_SWAPBUTTON) != 0)) < 0 }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn the_primary_button_follows_the_swap_setting() {
        assert_eq!(primary_button_vk(false), 0x01);
        assert_eq!(primary_button_vk(true), 0x02);
    }
    /// Flips the system's button mapping for a moment; run alone: `cargo test -p table-os -- --ignored`.
    #[test]
    #[ignore = "changes the OS mouse-button mapping while it runs"]
    fn the_os_swap_setting_selects_the_right_virtual_key() {
        use windows::Win32::UI::{
            Input::KeyboardAndMouse::SwapMouseButton,
            WindowsAndMessaging::{GetSystemMetrics, SM_SWAPBUTTON},
        };
        // SAFETY: both calls take plain values; the previous mapping is restored below.
        let was = unsafe { SwapMouseButton(true) };
        let swapped = unsafe { GetSystemMetrics(SM_SWAPBUTTON) } != 0;
        let vk = primary_button_vk(swapped);
        let _ = unsafe { SwapMouseButton(was.as_bool()) };
        assert!(swapped);
        assert_eq!(vk, 0x02);
    }
}
