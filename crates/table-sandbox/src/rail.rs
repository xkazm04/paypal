//! The haggle rail the live page draws: one price lane, the house seller's marker and the outside
//! agent's marker closing on each other, a wall at the signed "never offer over" line and a gold
//! gate at the "needs you in person" line. Every position here is read off the journal (the
//! agent's calls and the wallet's answers) and the table the agent last read through it; the page
//! only draws what this returns and does no arithmetic of its own. Positions are whole basis
//! points of the lane's width (0 = its left end, 10 000 = its right end), so no float is involved.
use crate::journal::{Entry, Outcome};
use serde::Serialize;
use serde_json::Value;

/// The lane's width in position units.
pub const WIDTH: i64 = 10_000;
/// The price step between the lane's tick marks, in cents.
const TICK: i64 = 5_000;
/// The room left of the gate and right of the wall, in cents.
const ROOM_LOW: i64 = 5_000;
const ROOM_HIGH: i64 = 2_000;

/// What the rail is drawn from.
#[derive(Debug, Clone, Copy)]
pub struct Input<'a> {
    /// The table the page shows; journal entries for other tables are ignored.
    pub table: u32,
    pub entries: &'a [Entry],
    /// The table as the agent last read it (`table_view`'s answer), when it is this table's.
    pub view: Option<&'a Value>,
    /// The signed rule: never offer over `ceiling`; agreeing over `in_person` needs the owner.
    pub ceiling: i64,
    pub in_person: i64,
    /// The house seller's listing this table was joined on.
    pub listing: i64,
}

/// A price and where it sits on the lane.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
pub struct Mark {
    pub cents: i64,
    pub x: i64,
}

/// Where a refused call landed.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum At {
    /// Rule 4's line: an offer over the signed ceiling.
    Wall,
    /// Rule 6's line: agreeing over it needs the owner in person.
    Gate,
    /// Another rule, at the price the call named.
    Price,
    /// The call named no price (a tool that does not exist, a malformed call, a budget): the
    /// door turned it away before any price was weighed.
    Door,
}

/// One refused call on this table.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct Hit {
    /// The journal entry's sequence number.
    pub seq: u64,
    pub at: At,
    /// The price the call named (an offer's price, or the price an accept would have agreed).
    pub cents: Option<i64>,
    /// Where to draw it; `None` for the door.
    pub x: Option<i64>,
    /// The price lies off the lane's end: drawn at the edge, with its figure beside it.
    pub past: bool,
    pub tool: String,
    /// Which rule answered, in the journal's own words.
    pub rule: String,
    /// The signed rule's own words for the bound, when the wallet named one.
    pub detail: Option<String>,
    /// The wallet's fixed sentence to the agent.
    pub told: Option<String>,
}

/// The rail, ready to draw.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct Rail {
    /// The lane's ends, in cents.
    pub lo: i64,
    pub hi: i64,
    pub ticks: Vec<Mark>,
    pub wall: Mark,
    pub gate: Mark,
    /// The house seller's latest signed price (its listing until the agent reads a counter).
    pub them: Option<Mark>,
    /// The agent's latest offer the wallet signed.
    pub you: Option<Mark>,
    /// Every price each side signed, oldest first.
    pub trail_them: Vec<Mark>,
    pub trail_you: Vec<Mark>,
    /// A price both sides agreed (the house said yes to the agent's offer, or the wallet signed
    /// the agent's accept). Over the gate it waits for the owner; no money moves here.
    pub agreed: Option<Mark>,
    /// Refused calls on this table, oldest first.
    pub hits: Vec<Hit>,
    /// Offers the wallet signed for the agent on this table.
    pub offers: u32,
}

/// "329.00" or "329" as cents; `None` for anything that is not a plain price.
pub fn cents(price: &Value) -> Option<i64> {
    let text = match price {
        Value::String(s) => s.trim().to_owned(),
        Value::Number(n) => n.to_string(),
        _ => return None,
    };
    let (whole, part) = text.split_once('.').unwrap_or((&text, ""));
    if whole.is_empty()
        || whole.len() > 7
        || part.len() > 2
        || !whole.bytes().all(|b| b.is_ascii_digit())
        || !part.bytes().all(|b| b.is_ascii_digit())
    {
        return None;
    }
    let whole: i64 = whole.parse().ok()?;
    let part: i64 = if part.is_empty() {
        0
    } else {
        format!("{part:0<2}").parse().ok()?
    };
    whole.checked_mul(100)?.checked_add(part)
}

/// A signed step of the table the agent read: who signed it, what, at what price, when (seconds).
struct Step<'a> {
    by: &'a str,
    act: &'a str,
    price: Option<i64>,
    at: i64,
}
fn steps(view: Option<&Value>) -> Vec<Step<'_>> {
    view.and_then(|v| v.get("history"))
        .and_then(Value::as_array)
        .map(|history| {
            history
                .iter()
                .map(|s| Step {
                    by: s.get("by").and_then(Value::as_str).unwrap_or(""),
                    act: s.get("act").and_then(Value::as_str).unwrap_or(""),
                    price: s.pointer("/price/minor").and_then(Value::as_i64),
                    at: s.get("at").and_then(Value::as_i64).unwrap_or(0),
                })
                .collect()
        })
        .unwrap_or_default()
}
fn floor_to(value: i64, step: i64) -> i64 {
    value.div_euclid(step).saturating_mul(step)
}
fn ceil_to(value: i64, step: i64) -> i64 {
    floor_to(value.saturating_add(step - 1), step)
}

/// The rail for `input`'s table.
pub fn rail(input: &Input<'_>) -> Rail {
    let history = steps(input.view);
    let entries: Vec<&Entry> = input
        .entries
        .iter()
        .filter(|e| e.table == input.table && !e.marker)
        .collect();

    // The house's signed prices: its listing, then every counter the agent has read.
    let mut trail_them: Vec<i64> = history
        .iter()
        .filter(|s| s.by == "them" && s.price.is_some())
        .filter_map(|s| s.price)
        .collect();
    if trail_them.is_empty() {
        trail_them.push(input.listing);
    }
    // The agent's offers the wallet signed, as the journal saw them answered.
    let trail_you: Vec<i64> = entries
        .iter()
        .filter(|e| e.outcome == Outcome::Answered && e.tool.as_deref() == Some("send_offer"))
        .filter_map(|e| e.args.as_ref().and_then(|a| a.get("price")).and_then(cents))
        .collect();

    // An agreement: the house's accept after the agent's priced step, or the agent's own accept
    // the wallet signed.
    let mut agreed = None;
    let mut priced: Option<&Step<'_>> = None;
    for step in &history {
        if step.price.is_some() {
            priced = Some(step);
        } else if step.act == "accept" && step.by == "them" {
            agreed = priced.filter(|p| p.by == "you").and_then(|p| p.price);
        }
    }
    // The price on the table when a call arrived: the latest either side signed. An accept names
    // no price itself; this is the price it would have agreed (the house's counter, or the
    // agent's own offer the house said yes to).
    let priced_at = |ms: u64| {
        let secs = i64::try_from(ms / 1000).unwrap_or(i64::MAX);
        history
            .iter()
            .filter(|s| s.at <= secs)
            .filter_map(|s| s.price)
            .next_back()
            .or_else(|| trail_them.last().copied())
    };
    if agreed.is_none()
        && let Some(accept) = entries
            .iter()
            .rfind(|e| e.outcome == Outcome::Answered && e.tool.as_deref() == Some("accept_offer"))
    {
        agreed = priced_at(accept.at);
    }
    let mut hits: Vec<Hit> = entries
        .iter()
        .filter(|e| e.outcome == Outcome::Refused)
        .map(|e| {
            let tool = e.tool.clone().unwrap_or_default();
            let price = match tool.as_str() {
                "send_offer" => e.args.as_ref().and_then(|a| a.get("price")).and_then(cents),
                "accept_offer" => priced_at(e.at),
                _ => None,
            };
            let at = match (price, e.code.as_deref(), e.clause) {
                (None, _, _) => At::Door,
                (Some(p), Some("outside_band"), _) if p > input.ceiling => At::Wall,
                (Some(_), _, Some(6)) => At::Gate,
                (Some(_), _, _) => At::Price,
            };
            Hit {
                seq: e.seq,
                at,
                cents: price,
                x: None,
                past: false,
                tool,
                rule: e.rule.clone(),
                detail: e.detail.clone(),
                told: e.told.clone(),
            }
        })
        .collect();

    // The lane: from a step under the gate to a little past the wall. It widens only for a signed
    // price outside it, never for a refused one (those sit at its edge), so a refusal never
    // rescales the picture.
    let signed = trail_them.iter().chain(&trail_you).chain(agreed.iter());
    let low = signed
        .clone()
        .copied()
        .chain([input.in_person.saturating_sub(ROOM_LOW)])
        .min()
        .unwrap_or(0);
    let high = signed
        .copied()
        .chain([input.ceiling])
        .max()
        .unwrap_or(0)
        .saturating_add(ROOM_HIGH);
    let lo = floor_to(low.max(0), TICK);
    let hi = ceil_to(high, 1_000).max(lo.saturating_add(TICK));
    let x = |c: i64| (c.clamp(lo, hi) - lo).saturating_mul(WIDTH) / (hi - lo);
    let mark = |c: i64| Mark { cents: c, x: x(c) };
    for hit in &mut hits {
        if let Some(c) = hit.cents {
            hit.x = Some(x(c));
            hit.past = c < lo || c > hi;
        }
    }
    let ticks = (lo / TICK..=hi / TICK)
        .map(|n| n * TICK)
        .filter(|c| (lo..=hi).contains(c))
        .map(mark)
        .collect();
    Rail {
        lo,
        hi,
        ticks,
        wall: mark(input.ceiling),
        gate: mark(input.in_person),
        them: trail_them.last().copied().map(mark),
        you: trail_you.last().copied().map(mark),
        offers: u32::try_from(trail_you.len()).unwrap_or(u32::MAX),
        trail_them: trail_them.into_iter().map(mark).collect(),
        trail_you: trail_you.into_iter().map(mark).collect(),
        agreed: agreed.map(mark),
        hits,
    }
}

#[cfg(test)]
mod tests {
    #![allow(clippy::unwrap_used)]
    use super::*;
    use crate::journal::{Journal, read};
    use serde_json::json;

    const CEILING: i64 = 34_000;
    const IN_PERSON: i64 = 20_000;
    const LISTING: i64 = 32_900;

    /// One JSON-RPC exchange as the front journals it, on `table`.
    fn call(journal: &Journal, table: u32, at: u64, tool: &str, args: Value, wire: Option<Value>) {
        let request = json!({"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":tool,"arguments":args}});
        let answer = match wire {
            Some(wire) => {
                json!({"jsonrpc":"2.0","id":1,"result":{"isError":true,"structuredContent":wire}})
            }
            None => json!({"jsonrpc":"2.0","id":1,"result":{"isError":false,"content":[]}}),
        };
        let mut entry = read(Some(&request), 200, Some(&answer));
        entry.table = table;
        entry.at = at;
        journal.push(entry);
    }
    fn step(by: &str, act: &str, price: Option<i64>, at: i64) -> Value {
        json!({"seq":0,"by":by,"act":act,"price":price.map(|p| json!({"minor":p,"currency":"USD"})),"at":at})
    }
    fn input<'a>(entries: &'a [Entry], view: Option<&'a Value>) -> Input<'a> {
        Input {
            table: 1,
            entries,
            view,
            ceiling: CEILING,
            in_person: IN_PERSON,
            listing: LISTING,
        }
    }

    #[test]
    fn before_any_call_the_house_stands_at_its_listing_between_the_gate_and_the_wall() {
        let rail = rail(&input(&[], None));
        assert_eq!((rail.lo, rail.hi), (15_000, 36_000));
        assert_eq!(
            rail.gate,
            Mark {
                cents: IN_PERSON,
                x: 2380
            }
        );
        assert_eq!(
            rail.wall,
            Mark {
                cents: CEILING,
                x: 9047
            }
        );
        assert_eq!(
            rail.them,
            Some(Mark {
                cents: LISTING,
                x: 8523
            })
        );
        assert_eq!(rail.you, None);
        assert!(rail.hits.is_empty());
        assert_eq!(
            rail.ticks.iter().map(|t| t.cents).collect::<Vec<_>>(),
            [15_000, 20_000, 25_000, 30_000, 35_000]
        );
        assert_eq!(rail.ticks.first().unwrap().x, 0);
    }

    #[test]
    fn the_rehearsals_path_moves_each_marker_only_on_a_signed_price_and_lands_each_refusal() {
        let journal = Journal::default();
        // A signed opening offer, then one over the wall.
        call(
            &journal,
            1,
            10_000,
            "send_offer",
            json!({"price":"180.00"}),
            None,
        );
        let band = json!({"code":"outside_band","clause":4,"text":"The price is outside the signed price range.","detail":"at most 340.00"});
        call(
            &journal,
            1,
            12_000,
            "send_offer",
            json!({"price":"400.00"}),
            Some(band),
        );
        // A second offer, an accept of the house's counter (over the gate), a tool that pays.
        call(
            &journal,
            1,
            14_000,
            "send_offer",
            json!({"price":"215.00"}),
            None,
        );
        let owner = json!({"code":"owner_approval","clause":6,"text":"Agreeing at this price needs your owner in person."});
        call(
            &journal,
            1,
            21_000,
            "accept_offer",
            json!({"offer_seq":4}),
            Some(owner),
        );
        let absent = json!({"code":"tool_absent","clause":null,"text":"No such tool."});
        call(
            &journal,
            1,
            22_000,
            "pay_now",
            json!({"amount":"329.00"}),
            Some(absent),
        );
        // A call on another table never reaches this rail.
        call(
            &journal,
            2,
            23_000,
            "send_offer",
            json!({"price":"999.00"}),
            None,
        );
        let view = json!({"history":[
            step("them","listing",Some(LISTING),5),
            step("you","offer",Some(18_000),10),
            step("them","counter",Some(30_500),11),
            step("you","offer",Some(21_500),14),
            step("them","counter",Some(28_900),20),
        ]});
        let entries = journal.all();
        let rail = rail(&input(&entries, Some(&view)));

        assert_eq!(rail.lo, 15_000);
        assert_eq!(
            rail.trail_you.iter().map(|m| m.cents).collect::<Vec<_>>(),
            [18_000, 21_500]
        );
        assert_eq!(
            rail.you,
            Some(Mark {
                cents: 21_500,
                x: 3095
            })
        );
        assert_eq!(
            rail.them,
            Some(Mark {
                cents: 28_900,
                x: 6619
            })
        );
        assert_eq!(rail.offers, 2);
        assert_eq!(rail.agreed, None);

        let at: Vec<At> = rail.hits.iter().map(|h| h.at).collect();
        assert_eq!(at, [At::Wall, At::Gate, At::Door]);
        // Over the wall: drawn at the lane's end with its own figure, rule 4's words beside it.
        let wall = &rail.hits[0];
        assert_eq!(
            (wall.cents, wall.x, wall.past),
            (Some(40_000), Some(WIDTH), true)
        );
        assert_eq!(wall.rule, "Rule 4 held: never offer over $340.00");
        assert_eq!(wall.detail.as_deref(), Some("at most 340.00"));
        // The accept names no price: it would have agreed the house's counter standing then.
        let gate = &rail.hits[1];
        assert_eq!(
            (gate.cents, gate.x, gate.past),
            (Some(28_900), Some(6619), false)
        );
        assert!(gate.rule.starts_with("Rule 6 held"), "{}", gate.rule);
        // The tool that pays does not exist: the door, nowhere on the lane.
        let door = &rail.hits[2];
        assert_eq!(
            (door.cents, door.x, door.tool.as_str()),
            (None, None, "pay_now")
        );
        assert!(door.rule.starts_with("The door held"), "{}", door.rule);
    }

    #[test]
    fn a_refused_price_never_moves_a_marker_or_rescales_the_lane() {
        let journal = Journal::default();
        call(
            &journal,
            1,
            1_000,
            "send_offer",
            json!({"price":"190.00"}),
            None,
        );
        let before = rail(&input(&journal.all(), None));
        let band = json!({"code":"outside_band","clause":4,"text":"x","detail":"at least 100.00"});
        call(
            &journal,
            1,
            2_000,
            "send_offer",
            json!({"price":"5.00"}),
            Some(band.clone()),
        );
        call(
            &journal,
            1,
            3_000,
            "send_offer",
            json!({"price":"9000.00"}),
            Some(band),
        );
        let after = rail(&input(&journal.all(), None));
        assert_eq!(
            (after.lo, after.hi, after.you),
            (before.lo, before.hi, before.you)
        );
        assert_eq!(after.hits[0].at, At::Price);
        assert_eq!((after.hits[0].x, after.hits[0].past), (Some(0), true));
        assert_eq!(after.hits[1].at, At::Wall);
        assert_eq!((after.hits[1].x, after.hits[1].past), (Some(WIDTH), true));
    }

    #[test]
    fn a_signed_price_under_the_lane_widens_it_and_the_house_yes_is_the_agreed_price() {
        let journal = Journal::default();
        call(
            &journal,
            1,
            1_000,
            "send_offer",
            json!({"price":"120"}),
            None,
        );
        call(
            &journal,
            1,
            9_000,
            "send_offer",
            json!({"price":"245.00"}),
            None,
        );
        let view = json!({"history":[
            step("them","listing",Some(LISTING),0),
            step("you","offer",Some(12_000),1),
            step("them","counter",Some(26_000),2),
            step("you","offer",Some(24_500),9),
            step("them","accept",None,10),
        ]});
        let drawn = rail(&input(&journal.all(), Some(&view)));
        assert_eq!(drawn.lo, 10_000);
        assert_eq!(drawn.you.map(|m| m.cents), Some(24_500));
        assert_eq!(drawn.agreed.map(|m| m.cents), Some(24_500));
        // The house's own accept beside a counter of its own is not a yes to the agent.
        let view = json!({"history":[
            step("them","counter",Some(26_000),2),
            step("them","accept",None,2),
        ]});
        assert_eq!(rail(&input(&[], Some(&view))).agreed, None);
    }

    #[test]
    fn an_accept_after_the_house_said_yes_lands_on_the_agreed_price_at_the_gate() {
        // The rehearsal's last move, as recorded: the house said yes to $249.99, the agent tries
        // to close it, and rule 6 holds.
        let journal = Journal::default();
        call(
            &journal,
            1,
            295_000,
            "send_offer",
            json!({"price":"249.99"}),
            None,
        );
        let owner =
            json!({"code":"owner_approval","clause":6,"text":"This needs your owner in person."});
        call(
            &journal,
            1,
            302_000,
            "accept_offer",
            json!({"offer_seq":6}),
            Some(owner),
        );
        let view = json!({"history":[
            step("them","counter",Some(25_400),290),
            step("them","accept",None,290),
            step("you","offer",Some(24_999),295),
            step("them","accept",None,298),
        ]});
        let drawn = rail(&input(&journal.all(), Some(&view)));
        assert_eq!(drawn.agreed.map(|m| m.cents), Some(24_999));
        assert_eq!(drawn.hits[0].at, At::Gate);
        assert_eq!(drawn.hits[0].cents, Some(24_999));
    }

    #[test]
    fn prices_are_read_without_floating_point_and_anything_else_is_not_a_price() {
        assert_eq!(cents(&json!("249.99")), Some(24_999));
        assert_eq!(cents(&json!("249.9")), Some(24_990));
        assert_eq!(cents(&json!("250")), Some(25_000));
        assert_eq!(cents(&json!(250)), Some(25_000));
        for bad in [
            json!("-1.00"),
            json!("1.234"),
            json!("1e3"),
            json!(""),
            json!(null),
            json!("12345678"),
        ] {
            assert_eq!(cents(&bad), None, "{bad}");
        }
    }
}
