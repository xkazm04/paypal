//! Safe acts (table_client::acts): reversible, no money, main window only.
use super::*;
#[tauri::command]
pub(super) async fn deal_lapse_undo(
    window: WebviewWindow,
    state: State<'_, DesktopState>,
    args: DealArgs,
) -> Result<(), CommandError> {
    ask(&window, &state, None, Action::LapseUndo(args.deal_id)).await
}
#[tauri::command]
pub(super) async fn agent_pause(
    window: WebviewWindow,
    state: State<'_, DesktopState>,
    args: AgentArgs,
) -> Result<(), CommandError> {
    ask(&window, &state, None, Action::AgentPause(args.agent)).await
}
#[tauri::command]
pub(super) async fn agent_resume(
    window: WebviewWindow,
    state: State<'_, DesktopState>,
    args: AgentArgs,
) -> Result<(), CommandError> {
    ask(&window, &state, None, Action::AgentResume(args.agent)).await
}
#[tauri::command]
pub(super) async fn assistant_act(
    window: WebviewWindow,
    state: State<'_, DesktopState>,
    args: AssistantActArgs,
) -> Result<(), CommandError> {
    ask(&window, &state, None, Action::AssistantAct(args)).await
}
