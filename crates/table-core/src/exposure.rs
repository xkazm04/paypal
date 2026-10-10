//! Wallet-wide exposure and the owner-signed wallet limits above every mandate (T14, report §7
//! spend firewall at wallet level). Pure: the ledger supplies the deals and their agreement
//! moments, the caller supplies the time.
//!
//! The fold counts money going out only (buyer-side deals): what the wallet's agents pay. A
//! seller deal receives money and is never limited here (receiving money needs no click, H5).
//! The day rules are the per-mandate velocity's (STATUS "Daily budget (scan C-4)"): a deal's
//! place in its UTC day is fixed when it first agrees, in audit order; only deals that agreed
//! earlier that day count against it; open tables never do; a deal past agreement whose
//! agreement row cannot be read counts against every other deal of its creation day.
use crate::{
    Currency, DealId, DealState, DomainError, H256, Money, Refusal, Side, Timestamp,
    canonical_bytes,
};
use serde::{Deserialize, Serialize};

/// The refusal "clause" an envelope refusal carries: 0 is no mandate clause, it is the wallet.
pub const ENVELOPE_CLAUSE: u8 = 0;
/// Domain tag of the owner's signature over [`WalletEnvelope`], so it never verifies as a mandate
/// (signed over its bare canonical bytes) or any other commitment.
pub const WALLET_ENVELOPE_DOMAIN: &[u8] = b"table.wallet-envelope.v1\0";
const DAY: Timestamp = 86_400;

/// One deal as the fold needs it. `agreed` is the first AGREED transition's audit `(seq, at)`
/// when that row can be read.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ExposureDeal {
    pub id: DealId,
    pub side: Side,
    pub state: DealState,
    pub amount: Money,
    pub created_at: Timestamp,
    pub agreed: Option<(i64, Timestamp)>,
}

/// Money out in one currency. Never converted: a wallet with two currencies has two rows.
#[derive(ts_rs::TS, Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CurrencyExposure {
    pub currency: Currency,
    /// Today's deals that reached capture (part of `out_today`).
    pub paid_today: Money,
    /// Authorized at PayPal right now, any day: the money is held for the payee.
    pub held: Money,
    /// Agreed or cleared, not held at PayPal yet (agreed, order made, buyer approval pending).
    pub committed: Money,
    /// The day's budget used: every deal that agreed today and was not released.
    pub out_today: Money,
    pub deals_today: u16,
}
impl CurrencyExposure {
    fn zero(currency: Currency) -> Result<Self, DomainError> {
        let z = Money::new(0, currency)?;
        Ok(Self {
            currency,
            paid_today: z,
            held: z,
            committed: z,
            out_today: z,
            deals_today: 0,
        })
    }
    /// Held plus committed: everything tied up or about to be.
    pub fn at_stake(&self) -> Result<Money, DomainError> {
        Ok(self.held.checked_add(self.committed)?)
    }
}

const fn released(state: DealState) -> bool {
    matches!(
        state,
        DealState::Refused
            | DealState::Withdrawn
            | DealState::Expired
            | DealState::Voided
            | DealState::AutoVoided
    )
}
/// The same set the ledger's usage_for counts when the agreement row is unreadable.
const fn agreed_or_later(state: DealState) -> bool {
    matches!(
        state,
        DealState::Agreed
            | DealState::Settling
            | DealState::AwaitingApproval
            | DealState::Approved
            | DealState::Authorized
            | DealState::Captured
            | DealState::Receipted
            | DealState::Reconciled
            | DealState::Refunded
            | DealState::Disputed
            | DealState::Unconfirmed
    )
}
const fn committed_state(state: DealState) -> bool {
    matches!(
        state,
        DealState::Agreed | DealState::Settling | DealState::AwaitingApproval | DealState::Approved
    )
}
/// UNCONFIRMED counts as spent: the money may have left even though PayPal's statement never
/// showed it, so a spending limit never frees it.
const fn paid_state(state: DealState) -> bool {
    matches!(
        state,
        DealState::Captured
            | DealState::Receipted
            | DealState::Reconciled
            | DealState::Refunded
            | DealState::Disputed
            | DealState::Unconfirmed
    )
}

/// The UTC day number of a moment.
pub const fn utc_day(at: Timestamp) -> Timestamp {
    at.div_euclid(DAY)
}

/// Whether `other` counts in the day window `day`, seen from a deal agreed at audit `own_seq`
/// (`None`: the wallet itself, or a deal that has not agreed yet, sees everyone agreed so far).
fn counts_today(other: &ExposureDeal, day: Timestamp, own_seq: Option<i64>) -> bool {
    match other.agreed {
        Some((seq, at)) => utc_day(at) == day && own_seq.is_none_or(|own| seq < own),
        None => agreed_or_later(other.state) && utc_day(other.created_at) == day,
    }
}

fn add(sum: &mut Money, amount: Money) -> Result<(), DomainError> {
    *sum = sum.checked_add(amount)?;
    Ok(())
}

fn fold_into(
    row: &mut CurrencyExposure,
    deal: &ExposureDeal,
    day: Timestamp,
    own_seq: Option<i64>,
) -> Result<(), DomainError> {
    if deal.side != Side::Buyer || released(deal.state) || deal.amount.currency() != row.currency {
        return Ok(());
    }
    if deal.state == DealState::Authorized {
        add(&mut row.held, deal.amount)?;
    } else if committed_state(deal.state) {
        add(&mut row.committed, deal.amount)?;
    }
    if counts_today(deal, day, own_seq) {
        add(&mut row.out_today, deal.amount)?;
        row.deals_today = row
            .deals_today
            .checked_add(1)
            .ok_or(DomainError::InvalidTerms)?;
        if paid_state(deal.state) {
            add(&mut row.paid_today, deal.amount)?;
        }
    }
    Ok(())
}

/// The wallet now, one row per currency that has any money out (sorted by currency code):
/// today's budget is every buyer deal that agreed on `now`'s UTC day. Order-independent.
pub fn fold_exposure(
    deals: &[ExposureDeal],
    now: Timestamp,
) -> Result<Vec<CurrencyExposure>, DomainError> {
    let mut currencies: Vec<Currency> = deals
        .iter()
        .filter(|d| d.side == Side::Buyer && !released(d.state))
        .map(|d| d.amount.currency())
        .collect();
    currencies.sort_by_key(|c| c.to_string());
    currencies.dedup();
    let day = utc_day(now);
    let mut rows = Vec::with_capacity(currencies.len());
    for currency in currencies {
        let mut row = CurrencyExposure::zero(currency)?;
        for deal in deals {
            fold_into(&mut row, deal, day, None)?;
        }
        if row != CurrencyExposure::zero(currency)? {
            rows.push(row);
        }
    }
    Ok(rows)
}

/// The window one deal is judged in, in its own currency: every other deal's held and committed
/// money now, and the day's budget as the velocity clause sees it (its own agreement day, the
/// deals that agreed before it; a deal not agreed yet is placed after everyone agreed so far).
/// The subject itself is never counted; the check adds its amount.
pub fn exposure_for_deal(
    deals: &[ExposureDeal],
    subject: DealId,
    currency: Currency,
    now: Timestamp,
) -> Result<CurrencyExposure, DomainError> {
    let own = deals
        .iter()
        .find(|d| d.id == subject)
        .and_then(|d| d.agreed);
    let day = utc_day(own.map_or(now, |(_, at)| at));
    let mut row = CurrencyExposure::zero(currency)?;
    for deal in deals.iter().filter(|d| d.id != subject) {
        fold_into(&mut row, deal, day, own.map(|(seq, _)| seq))?;
    }
    Ok(row)
}

/// The owner's wallet-wide limits, signed with the owner key over
/// [`WalletEnvelope::signing_bytes`]. Versions are append-only; the newest is in force.
#[derive(ts_rs::TS, Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct WalletEnvelope {
    pub version: u32,
    pub currency: Currency,
    /// Most the agents may pay out in one UTC day (the day's budget, as clause 5 counts it).
    pub max_out_day: Money,
    /// Most held at PayPal or agreed and about to be, at once.
    pub max_held: Money,
    /// Most deals that may agree in one UTC day.
    pub max_deals_day: u16,
    pub expires: Timestamp,
}
#[derive(ts_rs::TS, Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct SignedEnvelope {
    pub payload: WalletEnvelope,
    pub owner_sig: Vec<u8>,
}

/// Which wallet limit refused, in the closed form the client words.
#[derive(ts_rs::TS, Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum EnvelopeLimit {
    OutDay,
    Held,
    DealsDay,
    /// The deal is in a currency the limits do not cover.
    Currency,
    /// The limits ran out; they refuse until new ones are signed.
    Expired,
    /// The stored limits did not verify against the owner key: fail closed.
    Unverified,
}
impl EnvelopeLimit {
    pub const fn name(self) -> &'static str {
        match self {
            Self::OutDay => "max_out_day",
            Self::Held => "max_held",
            Self::DealsDay => "max_deals_day",
            Self::Currency => "currency",
            Self::Expired => "expires",
            Self::Unverified => "signature",
        }
    }
}
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum EnvelopeDecision {
    Allow,
    Refuse {
        limit: EnvelopeLimit,
        reason: String,
    },
}
impl EnvelopeDecision {
    pub fn refuse(limit: EnvelopeLimit, reason: impl Into<String>) -> Self {
        Self::Refuse {
            limit,
            reason: reason.into(),
        }
    }
    /// As a mandate refusal under [`ENVELOPE_CLAUSE`], so every caller's refusal path (REFUSED,
    /// `intent.refused`, the deal's refusal) carries it; the reason names the limit.
    pub fn into_result(self) -> Result<(), Refusal> {
        match self {
            Self::Allow => Ok(()),
            Self::Refuse { limit, reason } => Err(Refusal {
                clause: ENVELOPE_CLAUSE,
                reason: format!("{}: {reason}", limit.name()),
            }),
        }
    }
}
/// What the envelope judges: who pays and how much.
#[derive(Debug, Clone, Copy)]
pub struct EnvelopeIntent {
    pub side: Side,
    pub amount: Money,
}

impl WalletEnvelope {
    /// A limit set check() could never use is refused at signing.
    pub fn validate(&self) -> Result<(), Refusal> {
        let bad = |reason: &str| {
            Err(Refusal {
                clause: ENVELOPE_CLAUSE,
                reason: reason.into(),
            })
        };
        if self.version == 0 {
            return bad("invalid wallet limits version");
        }
        if self.expires <= 0 || self.expires > crate::money::MAX_SAFE_INTEGER {
            return bad("invalid wallet limits expiry");
        }
        if self.max_out_day.currency() != self.currency || self.max_held.currency() != self.currency
        {
            return bad("currency differs across wallet limits");
        }
        if self.max_out_day.minor() == 0 || self.max_held.minor() == 0 || self.max_deals_day == 0 {
            return bad("a wallet limit of zero allows nothing");
        }
        Ok(())
    }
    /// The exact bytes the owner signs: the domain tag, then the canonical (JCS) payload.
    pub fn signing_bytes(&self) -> Result<Vec<u8>, serde_json::Error> {
        let mut bytes = WALLET_ENVELOPE_DOMAIN.to_vec();
        bytes.extend(canonical_bytes(self)?);
        Ok(bytes)
    }
    pub fn hash(&self) -> Result<H256, DomainError> {
        self.validate().map_err(|_| DomainError::InvalidTerms)?;
        Ok(H256::digest(&self.signing_bytes()?))
    }
    /// Only tightens: runs after the mandate allowed the intent, before any write, reservation
    /// or network call. `exposure` is [`exposure_for_deal`] for the deal (its own amount
    /// excluded). Money coming in is never limited.
    pub fn check(
        &self,
        exposure: &CurrencyExposure,
        intent: EnvelopeIntent,
        now: Timestamp,
    ) -> EnvelopeDecision {
        use EnvelopeDecision as D;
        use EnvelopeLimit as L;
        if intent.side != Side::Buyer {
            return D::Allow;
        }
        if self.validate().is_err() {
            return D::refuse(L::Unverified, "the wallet limits are not well formed");
        }
        if now >= self.expires {
            return D::refuse(L::Expired, "the wallet limits expired; sign new ones");
        }
        let amount = intent.amount;
        if amount.currency() != self.currency || exposure.currency != self.currency {
            return D::refuse(
                L::Currency,
                format!(
                    "wallet limits cover {} only; this deal is in {}",
                    self.currency,
                    amount.currency()
                ),
            );
        }
        if exposure.deals_today >= self.max_deals_day {
            return D::refuse(
                L::DealsDay,
                format!(
                    "{} deals agreed today of {} allowed",
                    exposure.deals_today, self.max_deals_day
                ),
            );
        }
        let over = |used: Money, cap: Money| match used.checked_add(amount) {
            Ok(total) => total.minor() > cap.minor(),
            Err(_) => true,
        };
        if over(exposure.out_today, self.max_out_day) {
            return D::refuse(
                L::OutDay,
                format!(
                    "paid out today {} + {} above {}",
                    exposure.out_today.decimal(),
                    amount.decimal(),
                    self.max_out_day
                ),
            );
        }
        let stake = match exposure.at_stake() {
            Ok(stake) => stake,
            Err(_) => return D::refuse(L::Held, "held total could not be added up"),
        };
        if over(stake, self.max_held) {
            return D::refuse(
                L::Held,
                format!(
                    "held {} + waiting {} + {} above {}",
                    exposure.held.decimal(),
                    exposure.committed.decimal(),
                    amount.decimal(),
                    self.max_held
                ),
            );
        }
        D::Allow
    }
}

/// Whether limits are in force, as the owner's surfaces show it.
#[derive(ts_rs::TS, Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum EnvelopeStatus {
    /// None signed: only each mandate's own limits apply (today's behaviour).
    None,
    Active,
    /// Signed limits ran out: money out is refused until new ones are signed.
    Expired,
    /// The stored limits did not verify: money out is refused (fail closed).
    Unverified,
}
/// Limits and live exposure numbers only: no deal, counterparty or key.
#[derive(ts_rs::TS, Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ExposureView {
    pub status: EnvelopeStatus,
    /// The limits in force (or expired); null when none are signed or they did not verify.
    #[ts(optional = nullable)]
    pub limits: Option<WalletEnvelope>,
    /// When the limits in force were signed (Unix seconds); null when none.
    #[ts(optional = nullable)]
    pub signed_at: Option<Timestamp>,
    /// Money out per currency; empty when nothing is out.
    pub currencies: Vec<CurrencyExposure>,
    /// Start of today's UTC day, the window `out_today` and `deals_today` count.
    pub day_start: Timestamp,
}

#[cfg(test)]
#[path = "exposure_tests.rs"]
mod tests;
