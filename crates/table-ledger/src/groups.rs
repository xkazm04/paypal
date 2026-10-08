//! Shop around (theme T8): one buyer intent as a group of tables with different paired sellers.
//!
//! The ledger owns the rule that makes a group safe: at most one table of a group holds the
//! buyer's ACCEPT at a time, and at most one table ever agrees. Both are checked inside the
//! transaction that records an ACCEPT (`accept_guard`, called from `commit_negotiation_in`), and
//! the schema refuses any grouped deal reaching AGREED unless it is the group's winner. Every
//! other table is then withdrawn with a signed WITHDRAW (`commit_group_withdraw`): no money moves.
use crate::{
    AuditEntry, Ledger, LedgerError, audit,
    repositories::{Direction, commit_negotiation_in, read_deal},
};
use rusqlite::{Connection, OptionalExtension, TransactionBehavior, params};
use serde_json::json;
use table_core::{
    Deal, DealEvent, DealId, DealKind, DealState, GroupId, MandateId, Side, Timestamp,
};
use table_proto::{Body, VerifiedEnvelope};

/// Most tables one group may hold.
pub const MAX_GROUP_TABLES: usize = 8;
/// The `decided_by` a group withdrawal records: the shop-around rule the owner chose.
pub const GROUP_RULE: &str = "group_rule";

/// A group as recorded.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct GroupRecord {
    pub id: GroupId,
    pub mandate_id: MandateId,
    pub item_ref: String,
    pub opened_at: Timestamp,
    /// The table that agreed; none yet.
    pub winner: Option<DealId>,
    /// Every table of the group, oldest first.
    pub tables: Vec<DealId>,
}
/// A table the group rule withdraws: its group has a winner and the table is still open.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct GroupLoser {
    pub deal_id: DealId,
    pub group_id: GroupId,
    pub winner: DealId,
}

fn parse_id<T: std::str::FromStr>(text: &str, what: &'static str) -> Result<T, LedgerError> {
    text.parse().map_err(|_| LedgerError::Integrity(what))
}
pub(crate) fn group_of(conn: &Connection, id: DealId) -> Result<Option<GroupId>, LedgerError> {
    let text: Option<String> = conn
        .query_row(
            "SELECT group_id FROM deals WHERE id=?1",
            [id.to_string()],
            |r| r.get(0),
        )
        .optional()?
        .ok_or(LedgerError::NotFound)?;
    text.map(|t| parse_id(&t, "group id")).transpose()
}
fn winner_of(conn: &Connection, group: GroupId) -> Result<Option<DealId>, LedgerError> {
    let text: Option<String> = conn.query_row(
        "SELECT winner FROM deal_groups WHERE id=?1",
        [group.to_string()],
        |r| r.get(0),
    )?;
    text.map(|t| parse_id(&t, "deal id")).transpose()
}
/// Whether another table of the group holds our outstanding ACCEPT.
fn sibling_accept_out(conn: &Connection, group: GroupId, id: DealId) -> Result<bool, LedgerError> {
    Ok(conn.query_row(
        "SELECT EXISTS(SELECT 1 FROM deals d JOIN negotiation n ON n.deal_id=d.id WHERE d.group_id=?1 AND d.id!=?2 AND d.state='NEGOTIATING' AND n.own_accept=1)",
        params![group.to_string(), id.to_string()],
        |r| r.get(0),
    )?)
}
/// The shop-around guard, inside the transaction that records an ACCEPT on `deal`.
///
/// Refused (`GroupClosed`) when another table already agreed, or, for our own ACCEPT, when
/// another table holds our outstanding ACCEPT. An ACCEPT that agrees the deal claims the group in
/// the same transaction (`group.won`), so a second agreement can never commit after it.
pub(crate) fn accept_guard(
    conn: &Connection,
    deal: &Deal,
    direction: Direction,
    agrees: bool,
    at: Timestamp,
) -> Result<(), LedgerError> {
    let Some(group) = group_of(conn, deal.id)? else {
        return Ok(());
    };
    let winner = winner_of(conn, group)?;
    if winner.is_some_and(|w| w != deal.id) {
        return Err(LedgerError::GroupClosed);
    }
    if direction == Direction::Outbound && sibling_accept_out(conn, group, deal.id)? {
        return Err(LedgerError::GroupClosed);
    }
    if agrees && winner.is_none() {
        if conn.execute(
            "UPDATE deal_groups SET winner=?1 WHERE id=?2 AND winner IS NULL",
            params![deal.id.to_string(), group.to_string()],
        )? != 1
        {
            return Err(LedgerError::GroupClosed);
        }
        audit::append(
            conn,
            &AuditEntry {
                at,
                actor: "policy".into(),
                action: "group.won".into(),
                deal_id: Some(deal.id),
                detail: json!({"group_id": group}),
            },
        )?;
    }
    Ok(())
}
/// Whether an ACCEPT on `id` would be refused by the group guard now. A read for early, plain
/// refusals; the authoritative check is `accept_guard` in the recording transaction.
fn accept_blocked(conn: &Connection, id: DealId, outbound: bool) -> Result<bool, LedgerError> {
    let Some(group) = group_of(conn, id)? else {
        return Ok(false);
    };
    if winner_of(conn, group)?.is_some_and(|w| w != id) {
        return Ok(true);
    }
    Ok(outbound && sibling_accept_out(conn, group, id)?)
}

impl Ledger {
    /// Groups `tables` as one buyer intent (owner's "Shop around"). Every table must be an open
    /// buyer haggle (PAIRING, LISTED or NEGOTIATING) under the same mandate, for the same item,
    /// with a different counterparty, in no other group, and none may hold our ACCEPT yet. Grouping
    /// only restricts: it moves no money and grants nothing. Writes `group.opened` per table.
    pub fn open_group(
        &mut self,
        group: GroupId,
        tables: &[DealId],
        at: Timestamp,
    ) -> Result<GroupRecord, LedgerError> {
        if tables.len() < 2 || tables.len() > MAX_GROUP_TABLES {
            return Err(LedgerError::Conflict);
        }
        let tx = self
            .conn
            .transaction_with_behavior(TransactionBehavior::Immediate)?;
        let mut deals: Vec<Deal> = Vec::with_capacity(tables.len());
        for id in tables {
            let deal = read_deal(&tx, *id)?;
            let open = matches!(
                deal.state,
                DealState::Pairing | DealState::Listed | DealState::Negotiating
            );
            let accepted: bool = tx.query_row(
                "SELECT EXISTS(SELECT 1 FROM negotiation WHERE deal_id=?1 AND own_accept=1)",
                [id.to_string()],
                |r| r.get(0),
            )?;
            if deal.side != Side::Buyer
                || deal.kind != DealKind::Haggle
                || !open
                || accepted
                || group_of(&tx, *id)?.is_some()
                || deals.iter().any(|d| {
                    d.id == deal.id
                        || d.counterparty == deal.counterparty
                        || d.mandate_id != deal.mandate_id
                        || d.terms.item_ref != deal.terms.item_ref
                })
            {
                return Err(LedgerError::Conflict);
            }
            deals.push(deal);
        }
        let first = deals.first().ok_or(LedgerError::Conflict)?;
        let mandate = first.mandate_id;
        let item = first.terms.item_ref.as_str().to_owned();
        tx.execute(
            "INSERT INTO deal_groups(id,mandate_id,item_ref,opened_at) VALUES (?1,?2,?3,?4)",
            params![group.to_string(), mandate.to_string(), item, at],
        )?;
        for deal in &deals {
            tx.execute(
                "UPDATE deals SET group_id=?1 WHERE id=?2",
                params![group.to_string(), deal.id.to_string()],
            )?;
            audit::append(
                &tx,
                &AuditEntry {
                    at,
                    actor: "owner".into(),
                    action: "group.opened".into(),
                    deal_id: Some(deal.id),
                    detail: json!({"group_id": group, "tables": deals.len()}),
                },
            )?;
        }
        tx.commit()?;
        self.deal_group(group)
    }
    /// The group a deal belongs to, if any.
    pub fn group_of(&self, id: DealId) -> Result<Option<GroupId>, LedgerError> {
        group_of(&self.conn, id)
    }
    /// Whether an ACCEPT on `id` (ours when `outbound`) would be refused by the group rule now.
    pub fn group_accept_blocked(&self, id: DealId, outbound: bool) -> Result<bool, LedgerError> {
        accept_blocked(&self.conn, id, outbound)
    }
    pub fn deal_group(&self, group: GroupId) -> Result<GroupRecord, LedgerError> {
        let (mandate, item, opened, winner): (String, String, Timestamp, Option<String>) = self
            .conn
            .query_row(
                "SELECT mandate_id,item_ref,opened_at,winner FROM deal_groups WHERE id=?1",
                [group.to_string()],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)),
            )
            .optional()?
            .ok_or(LedgerError::NotFound)?;
        let mut q = self.conn.prepare(
            "SELECT id FROM deals WHERE group_id=?1 ORDER BY CAST(created_at AS INTEGER),id",
        )?;
        let tables = q
            .query_map([group.to_string()], |r| r.get::<_, String>(0))?
            .map(|r| parse_id(&r?, "deal id"))
            .collect::<Result<Vec<DealId>, LedgerError>>()?;
        Ok(GroupRecord {
            id: group,
            mandate_id: parse_id(&mandate, "mandate id")?,
            item_ref: item,
            opened_at: opened,
            winner: winner.map(|w| parse_id(&w, "deal id")).transpose()?,
            tables,
        })
    }
    /// Every group, newest first.
    pub fn deal_groups(&self) -> Result<Vec<GroupRecord>, LedgerError> {
        let mut q = self
            .conn
            .prepare("SELECT id FROM deal_groups ORDER BY opened_at DESC, id DESC")?;
        let ids = q
            .query_map([], |r| r.get::<_, String>(0))?
            .map(|r| parse_id(&r?, "group id"))
            .collect::<Result<Vec<GroupId>, LedgerError>>()?;
        ids.into_iter().map(|id| self.deal_group(id)).collect()
    }
    /// Tables the group rule must withdraw: their group has a winner and they are still open.
    pub fn group_losers(&self) -> Result<Vec<GroupLoser>, LedgerError> {
        let mut q = self.conn.prepare(
            "SELECT d.id,g.id,g.winner FROM deals d JOIN deal_groups g ON g.id=d.group_id WHERE g.winner IS NOT NULL AND d.id!=g.winner AND d.state IN ('PAIRING','LISTED','NEGOTIATING') ORDER BY d.id",
        )?;
        let rows = q
            .query_map([], |r| {
                Ok((
                    r.get::<_, String>(0)?,
                    r.get::<_, String>(1)?,
                    r.get::<_, String>(2)?,
                ))
            })?
            .collect::<Result<Vec<_>, _>>()?;
        rows.into_iter()
            .map(|(deal, group, winner)| {
                Ok(GroupLoser {
                    deal_id: parse_id(&deal, "deal id")?,
                    group_id: parse_id(&group, "group id")?,
                    winner: parse_id(&winner, "deal id")?,
                })
            })
            .collect()
    }
    /// Records the group rule's signed WITHDRAW of a losing table, in one transaction: the
    /// `group.withdrawn` row (decided by the group rule), the verified envelope and the WITHDRAWN
    /// transition. Refused unless the deal's group has another winner and the body is a WITHDRAW.
    pub fn commit_group_withdraw(
        &mut self,
        verified: &VerifiedEnvelope,
        at: Timestamp,
    ) -> Result<(), LedgerError> {
        if !matches!(verified.envelope().body, Body::Withdraw { .. }) {
            return Err(LedgerError::Conflict);
        }
        let id = verified.envelope().deal_id;
        let tx = self
            .conn
            .transaction_with_behavior(TransactionBehavior::Immediate)?;
        let group = group_of(&tx, id)?.ok_or(LedgerError::Conflict)?;
        let winner = winner_of(&tx, group)?
            .filter(|w| *w != id)
            .ok_or(LedgerError::Conflict)?;
        audit::append(
            &tx,
            &AuditEntry {
                at,
                actor: "policy".into(),
                action: "group.withdrawn".into(),
                deal_id: Some(id),
                detail: json!({
                    "group_id": group,
                    "winner": winner,
                    "decided_by": GROUP_RULE,
                }),
            },
        )?;
        commit_negotiation_in(
            &tx,
            verified,
            Direction::Outbound,
            None,
            Some(DealEvent::Withdraw),
            at,
        )?;
        tx.commit()?;
        Ok(())
    }
}
