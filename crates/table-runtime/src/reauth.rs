use async_trait::async_trait;
use table_client::{CommandError, ErrorCode};
#[async_trait]
pub trait OsReauth: Send + Sync {
    fn supported(&self) -> bool;
    async fn authenticate(&self, window: isize) -> Result<(), CommandError>;
}
#[derive(Debug)]
pub struct UnsupportedReauth;
#[async_trait]
impl OsReauth for UnsupportedReauth {
    fn supported(&self) -> bool {
        false
    }
    async fn authenticate(&self, _: isize) -> Result<(), CommandError> {
        Err(CommandError {
            code: ErrorCode::Unsupported,
            message: "OS authentication is unsupported on this platform".into(),
        })
    }
}
/// E2E only. Stands in for the OS prompt so an automated run can unlock the wallet. It exists only in
/// debug builds (`debug_assertions`), so a release binary has no such type to select; the shell picks
/// it only when `TABLE_E2E_AUTOUNLOCK=1` is set. It signs nothing by itself: every mandate, payment and
/// release still goes through the approval window's own checks.
#[cfg(debug_assertions)]
#[derive(Debug)]
pub struct E2eAutoReauth;
#[cfg(debug_assertions)]
#[async_trait]
impl OsReauth for E2eAutoReauth {
    fn supported(&self) -> bool {
        true
    }
    async fn authenticate(&self, _: isize) -> Result<(), CommandError> {
        Ok(())
    }
}
/// The re-authentication the shell uses: the OS prompt, or (debug builds with `TABLE_E2E_AUTOUNLOCK=1`) the E2E stand-in.
pub fn shell_reauth(os: std::sync::Arc<dyn OsReauth>) -> std::sync::Arc<dyn OsReauth> {
    #[cfg(debug_assertions)]
    if std::env::var("TABLE_E2E_AUTOUNLOCK").as_deref() == Ok("1") {
        return std::sync::Arc::new(E2eAutoReauth);
    }
    os
}
