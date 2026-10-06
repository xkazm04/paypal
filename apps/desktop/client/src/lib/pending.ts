// Single import point for the safe display projections, now generated from Rust.
export type { DealDisplay } from '@bindings/DealDisplay';
export type { TranscriptStep } from '@bindings/TranscriptStep';
export type { CounterpartyDisplay } from '@bindings/CounterpartyDisplay';
export type { PendingPairing } from '@bindings/PendingPairing';
import type { CommandContract } from '@bindings/CommandContract';
export type PendingContract = Pick<CommandContract, 'approval_selection' | 'deal_display' | 'deal_transcript' | 'counterparty_list'>;
export const PENDING_COMMANDS: ReadonlyArray<keyof PendingContract> = ['approval_selection', 'deal_display', 'deal_transcript', 'counterparty_list'];
