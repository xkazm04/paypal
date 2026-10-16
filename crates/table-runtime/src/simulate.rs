//! Mandate what-if before signing (T12): a draft replayed over the deals already recorded.
//!
//! Read-only. It never signs, never writes a row and never calls PayPal. Every verdict comes from
//! `MandatePayload::check` itself, for the rules in force and for the draft, over intents rebuilt
//! from the ledger the same way the pipeline builds them (table-app `mandate_check_rounds`). A
//! fact the intent needs that is not on record makes the line "not simulated"; nothing is guessed.
//! The wallet limits in force sit above every mandate (table-app `envelope_check`), so a verdict
//! the mandate allows or asks is then judged by them, as the pipeline judges it.
//!
//! The wallet-limits what-if (`envelope_simulate`) replays draft limits the same way: each
//! purchase agreed in the window, judged by `WalletEnvelope::check` at its own place in its day
//! (`exposure_for_deal`), for the limits in force and for the draft.
use crate::{Runtime, app, invalid};
use std::collections::BTreeMap;
use table_client::*;
use table_core::*;

/// The default window: the last seven days.
pub(crate) const SIMULATE_DEFAULT_WINDOW: i64 = 7 * 86_400;
/// The longest window one call replays.
pub(crate) const SIMULATE_MAX_WINDOW: i64 = 31 * 86_400;

/// The replay window `[from, to]`: by default the last seven days; backwards or longer than a
/// month is malformed input.
fn window(
    from: Option<Timestamp>,
    to: Option<Timestamp>,
    now: Timestamp,
) -> Result<(Timestamp, Timestamp), CommandError> {
    let to = to.unwrap_or(now);
    let from = from.unwrap_or_else(|| to.saturating_sub(SIMULATE_DEFAULT_WINDOW));
    if from > to || to.saturating_sub(from) > SIMULATE_MAX_WINDOW {
        return Err(invalid());
    }
    Ok((from, to))
}

/// A wallet-limits answer as a what-if verdict: the refusal under its clause (0, the wallet).
fn limits_verdict(decision: EnvelopeDecision) -> SimulatedVerdict {
    match decision.into_result() {
        Ok(()) => SimulatedVerdict::Allow,
        Err(refusal) => SimulatedVerdict::Refuse {
            clause: refusal.clause,
            reason: refusal.reason,
        },
    }
}

/// What the pipeline reads besides the deal row to check an intent.
struct Facts {
    category: Category,
    paired: bool,
    house: bool,
    /// The counterparty's declared payee: a buyer's settlement payee.
    declared_payee: PayeeRef,
    rounds_used: u8,
    usage: Usage,
    /// A rescue's one fix, which the draft's fixes clause must still allow.
    offer: Option<RescueOffer>,
}

/// The role the wallet claims for a deal (as table-app `mandate_check_rounds`).
fn role_of(deal: &Deal) -> Role {
    match (deal.side, deal.kind) {
        (Side::Buyer, _) => Role::Buy,
        (_, DealKind::ShopOrder) => Role::Shop,
        (_, DealKind::Rescue) => Role::Rescue,
        _ => Role::Sell,
    }
}

/// One payload's verdict on one rebuilt intent, at the moment that payload is (or comes) in force.
/// Validity dates are not replayed against the past: this is a what-if on the terms.
fn verdict(
    payload: &MandatePayload,
    deal: &Deal,
    facts: &Facts,
    now: Timestamp,
) -> SimulatedVerdict {
    // A seller is paid to the one payee its mandate names (table-app `settlement_payee`).
    let payee = if deal.side == Side::Buyer {
        facts.declared_payee.clone()
    } else {
        let sole = payload.clauses.iter().find_map(|c| match c {
            Clause::Payees { payees } => match payees.as_slice() {
                [payee] => Some(payee.clone()),
                _ => None,
            },
            _ => None,
        });
        match sole {
            Some(payee) => payee,
            None => return SimulatedVerdict::NotSimulated,
        }
    };
    let intent = Intent {
        kind: deal.kind,
        side: deal.side,
        role: role_of(deal),
        category: facts.category,
        terms: &deal.terms,
        counterparty: &deal.counterparty,
        paired: facts.paired,
        house: facts.house,
        payee: &payee,
        rounds_used: facts.rounds_used,
    };
    let checked = payload
        .check(&intent, facts.usage, now.max(payload.not_before))
        .and_then(|decision| {
            // A rescue also runs its fix against the fixes clause, as the pipeline does.
            if deal.kind == DealKind::Rescue {
                let offer = facts
                    .offer
                    .as_ref()
                    .ok_or_else(|| Refusal::new(8, "fix not on record"))?;
                check_offer(payload, offer, &deal.terms)?;
            }
            Ok(decision)
        });
    match checked {
        Ok(MandateDecision::Allow) => SimulatedVerdict::Allow,
        Ok(MandateDecision::Ask { clause }) => SimulatedVerdict::Ask { clause },
        Err(refusal) => SimulatedVerdict::Refuse {
            clause: refusal.clause,
            reason: refusal.reason,
        },
    }
}

impl Runtime {
    /// The intent facts of a recorded deal, or None when one is not on record.
    fn intent_facts(&self, deal: &Deal) -> Option<Facts> {
        let ledger = &self.pipeline.wallet.ledger;
        if deal.created_at == 0 {
            return None;
        }
        let category = ledger.deal_category(deal.id).ok()?;
        let (paired, house, declared_payee) =
            ledger.counterparty_policy(&deal.counterparty).ok()?;
        // An acceptance or settlement re-checks the latest round: N rounds, N-1 used before it.
        let rounds_used = ledger
            .negotiation_rounds(deal.id)
            .ok()?
            .saturating_sub(1)
            .min(u32::from(u8::MAX)) as u8;
        // The deal's place in its day, as the pipeline counts it (STATUS "Daily budget").
        let usage = ledger.usage_for(deal, deal.created_at).ok()?;
        let offer = if deal.kind == DealKind::Rescue {
            Some(ledger.rescue_case(deal.id).ok()??.offer)
        } else {
            None
        };
        Some(Facts {
            offer,
            category,
            paired,
            house,
            declared_payee,
            rounds_used,
            usage,
        })
    }

    /// A mandate's verdict under the wallet limits in force: what the mandate allows or asks is
    /// then checked by them, exactly as table-app `mandate_check_rounds` runs `envelope_check`
    /// (none signed: no extra limit; expired or unverified: money out refused, fail closed).
    fn under_limits(
        &self,
        verdict: SimulatedVerdict,
        deal: &Deal,
        now: Timestamp,
    ) -> Result<SimulatedVerdict, CommandError> {
        if !matches!(
            verdict,
            SimulatedVerdict::Allow | SimulatedVerdict::Ask { .. }
        ) {
            return Ok(verdict);
        }
        match self.pipeline.wallet.envelope_check(deal, now) {
            Ok(()) => Ok(verdict),
            Err(table_app::Error::Refused(refusal)) => Ok(SimulatedVerdict::Refuse {
                clause: refusal.clause,
                reason: refusal.reason,
            }),
            Err(error) => Err(error.into()),
        }
    }

    pub(crate) fn mandate_simulate(
        &self,
        args: MandateSimulateArgs,
    ) -> Result<MandateSimulation, CommandError> {
        let now = self.clock.now();
        let (from, to) = window(args.from, args.to, now)?;
        let scope = args.draft.id;
        let draft = self.draft_payload(args.draft)?;
        // An unsignable draft is answered like mandate_sign answers it: REFUSED with its reason.
        draft.validate().map_err(table_app::Error::from)?;
        let owner = self.owner()?.verifying_key();
        let ledger = &self.pipeline.wallet.ledger;
        // The rules in force: each mandate id's active version. A version today's rules refuse
        // is kept, so check() answers with that refusal, as the pipeline would.
        let in_force: BTreeMap<MandateId, MandatePayload> = app(ledger.list_mandates(&owner))?
            .into_iter()
            .map(|listed| (listed.mandate.payload.id, listed.mandate.payload))
            .collect();
        let mut agent_keys: BTreeMap<(MandateId, u32), Option<[u8; 32]>> = BTreeMap::new();
        let mut lines = Vec::new();
        let mut not_simulated = 0_u32;
        for deal in app(ledger.list_deals())? {
            // An edited mandate replays its own deals; a new one, the deals of the agent it is for.
            let in_scope = match scope {
                Some(id) => deal.mandate_id == id,
                None => {
                    *agent_keys
                        .entry((deal.mandate_id, deal.mandate_version))
                        .or_insert_with(|| {
                            ledger
                                .mandate_evidence(deal.mandate_id, deal.mandate_version, &owner)
                                .ok()
                                .map(|m| m.payload.agent_key)
                        })
                        == Some(draft.agent_key)
                }
            };
            // A deal with no recorded time cannot be placed in the window: it is shown, unsimulated.
            if !in_scope || (deal.created_at != 0 && !(from..=to).contains(&deal.created_at)) {
                continue;
            }
            let (before, after) = match self.intent_facts(&deal) {
                Some(facts) => (
                    match in_force.get(&deal.mandate_id) {
                        Some(payload) => {
                            self.under_limits(verdict(payload, &deal, &facts, now), &deal, now)?
                        }
                        // Revoked or never active: today the intent is refused as inactive.
                        None => SimulatedVerdict::Refuse {
                            clause: 1,
                            reason: "mandate is not active".into(),
                        },
                    },
                    self.under_limits(verdict(&draft, &deal, &facts, now), &deal, now)?,
                ),
                None => {
                    not_simulated = not_simulated.saturating_add(1);
                    (
                        SimulatedVerdict::NotSimulated,
                        SimulatedVerdict::NotSimulated,
                    )
                }
            };
            lines.push(SimulatedLine {
                deal_id: deal.id,
                label: format!("D-{:04}", app(ledger.display_number(deal.id))?),
                // As deal_display titles a deal.
                title: deal.terms.item_ref.to_string(),
                item_ref: deal.terms.item_ref.clone(),
                kind: deal.kind,
                side: deal.side,
                at: deal.created_at,
                amount: deal.terms.amount().ok(),
                unit_price: deal.terms.unit_price,
                before,
                after,
            });
        }
        lines.sort_by(|a, b| (a.at, &a.label).cmp(&(b.at, &b.label)));
        Ok(MandateSimulation {
            from,
            to,
            lines,
            not_simulated,
        })
    }

    /// Wallet-limits what-if before signing: the draft limits, refused exactly as
    /// `envelope_sign` refuses them, replayed over every purchase agreed in the window and still
    /// counted by the limits (money in is never limited, so a seller deal has no line). Each is
    /// judged at its own place in its day, as `envelope_check` judges it: `before` is the live
    /// check under the limits in force, `after` the draft's. Read-only: nothing is signed or
    /// written and PayPal is never called.
    pub(crate) fn envelope_simulate(
        &self,
        args: EnvelopeSimulateArgs,
    ) -> Result<MandateSimulation, CommandError> {
        let now = self.clock.now();
        let (from, to) = window(args.from, args.to, now)?;
        let draft = self.draft_envelope(&args.draft, now)?;
        let ledger = &self.pipeline.wallet.ledger;
        let exposure = app(ledger.exposure_deals())?;
        let mut lines = Vec::new();
        for deal in app(ledger.list_deals())? {
            // The limits count buyer deals past agreement that were not released; nothing else.
            let Some(counted) = exposure.iter().find(|d| d.id == deal.id) else {
                continue;
            };
            if !deal.state.is_agreed_or_later() {
                continue;
            }
            let (seq, at) = counted.agreed.unwrap_or((i64::MAX, deal.created_at));
            if !(from..=to).contains(&at) {
                continue;
            }
            let amount = counted.amount;
            let place = exposure_for_deal(&exposure, deal.id, amount.currency(), now)
                .map_err(table_app::Error::from)?;
            let before = self.under_limits(SimulatedVerdict::Allow, &deal, now)?;
            let after = limits_verdict(draft.check(
                &place,
                EnvelopeIntent {
                    side: deal.side,
                    amount,
                },
                now,
            ));
            let line = SimulatedLine {
                deal_id: deal.id,
                label: format!("D-{:04}", app(ledger.display_number(deal.id))?),
                title: deal.terms.item_ref.to_string(),
                item_ref: deal.terms.item_ref.clone(),
                kind: deal.kind,
                side: deal.side,
                at,
                amount: Some(amount),
                unit_price: deal.terms.unit_price,
                before,
                after,
            };
            lines.push(((at, seq), line));
        }
        // In agreement order, as the day's budget counts them.
        lines.sort_by(|(a, x), (b, y)| (a, &x.label).cmp(&(b, &y.label)));
        Ok(MandateSimulation {
            from,
            to,
            lines: lines.into_iter().map(|(_, line)| line).collect(),
            not_simulated: 0,
        })
    }
}
