//! Inbound financial evidence is verified by Rust, independently of agents and windows.
use crate::{Error, Wallet};
use table_core::*;
use table_ledger::{InboxMessage, LedgerError};
use table_proto::Body;
impl Wallet {
    pub fn receive_relay(
        &mut self,
        id: DealId,
        raw: &str,
        category: Category,
        now: Timestamp,
    ) -> Result<(), Error> {
        // Exact signed duplicates (including our own relay echo) are recovery, not a new intent.
        if self
            .ledger
            .has_envelope_hash(id, H256::digest(raw.as_bytes()))?
        {
            return Ok(());
        }
        let verified = self.ledger.preview_inbound(id, raw, now)?;
        match verified.envelope().body {
            Body::Settle { .. } => {
                self.check_mandate(id, category, now)?;
                self.ledger.accept_buyer_settle(&verified, now)?;
            }
            Body::Receipt { .. } => self.ledger.accept_seller_receipt(&verified, now)?,
            _ => self.receive_haggle(id, raw, category, now)?,
        }
        Ok(())
    }
}

/// What the caller's policy decided for one staged inbound message (see [`drain_inbox`]).
#[derive(Debug)]
pub enum InboxOutcome<E> {
    /// The message was applied: its inbox row becomes `applied`.
    Apply,
    /// The message can never apply: its row becomes `rejected`, batched per deal and generation.
    Reject,
    /// The ledger could not decide now: the row stays `pending` for the next pass, and the pass
    /// returns the first such error after finishing every other message.
    Retry(E),
}
impl<E: From<Error>> InboxOutcome<E> {
    /// The receive rule every party shares: a ledger fault (SQL or integrity) is retried, any other
    /// refusal of the message rejects it.
    pub fn of(result: Result<(), Error>) -> Self {
        match result {
            Ok(()) => Self::Apply,
            Err(Error::Ledger(e @ (LedgerError::Sql(_) | LedgerError::Integrity(_)))) => {
                Self::Retry(Error::Ledger(e).into())
            }
            Err(_) => Self::Reject,
        }
    }
}

/// One pass over the relay inbox, for the wallet runtime and the HOUSE alike.
///
/// `host` owns the wallet (reached through `wallet`) and whatever its per-message policy needs;
/// `classify` gets `host` back mutably for each message, so the policy may use the host's own
/// methods. An exact signed duplicate (its envelope hash already stored) is applied without
/// asking `classify`. Rejected messages are written once per deal and generation, after the
/// loop, as one `envelope.rejected` audit row each - also when a message was retried, so a
/// ledger fault on one message never costs the others their row. Returns the first retried
/// error. A ledger error of the pass itself (reading the inbox, the duplicate check, finishing a
/// row) returns at once and leaves the collected rows pending: the next pass rejects them again.
/// That moves no money and applies nothing.
pub fn drain_inbox<T, E: From<Error>>(
    host: &mut T,
    wallet: impl Fn(&mut T) -> &mut Wallet,
    now: Timestamp,
    mut classify: impl FnMut(&mut T, &InboxMessage) -> InboxOutcome<E>,
) -> Result<(), E> {
    fn ledger<R, E: From<Error>>(result: Result<R, LedgerError>) -> Result<R, E> {
        result.map_err(|e| Error::Ledger(e).into())
    }
    let mut failure = None;
    let mut groups: Vec<Vec<InboxMessage>> = Vec::new();
    for message in ledger(wallet(host).ledger.pending_inbox())? {
        let hash = H256::digest(message.raw.as_bytes());
        let outcome = if ledger(wallet(host).ledger.has_envelope_hash(message.deal_id, hash))? {
            InboxOutcome::Apply
        } else {
            classify(host, &message)
        };
        match outcome {
            InboxOutcome::Apply => {
                ledger(wallet(host).ledger.finish_inbox(&message, true, now))?;
            }
            InboxOutcome::Reject => match groups
                .iter_mut()
                .find(|g| g[0].deal_id == message.deal_id && g[0].generation == message.generation)
            {
                Some(group) => group.push(message),
                None => groups.push(vec![message]),
            },
            InboxOutcome::Retry(error) => {
                failure.get_or_insert(error);
            }
        }
    }
    for group in &groups {
        ledger(wallet(host).ledger.reject_inbox(group, now))?;
    }
    failure.map_or(Ok(()), Err)
}
