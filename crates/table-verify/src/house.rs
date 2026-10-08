//! Offline checks over the glass-box HOUSE's public ledger (T9). Pure: no network, no ledger.
//!
//! The release pin is the trust anchor. By default it is the one the page itself carries, so the
//! report prints the house's key ids for comparison with the pin compiled into a wallet; a caller
//! that holds the pin passes it and a page carrying any other pin fails.
use crate::Check;
use table_core::{Clause, DealState, DecidedBy, H256, Money};
use table_proto::{
    GUEST_PREFIX_CHARS, HOUSE_LEDGER_FORMAT, HouseDealView, HouseLedgerView, HouseMoneyKind,
    HouseOutcome, HouseParty, HousePriceKind, HouseRelease, SignedHouseHead, key_id,
};

/// The key anchor of a house check run without a pin of the caller's own.
pub const HOUSE_KEY_ANCHOR: &str = "Compare the house keys above with the house pin your wallet shows: these checks use the pin inside the page.";

#[derive(Debug, Clone)]
pub struct HouseReport {
    pub deals: usize,
    pub agent_key_id: String,
    pub owner_key_id: String,
    pub checks: Vec<Check>,
}
impl HouseReport {
    pub fn verified(&self) -> bool {
        self.checks.iter().all(|c| c.ok)
    }
}
type Outcome = Result<String, String>;

fn key(bytes: &[u8; 32]) -> String {
    ed25519_dalek::VerifyingKey::from_bytes(bytes)
        .ok()
        .and_then(|k| key_id(&k).ok())
        .map_or_else(
            || "invalid".into(),
            |k| k.as_str().chars().take(16).collect(),
        )
}
fn short(hash: H256) -> String {
    hash.hex().chars().take(12).collect()
}
/// The signed floor of the house's single band.
fn floor(view: &HouseLedgerView) -> Result<Money, String> {
    view.mandate
        .payload
        .clauses
        .iter()
        .find_map(|c| match c {
            Clause::Band {
                floor: Some(floor),
                item_refs,
                ..
            } if item_refs.len() == 1 => Some(*floor),
            _ => None,
        })
        .ok_or_else(|| "the signed mandate names no single-item floor".to_owned())
}

fn pin(view: &HouseLedgerView, release: &HouseRelease) -> Outcome {
    if view.format != HOUSE_LEDGER_FORMAT {
        return Err(format!("unknown format {:?}", view.format));
    }
    if serde_json::to_value(&view.release).ok() != serde_json::to_value(release).ok() {
        return Err("the page carries a different release pin".into());
    }
    release
        .verify_mandate(&view.mandate)
        .map_err(|_| "the mandate is not the one the release pin commits to".to_owned())?;
    Ok(format!(
        "owner signed mandate {} (commitment {})",
        view.mandate.payload.id,
        short(release.mandate_commitment)
    ))
}

fn head(view: &HouseLedgerView, release: &HouseRelease) -> Outcome {
    view.head
        .verify(release)
        .map_err(|_| "the head is not signed by the pinned house agent key".to_owned())?;
    let h = &view.head.head;
    let last = view
        .deals
        .iter()
        .flat_map(|d| d.money.iter().map(|m| m.seq))
        .max()
        .unwrap_or(0);
    if last > h.row_count {
        return Err(format!(
            "a money step cites record #{last}, past the signed head's {} entries",
            h.row_count
        ));
    }
    Ok(format!(
        "{} entries, head {}, record started at {}",
        h.row_count,
        short(h.audit_head),
        h.epoch_started
    ))
}

/// Heads seen over time: each signed, and within one record the count never falls and one
/// count has one hash. A new record (epoch) is reported, not hidden.
pub fn heads_consistent(heads: &[SignedHouseHead], release: &HouseRelease) -> Outcome {
    let mut sorted: Vec<&SignedHouseHead> = heads.iter().collect();
    sorted.sort_by_key(|h| (h.head.at, h.head.row_count));
    let mut epochs = Vec::<H256>::new();
    for (i, h) in sorted.iter().enumerate() {
        h.verify(release)
            .map_err(|_| format!("head {} is not signed by the pinned house key", i + 1))?;
        if !epochs.contains(&h.head.epoch) {
            epochs.push(h.head.epoch);
        }
        for earlier in &sorted[..i] {
            let (a, b) = (&earlier.head, &h.head);
            if a.epoch != b.epoch {
                continue;
            }
            if b.row_count < a.row_count && b.at > a.at {
                return Err(format!(
                    "the record got shorter: {} entries at {}, then {} at {}",
                    a.row_count, a.at, b.row_count, b.at
                ));
            }
            if b.row_count == a.row_count && b.audit_head != a.audit_head {
                return Err(format!(
                    "two different records signed at {} entries",
                    a.row_count
                ));
            }
        }
    }
    Ok(match epochs.len() {
        0 => "no heads to compare".into(),
        1 => format!("{} head(s), never shorter, one record", sorted.len()),
        n => format!(
            "{} head(s), never shorter within a record; the house started {} new record(s)",
            sorted.len(),
            n - 1
        ),
    })
}

fn deal_floor(deal: &HouseDealView, floor: Money) -> Result<(), String> {
    let below = |m: &Money| m.currency() != floor.currency() || m.minor() < floor.minor();
    for r in &deal.rounds {
        if r.from == HouseParty::House
            && matches!(r.kind, HousePriceKind::Counter | HousePriceKind::Accept)
            && r.price.as_ref().is_some_and(below)
        {
            return Err(format!(
                "deal {}: the house {:?} at a price below its floor",
                deal.deal_id, r.kind
            ));
        }
    }
    let agreed = !deal.closed.is_empty()
        || !matches!(
            deal.state,
            DealState::Pairing
                | DealState::Listed
                | DealState::Negotiating
                | DealState::Withdrawn
                | DealState::Refused
        );
    if agreed && below(&deal.price) {
        return Err(format!(
            "deal {}: agreed {} below the floor {}",
            deal.deal_id,
            deal.price.decimal(),
            floor.decimal()
        ));
    }
    for c in &deal.closed {
        if below(&c.amount) {
            return Err(format!(
                "deal {}: countersigned {} below the floor",
                deal.deal_id,
                c.amount.decimal()
            ));
        }
    }
    Ok(())
}
fn floors(view: &HouseLedgerView) -> Outcome {
    let floor = floor(view)?;
    let mut agreed = 0;
    for deal in &view.deals {
        deal_floor(deal, floor)?;
        agreed += usize::from(!deal.closed.is_empty());
    }
    Ok(format!(
        "no house price and none of {agreed} agreed deal(s) below the signed floor {}",
        floor.decimal()
    ))
}

/// The first step of `kind` that PayPal confirmed, by audit order.
fn first_ok(deal: &HouseDealView, kind: HouseMoneyKind) -> Option<u64> {
    deal.money
        .iter()
        .filter(|m| m.step == kind && m.outcome == HouseOutcome::Ok)
        .map(|m| m.seq)
        .min()
}
fn order(deal: &HouseDealView) -> Result<bool, String> {
    let mut captured = false;
    for m in &deal.money {
        let before = |kind| first_ok(deal, kind).is_some_and(|seq| seq < m.seq);
        let lawful = match m.step {
            HouseMoneyKind::Create | HouseMoneyKind::Void => true,
            HouseMoneyKind::ApprovalSeen => before(HouseMoneyKind::Create),
            HouseMoneyKind::Authorize => {
                before(HouseMoneyKind::ApprovalSeen) && before(HouseMoneyKind::Create)
            }
            HouseMoneyKind::Capture => {
                captured |= m.outcome == HouseOutcome::Ok;
                before(HouseMoneyKind::Authorize) && before(HouseMoneyKind::ApprovalSeen)
            }
        };
        if !lawful {
            return Err(format!(
                "deal {}: {:?} at record #{} without the steps that must come first",
                deal.deal_id, m.step, m.seq
            ));
        }
    }
    Ok(captured)
}
fn captures(view: &HouseLedgerView) -> Outcome {
    let mut captured = 0;
    for deal in &view.deals {
        captured += usize::from(order(deal)?);
    }
    Ok(format!(
        "{captured} capture(s), each after an authorization after the buyer's approval on PayPal"
    ))
}

fn authority(view: &HouseLedgerView) -> Outcome {
    let mandate = view
        .mandate
        .payload
        .hash()
        .map_err(|_| "mandate payload does not validate".to_owned())?;
    for deal in &view.deals {
        for m in &deal.money {
            let ok = match (&m.decided_by, m.step) {
                (None, HouseMoneyKind::ApprovalSeen) => true,
                (Some(DecidedBy::SafeDefault { .. }), HouseMoneyKind::Void) => true,
                (Some(DecidedBy::HouseMandate { mandate_hash }), step) => {
                    *mandate_hash == mandate && step != HouseMoneyKind::ApprovalSeen
                }
                _ => false,
            };
            if !ok {
                return Err(format!(
                    "deal {}: {:?} at record #{} has no lawful house authority",
                    deal.deal_id, m.step, m.seq
                ));
            }
        }
        for c in &deal.closed {
            if c.open_mandate_hash != mandate
                || !matches!(&c.decided_by, DecidedBy::HouseMandate { mandate_hash } if *mandate_hash == mandate)
            {
                return Err(format!(
                    "deal {}: countersign {} is not under the house's signed mandate",
                    deal.deal_id, c.attempt
                ));
            }
        }
    }
    Ok("every money step is under the release-pinned mandate, or a void by safe default".into())
}

fn quiet(view: &HouseLedgerView) -> Outcome {
    let mut quiet = 0;
    for deal in &view.deals {
        if deal.closed.is_empty() {
            if deal.paypal_calls != 0 || !deal.money.is_empty() {
                return Err(format!(
                    "deal {}: PayPal was called without an agreed, countersigned deal",
                    deal.deal_id
                ));
            }
            quiet += 1;
        }
    }
    Ok(format!(
        "{quiet} deal(s) without agreement made 0 PayPal calls; {} request(s) turned away before any record",
        view.refusals.total()
    ))
}

fn private(view: &HouseLedgerView) -> Outcome {
    for deal in &view.deals {
        if deal.guest.chars().count() > GUEST_PREFIX_CHARS
            || !deal.guest.chars().all(|c| c.is_ascii_hexdigit())
        {
            return Err(format!(
                "deal {}: the guest is shown as more than a key-id prefix",
                deal.deal_id
            ));
        }
    }
    Ok(format!(
        "guests appear only as {GUEST_PREFIX_CHARS}-character key-id prefixes"
    ))
}

/// Checks one page of the house's ledger, plus any heads seen over time, against `release`
/// (the page's own pin when `None`).
pub fn verify_house(
    view: &HouseLedgerView,
    heads: &[SignedHouseHead],
    release: Option<&HouseRelease>,
) -> HouseReport {
    let release = release.unwrap_or(&view.release);
    let mut all = heads.to_vec();
    all.push(view.head.clone());
    let checks: Vec<(&'static str, &'static str, Outcome)> = vec![
        (
            "house_pin",
            "the release pin signs the house mandate",
            pin(view, release),
        ),
        (
            "house_head",
            "the head is signed by the house key",
            head(view, release),
        ),
        (
            "house_heads",
            "the record never got shorter",
            heads_consistent(&all, release),
        ),
        ("house_floor", "never below the signed floor", floors(view)),
        (
            "house_capture",
            "capture only after authorize after the buyer's approval",
            captures(view),
        ),
        (
            "house_authority",
            "every money step under the house mandate",
            authority(view),
        ),
        (
            "house_quiet",
            "no PayPal call without an agreed deal",
            quiet(view),
        ),
        (
            "house_private",
            "guests only as key-id prefixes",
            private(view),
        ),
    ];
    HouseReport {
        deals: view.deals.len(),
        agent_key_id: key(&release.agent_key),
        owner_key_id: key(&release.owner_key),
        checks: checks
            .into_iter()
            .map(|(id, name, outcome)| {
                let (ok, detail) = match outcome {
                    Ok(d) => (true, d),
                    Err(d) => (false, d),
                };
                Check {
                    id,
                    name,
                    ok,
                    detail,
                }
            })
            .collect(),
    }
}
