//! The glass-box HOUSE (T9): a public, typed projection of every house deal and a signed head of
//! the house's audit chain.
//!
//! Everything here is public data: hashes, amounts, states, the house's own release pin and its
//! signed mandate. A guest appears only as a key-id prefix. There is no free text, no guest payee,
//! no PayPal identifier and no secret, by construction of the types: a field that could carry
//! counterparty words does not exist.
//!
//! The head is signed by the release-pinned agent key under its own domain tag, so it cannot be
//! confused with any other signature that key makes (envelopes, closed mandates, pairing replies).
use crate::{HouseRelease, PairingError};
use ed25519_dalek::{Signature, VerifyingKey};
use serde::{Deserialize, Serialize};
use table_core::{
    DealId, DealState, DecidedBy, H256, ItemRef, Money, OpenMandate, Timestamp, canonical_bytes,
};

/// Domain tag of a signed head.
pub const HOUSE_HEAD_DOMAIN: &str = "table.house.head.v1";
/// Domain tag of a signed prefix (the chain hash at an earlier row count).
pub const HOUSE_PREFIX_DOMAIN: &str = "table.house.prefix.v1";
/// Format name of [`HouseLedgerView`].
pub const HOUSE_LEDGER_FORMAT: &str = "table.house.ledger.v1";
/// Characters of a guest key id the projection shows.
pub const GUEST_PREFIX_CHARS: usize = 12;

/// The house's audit chain at one moment. `epoch` is the hash of the chain's first row: a ledger
/// started on a new disk has a different first row, so a reset is a visible new epoch, never a
/// silent rewind.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct HouseHead {
    pub epoch: H256,
    /// When the chain's first row was written.
    pub epoch_started: Timestamp,
    /// Rows in the chain; the chain's sequence numbers run 1..=row_count without gaps.
    pub row_count: u64,
    /// Hash of the last row (the chain head).
    pub audit_head: H256,
    /// When the house read and signed this head.
    pub at: Timestamp,
}
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct SignedHouseHead {
    pub head: HouseHead,
    pub signature: Vec<u8>,
}
/// The chain hash at an earlier row count, read from the chain whose head is `within`. A kept head
/// `(epoch, row_count, audit_head)` is a prefix of the current chain exactly when the house signs
/// the same hash at that row count.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct HousePrefix {
    pub epoch: H256,
    pub row_count: u64,
    pub audit_head: H256,
    /// The head (row count) the prefix was read from.
    pub within: u64,
    pub at: Timestamp,
}
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct SignedHousePrefix {
    pub prefix: HousePrefix,
    pub signature: Vec<u8>,
}

fn signed(key: &[u8; 32], message: &[u8], signature: &[u8]) -> Result<(), PairingError> {
    VerifyingKey::from_bytes(key)
        .map_err(|_| PairingError)?
        .verify_strict(
            message,
            &Signature::from_slice(signature).map_err(|_| PairingError)?,
        )
        .map_err(|_| PairingError)
}
impl HouseHead {
    /// Domain-separated canonical bytes the agent key signs.
    pub fn signing_bytes(&self) -> Result<Vec<u8>, PairingError> {
        canonical_bytes(&(HOUSE_HEAD_DOMAIN, self)).map_err(|_| PairingError)
    }
}
impl HousePrefix {
    pub fn signing_bytes(&self) -> Result<Vec<u8>, PairingError> {
        canonical_bytes(&(HOUSE_PREFIX_DOMAIN, self)).map_err(|_| PairingError)
    }
}
impl SignedHouseHead {
    /// Verifies against an agent key (the pin's, or a proof bundle's house counterparty key).
    pub fn verify_key(&self, agent_key: &[u8; 32]) -> Result<(), PairingError> {
        if self.head.row_count == 0 || self.head.at < self.head.epoch_started {
            return Err(PairingError);
        }
        signed(agent_key, &self.head.signing_bytes()?, &self.signature)
    }
    /// Verifies against the release pin: the pin itself first, then its agent key.
    pub fn verify(&self, release: &HouseRelease) -> Result<(), PairingError> {
        release.verify()?;
        self.verify_key(&release.agent_key)
    }
}
impl SignedHousePrefix {
    pub fn verify(&self, release: &HouseRelease) -> Result<(), PairingError> {
        release.verify()?;
        let p = &self.prefix;
        if p.row_count == 0 || p.row_count > p.within {
            return Err(PairingError);
        }
        signed(&release.agent_key, &p.signing_bytes()?, &self.signature)
    }
}

/// How a later head relates to a head kept earlier.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum HeadVerdict {
    /// The same head.
    Same,
    /// Longer, and the house signed the kept hash at the kept row count: it extends the kept head.
    Extends,
    /// Longer, but no prefix was checked.
    Longer,
    /// A new epoch: the house started a new record (for example on a new disk).
    NewEpoch,
    /// Same epoch, fewer rows: rows were removed from the end.
    Shorter,
    /// Same epoch, but the hash at the kept row count differs: history was rewritten.
    Rewritten,
}
impl HeadVerdict {
    /// True when the later head is evidence against the kept one.
    pub const fn warns(self) -> bool {
        matches!(self, Self::NewEpoch | Self::Shorter | Self::Rewritten)
    }
}
/// Pure comparison of a kept head with a later one and, optionally, the house's signed prefix at
/// the kept row count. Signatures are checked by the caller.
pub fn compare_heads(
    kept: &HouseHead,
    later: &HouseHead,
    prefix: Option<&HousePrefix>,
) -> HeadVerdict {
    if later.epoch != kept.epoch {
        return HeadVerdict::NewEpoch;
    }
    if later.row_count < kept.row_count {
        return HeadVerdict::Shorter;
    }
    if later.row_count == kept.row_count {
        return if later.audit_head == kept.audit_head {
            HeadVerdict::Same
        } else {
            HeadVerdict::Rewritten
        };
    }
    match prefix {
        Some(p)
            if p.epoch == kept.epoch
                && p.row_count == kept.row_count
                && p.within == later.row_count =>
        {
            if p.audit_head == kept.audit_head {
                HeadVerdict::Extends
            } else {
                HeadVerdict::Rewritten
            }
        }
        _ => HeadVerdict::Longer,
    }
}
/// A signed prefix that contradicts a kept head: same epoch and row count, a different hash.
pub fn prefix_contradicts(kept: &HouseHead, prefix: &HousePrefix) -> bool {
    prefix.epoch == kept.epoch
        && prefix.row_count == kept.row_count
        && prefix.audit_head != kept.audit_head
}

/// Who sent a priced message in a house deal.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum HouseParty {
    House,
    Guest,
}
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum HousePriceKind {
    Listing,
    Offer,
    Counter,
    Accept,
    Withdraw,
}
/// One signed message of the negotiation. Only its typed facts cross; a note, a pay link, a
/// receipt and an approval notice are not rounds and never appear.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct HouseRound {
    /// The guest proposals so far, this one included (the house policy's round count).
    pub round: u32,
    pub from: HouseParty,
    pub kind: HousePriceKind,
    /// The proposed price, or for an ACCEPT the price of the proposal it accepts.
    pub price: Option<Money>,
    /// An inbound offer the house declined as outside its signed band (kept as evidence only).
    pub declined: bool,
    /// Hash of the signed envelope; the guest's wallet holds the same hash in its transcript.
    pub hash: H256,
    pub at: Timestamp,
}
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum HouseMoneyKind {
    Create,
    /// The order read that saw the buyer's approval on PayPal.
    ApprovalSeen,
    Authorize,
    Capture,
    Void,
}
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum HouseOutcome {
    Ok,
    Failed,
    Unknown,
}
/// One PayPal state transition, in audit order (`seq` is the audit row that recorded it).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct HouseMoneyStep {
    pub seq: u64,
    pub at: Timestamp,
    pub step: HouseMoneyKind,
    pub outcome: HouseOutcome,
    /// The authority recorded with the step; none for the approval read.
    pub decided_by: Option<DecidedBy>,
}
/// A countersign: the closed mandate's hash over its signing bytes, its amount and authority.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct HouseClosed {
    pub attempt: u8,
    pub hash: H256,
    pub open_mandate_hash: H256,
    pub amount: Money,
    pub decided_by: DecidedBy,
}
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct HouseDealView {
    pub deal_id: DealId,
    pub created_at: Timestamp,
    pub updated_at: Timestamp,
    pub item_ref: ItemRef,
    /// The house's signed asking price this deal opened at.
    pub ask: Money,
    /// The deal's current unit price: the agreed price once the deal is agreed.
    pub price: Money,
    pub state: DealState,
    /// The first characters of the guest's key id: never a name, never a payee.
    pub guest: String,
    pub rounds: Vec<HouseRound>,
    /// Agent intents the signed mandate refused inside this deal.
    pub refused_intents: u32,
    pub closed: Vec<HouseClosed>,
    pub decided_by: Option<DecidedBy>,
    pub money: Vec<HouseMoneyStep>,
    /// Rows in the house's PayPal call log for this deal (reads included).
    pub paypal_calls: u32,
    pub transcript_head: H256,
}
/// Table requests the house turned away before writing anything (so before any PayPal call),
/// counted since the house last started. Each is a fixed reason code, never words.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct HouseRefusals {
    pub since: Timestamp,
    pub daily_limit: u32,
    pub full: u32,
    pub other: u32,
}
impl HouseRefusals {
    pub const fn total(&self) -> u32 {
        self.daily_limit
            .saturating_add(self.full)
            .saturating_add(self.other)
    }
}
/// One page of the house's public ledger, newest deal first.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct HouseLedgerView {
    pub format: String,
    /// The head of the chain the page was read from, signed by the house agent key.
    pub head: SignedHouseHead,
    /// The public release pin (keys, mandate commitment, the house's own sandbox payee).
    pub release: HouseRelease,
    /// The house's owner-signed mandate: its floor, ask and round limit.
    pub mandate: OpenMandate,
    pub deals: Vec<HouseDealView>,
    /// Deals the projection holds in all (this page may show fewer).
    pub total: u32,
    /// Older deals exist after this page.
    pub more: bool,
    pub refusals: HouseRefusals,
}
#[cfg(test)]
mod tests {
    use super::*;
    use ed25519_dalek::{Signer, SigningKey};

    fn head(rows: u64, hash: u8) -> HouseHead {
        HouseHead {
            epoch: H256([1; 32]),
            epoch_started: 10,
            row_count: rows,
            audit_head: H256([hash; 32]),
            at: 100,
        }
    }
    #[test]
    fn heads_compare_by_epoch_length_and_prefix() {
        let kept = head(10, 7);
        assert_eq!(compare_heads(&kept, &kept, None), HeadVerdict::Same);
        assert_eq!(
            compare_heads(&kept, &head(10, 8), None),
            HeadVerdict::Rewritten
        );
        assert_eq!(
            compare_heads(&kept, &head(9, 7), None),
            HeadVerdict::Shorter
        );
        let mut other = head(12, 7);
        other.epoch = H256([2; 32]);
        assert_eq!(compare_heads(&kept, &other, None), HeadVerdict::NewEpoch);
        let later = head(12, 9);
        assert_eq!(compare_heads(&kept, &later, None), HeadVerdict::Longer);
        let mut prefix = HousePrefix {
            epoch: kept.epoch,
            row_count: 10,
            audit_head: kept.audit_head,
            within: 12,
            at: 100,
        };
        assert_eq!(
            compare_heads(&kept, &later, Some(&prefix)),
            HeadVerdict::Extends
        );
        assert!(!prefix_contradicts(&kept, &prefix));
        prefix.audit_head = H256([3; 32]);
        assert_eq!(
            compare_heads(&kept, &later, Some(&prefix)),
            HeadVerdict::Rewritten
        );
        assert!(prefix_contradicts(&kept, &prefix));
        assert!(HeadVerdict::Shorter.warns() && !HeadVerdict::Longer.warns());
    }
    #[test]
    fn head_signature_is_domain_separated_and_tamper_evident() {
        let agent = SigningKey::from_bytes(&[5; 32]);
        let key = agent.verifying_key().to_bytes();
        let h = head(4, 1);
        let mut s = SignedHouseHead {
            head: h,
            signature: agent.sign(&h.signing_bytes().unwrap()).to_bytes().to_vec(),
        };
        s.verify_key(&key).unwrap();
        // The bare canonical head (no domain tag) is not what is signed.
        let bare = SignedHouseHead {
            head: h,
            signature: agent
                .sign(&canonical_bytes(&h).unwrap())
                .to_bytes()
                .to_vec(),
        };
        assert!(bare.verify_key(&key).is_err());
        s.head.row_count = 3;
        assert!(s.verify_key(&key).is_err());
        assert!(
            h.signing_bytes()
                .unwrap()
                .starts_with(b"[\"table.house.head.v1\",")
        );
    }
}
