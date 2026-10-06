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
