//! The approval window's checklist as the wallet composed it (design §10.3). Each line is one
//! predicate the money step itself runs; the owner's decision carries the hash of the exact list
//! it was taken on, so the audit log records what the owner was shown.
use crate::{H256, canonical_bytes};
use serde::{Deserialize, Serialize};

/// Stable identity of a checklist line. The order of this enum is the order of the list.
#[derive(ts_rs::TS, Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ApprovalCheckId {
    /// The amount asked (PayPal order / SETTLE, or the offer being accepted) = the signed terms.
    Amount,
    /// Who gets paid = the paired counterparty's declared payee (or the owner's own payee), and
    /// on the mandate's approved payees when that rule exists.
    Payee,
    /// The PayPal approval link's host is on the allowlist (only when a link exists).
    Host,
    /// The order's invoice id is the one bound to this deal and attempt.
    Invoice,
    /// The scam shield's verdict lets an owner decision through.
    Shield,
    /// The deal is inside the signed mandate (including the clause 6 ask-above threshold).
    Mandate,
}

#[derive(ts_rs::TS, Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ApprovalCheckStatus {
    Pass,
    Fail,
    /// The input only exists after a later step (named in the text); that step checks it
    /// before any money moves. Never shown or counted as a pass.
    Wait,
    NotApplicable,
}

/// One line of the checklist. `text` is plain words for the owner (no ids, no clause numbers);
/// `detail` is the Layer-2 fact behind it and may name clauses, hosts and ids.
#[derive(ts_rs::TS, Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ApprovalCheck {
    pub id: ApprovalCheckId,
    pub status: ApprovalCheckStatus,
    pub text: String,
    pub detail: String,
}

/// Domain tag for [`checks_hash`], so the digest of a checklist never equals any other commitment.
pub const APPROVAL_CHECKS_DOMAIN: &[u8] = b"table.approval-checks.v1\0";

/// Digest of the canonical (JCS) checklist under [`APPROVAL_CHECKS_DOMAIN`]. Every field of every
/// line, and the order of the lines, is committed.
pub fn checks_hash(checks: &[ApprovalCheck]) -> Result<H256, serde_json::Error> {
    let mut bytes = APPROVAL_CHECKS_DOMAIN.to_vec();
    bytes.extend(canonical_bytes(checks)?);
    Ok(H256::digest(&bytes))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::commitment;

    fn line(status: ApprovalCheckStatus, text: &str) -> ApprovalCheck {
        ApprovalCheck {
            id: ApprovalCheckId::Amount,
            status,
            text: text.into(),
            detail: "d".into(),
        }
    }

    #[test]
    fn the_checks_hash_is_domain_separated_and_commits_every_field_and_the_order() {
        let a = vec![line(ApprovalCheckStatus::Pass, "a")];
        let base = checks_hash(&a).unwrap();
        assert_ne!(base, commitment(&a).unwrap(), "domain separated");
        assert_ne!(
            base,
            checks_hash(&[line(ApprovalCheckStatus::Fail, "a")]).unwrap()
        );
        assert_ne!(
            base,
            checks_hash(&[line(ApprovalCheckStatus::Pass, "b")]).unwrap()
        );
        let mut other = line(ApprovalCheckStatus::Pass, "a");
        other.detail = "e".into();
        assert_ne!(base, checks_hash(&[other]).unwrap());
        let two = vec![
            line(ApprovalCheckStatus::Pass, "a"),
            line(ApprovalCheckStatus::Wait, "b"),
        ];
        let swapped = vec![two[1].clone(), two[0].clone()];
        assert_ne!(checks_hash(&two).unwrap(), checks_hash(&swapped).unwrap());
        assert_eq!(base, checks_hash(&a).unwrap(), "deterministic");
        assert_eq!(
            serde_json::to_string(&ApprovalCheckStatus::NotApplicable).unwrap(),
            "\"not_applicable\""
        );
    }
}
