//! Native credential UI never passes secret values through a webview command.
use crate::vault::CredentialEntry;
use async_trait::async_trait;
use table_client::{CommandError, CredentialArgs};
#[async_trait]
pub trait CredentialPrompt: Send + Sync {
    async fn prompt(
        &self,
        provider: CredentialArgs,
        window: isize,
    ) -> Result<CredentialEntry, CommandError>;
}
#[derive(Debug)]
pub struct UnsupportedCredentialPrompt;
#[async_trait]
impl CredentialPrompt for UnsupportedCredentialPrompt {
    async fn prompt(&self, _: CredentialArgs, _: isize) -> Result<CredentialEntry, CommandError> {
        Err(CommandError {
            code: table_client::ErrorCode::Unsupported,
            message: "Native credential entry is unsupported on this platform".into(),
        })
    }
}
