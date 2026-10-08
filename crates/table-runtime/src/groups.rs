//! Shop around (theme T8): the owner groups open buyer tables for one item, each with a different
//! paired seller, under one signed mandate. The policy negotiator bargains on each table on its
//! own; the ledger lets at most one table agree (the guard runs in the transaction that records
//! the ACCEPT), and the wallet then withdraws every other table with a signed WITHDRAW decided by
//! the group rule. Nothing here moves money or calls PayPal: the winning table settles exactly
//! like a single deal.
use crate::{Runtime, app, invalid};
use table_client::*;
use table_core::*;

impl Runtime {
    /// `deal_group_open` (main): groups the owner's open buyer tables. Grouping only restricts.
    /// Every table's mandate must still be in force (its agent signs the group's withdrawals).
    pub(crate) fn open_group(
        &mut self,
        args: DealGroupOpenArgs,
    ) -> Result<DealGroupView, CommandError> {
        for id in &args.deal_ids {
            let deal = app(self.pipeline.wallet.ledger.get_deal(*id))?;
            if self.mandate_retired(&deal)? {
                return Err(invalid());
            }
        }
        let group = GroupId(ulid::Ulid::new());
        let record = self
            .pipeline
            .wallet
            .ledger
            .open_group(group, &args.deal_ids, self.clock.now())
            .map_err(|e| match e {
                table_ledger::LedgerError::Conflict => invalid(),
                other => table_app::Error::from(other).into(),
            })?;
        self.group_view(&record)
    }
    /// `deal_groups` (main): every group, newest first, with typed signed prices only.
    pub(crate) fn group_views(&self) -> Result<Vec<DealGroupView>, CommandError> {
        app(self.pipeline.wallet.ledger.deal_groups())?
            .iter()
            .map(|g| self.group_view(g))
            .collect()
    }
    fn group_view(&self, group: &table_ledger::GroupRecord) -> Result<DealGroupView, CommandError> {
        let ledger = &self.pipeline.wallet.ledger;
        let mut tables = Vec::with_capacity(group.tables.len());
        for id in &group.tables {
            let deal = app(ledger.get_deal(*id))?;
            // Prices come from the verified signed transcript, never from the seller's words.
            let steps = app(ledger.deal_transcript(*id))?;
            let priced = |by: TranscriptBy| {
                steps
                    .iter()
                    .rev()
                    .filter(|s| s.by == by)
                    .find(|s| {
                        matches!(
                            s.typ,
                            TranscriptType::Listing
                                | TranscriptType::Offer
                                | TranscriptType::Counter
                        )
                    })
                    .and_then(|s| s.price)
            };
            tables.push(GroupTable {
                deal_id: deal.id,
                counterparty: deal.counterparty.clone(),
                state: deal.state,
                seller_price: priced(TranscriptBy::Them),
                our_price: priced(TranscriptBy::You),
                closed_by_group: group.winner.is_some_and(|w| w != deal.id)
                    && deal.state == DealState::Withdrawn,
            });
        }
        Ok(DealGroupView {
            group_id: group.id,
            item_ref: ItemRef::new(group.item_ref.clone()).map_err(|_| invalid())?,
            opened_at: group.opened_at,
            winner: group.winner,
            tables,
        })
    }
    /// The group rule: every open table of a group another table won is withdrawn with a signed
    /// WITHDRAW, under the deal's own agent key. Runs on every tick and right after anything that
    /// can agree a deal (an agent intent, the owner's accept, an inbound message), so a crash
    /// between the agreement and the withdrawals is finished on the next tick. A table whose
    /// mandate's agent key is not available stays as it is: the guard already refuses any ACCEPT
    /// on it, and its deadline lets it lapse with no money moved.
    pub(crate) fn close_groups(&mut self) -> Result<(), CommandError> {
        let losers = app(self.pipeline.wallet.ledger.group_losers())?;
        let mut failure = None;
        for loser in losers {
            let deal = app(self.pipeline.wallet.ledger.get_deal(loser.deal_id))?;
            if self.mandate_retired(&deal)? || self.select_signer(loser.deal_id).is_err() {
                continue;
            }
            if let Err(error) = self
                .pipeline
                .wallet
                .withdraw_for_group(&loser, self.clock.now())
            {
                failure.get_or_insert(CommandError::from(error));
            }
        }
        failure.map_or(Ok(()), Err)
    }
}
