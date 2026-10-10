//! Whitelisted, bound SQL on an independent read-only connection/snapshot.
use crate::{Ledger, LedgerError};
use rusqlite::{
    Connection, OpenFlags, params_from_iter,
    types::{Value, ValueRef},
};
use serde_json::{Map, Value as Json, json};
use table_core::*;
fn invalid(reason: &'static str) -> LedgerError {
    LedgerError::Integrity(reason)
}
/// The rule a closed BookQuery breaks, in fixed words, or None when it compiles. Pure: nothing is
/// read. The owner's book_query command returns this verbatim as its INVALID message.
pub fn book_query_rejection(query: &BookQuery) -> Option<&'static str> {
    if let Some(reason) = query.rejection() {
        return Some(reason);
    }
    match compile(query) {
        Ok(_) => None,
        Err(LedgerError::Integrity(reason)) => Some(reason),
        Err(_) => Some("the query does not compile"),
    }
}
const AMOUNT: &str = "d.qty*d.unit_price_minor";
// Percentage output/filter uses integer basis points. No floating money arithmetic.
const MARKET: &str = "(d.unit_price_minor-json_extract(d.market_json,'$.median.minor'))*10000/NULLIF(json_extract(d.market_json,'$.median.minor'),0)";
/// A deal's state as the Book reads it. A RECEIPTED deal whose receipt is only the seller's word
/// (a buyer's haggle or shop order before PayPal's statement matched it) is its own key,
/// `RECEIPTED:buyer`, the key the client Book already uses: a filter on the paid states leaves it
/// out, and a line per state shows it apart (DECISIONS.md section 23).
const STATE: &str = "CASE WHEN d.state='RECEIPTED' AND d.receipt_evidence='seller_attested' THEN 'RECEIPTED:buyer' ELSE d.state END";
fn field(field: BookField) -> &'static str {
    match field {
        BookField::Kind => "d.kind",
        BookField::State => STATE,
        BookField::Counterparty => "d.counterparty",
        BookField::Amount => AMOUNT,
        BookField::CreatedAt => "CAST(d.created_at AS INTEGER)",
        BookField::VsMarketPct => MARKET,
        BookField::DecidedBy => "d.decided_by",
    }
}
fn group(group: BookGroup) -> (&'static str, &'static str) {
    match group {
        BookGroup::Kind => ("kind", "d.kind"),
        BookGroup::Counterparty => ("counterparty", "d.counterparty"),
        BookGroup::State => ("state", STATE),
        BookGroup::Day => ("day", "date(CAST(d.created_at AS INTEGER),'unixepoch')"),
        BookGroup::DecidedBy => ("decided_by", "d.decided_by"),
    }
}
fn timestamp(text: &str) -> Result<i64, LedgerError> {
    time::OffsetDateTime::parse(text, &time::format_description::well_known::Rfc3339)
        .map(|t| t.unix_timestamp())
        .map_err(|_| invalid("range: from and to must be RFC 3339 times"))
}
fn bound(value: &Json, field: BookField) -> Result<Value, LedgerError> {
    if matches!(
        field,
        BookField::Amount | BookField::CreatedAt | BookField::VsMarketPct
    ) {
        return value
            .as_i64()
            .map(Value::Integer)
            .ok_or_else(|| invalid("filters: amount, created_at and vs_market_pct take integers"));
    }
    value
        .as_str()
        .filter(|s| !s.is_empty() && s.len() <= 256)
        .map(|s| Value::Text(s.into()))
        .ok_or_else(|| invalid("filters: text values are 1 to 256 characters"))
}
fn compile(query: &BookQuery) -> Result<(String, Vec<Value>), LedgerError> {
    query.validate()?;
    let mut columns = vec![
        "d.currency AS currency".to_owned(),
        "d.mode AS mode".to_owned(),
    ];
    let mut groups = vec!["d.currency".to_owned(), "d.mode".to_owned()];
    for g in &query.group_by {
        let (name, column) = group(*g);
        columns.push(format!("{column} AS {name}"));
        groups.push(column.into());
    }
    for metric in &query.metrics {
        columns.push(match metric {
            BookMetric::Count => "COUNT(*) AS count".into(),
            BookMetric::SumAmount => format!("SUM({AMOUNT}) AS sum_amount"),
            BookMetric::AvgVsMarketPct => {
                format!("SUM({MARKET})/NULLIF(COUNT({MARKET}),0) AS avg_vs_market_bp")
            }
            // The rescue module's one predicate (rescue.rs `COUNTED`): never REPLAY, never "sent".
            BookMetric::RecoveredSum => format!(
                "SUM(CASE WHEN {} THEN d.qty*d.unit_price_minor ELSE 0 END) AS recovered_sum",
                crate::rescue::COUNTED
            ),
        });
    }
    if query.view == BookView::PaypalCalls && query.metrics.contains(&BookMetric::RecoveredSum) {
        return Err(invalid(
            "recovered_sum is not defined on the paypal_calls view",
        ));
    }
    let source = match query.view {
        BookView::PaypalCalls => {
            "deals d JOIN paypal_calls p ON p.deal_id=d.id LEFT JOIN receipts r ON r.deal_id=d.id"
        }
        BookView::Receipts => "deals d JOIN receipts r ON r.deal_id=d.id",
        _ => "deals d LEFT JOIN receipts r ON r.deal_id=d.id",
    };
    let mut conditions = vec!["1=1".to_owned()];
    if query.view == BookView::Subscriptions {
        conditions.push("d.pp_subscription_id IS NOT NULL".into());
    }
    if query.view == BookView::Reconciliation {
        conditions.push("d.reconciliation!='n/a'".into());
    }
    let mut values = Vec::new();
    for filter in &query.filters {
        let column = field(filter.field);
        let text = match filter.op {
            BookOp::In | BookOp::Between => {
                let array = filter
                    .value
                    .as_array()
                    .filter(|a| !a.is_empty() && a.len() <= 32)
                    .ok_or_else(|| {
                        invalid("filters: in and between take an array of 1 to 32 values")
                    })?;
                if filter.op == BookOp::Between && array.len() != 2 {
                    return Err(invalid("filters: between takes exactly two values"));
                }
                for value in array {
                    values.push(bound(value, filter.field)?);
                }
                if filter.op == BookOp::Between {
                    format!("{column} BETWEEN ? AND ?")
                } else {
                    format!("{column} IN ({})", vec!["?"; array.len()].join(","))
                }
            }
            op => {
                values.push(bound(&filter.value, filter.field)?);
                format!(
                    "{column} {} ?",
                    match op {
                        BookOp::Eq => "=",
                        BookOp::Ne => "!=",
                        BookOp::Gt => ">",
                        BookOp::Lt => "<",
                        _ => return Err(invalid("filters: unknown operator")),
                    }
                )
            }
        };
        conditions.push(text);
    }
    if let Some(range) = &query.range {
        let from = timestamp(&range.from)?;
        let to = timestamp(&range.to)?;
        if from >= to {
            return Err(invalid("range: from must be before to"));
        }
        conditions
            .push("CAST(d.created_at AS INTEGER)>=? AND CAST(d.created_at AS INTEGER)<?".into());
        values.extend([Value::Integer(from), Value::Integer(to)]);
    }
    values.push(Value::Integer(i64::from(query.limit.unwrap_or(500))));
    Ok((
        format!(
            "SELECT {} FROM {source} WHERE {} GROUP BY {} ORDER BY {} LIMIT ?",
            columns.join(","),
            conditions.join(" AND "),
            groups.join(","),
            groups.join(",")
        ),
        values,
    ))
}
impl Ledger {
    fn book_connection(&self) -> Result<Connection, LedgerError> {
        let conn = if let Some(path) = self.conn.path().filter(|p| !p.is_empty()) {
            Connection::open_with_flags(
                path,
                OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_NO_MUTEX,
            )?
        } else {
            let mut conn = Connection::open_in_memory()?;
            rusqlite::backup::Backup::new(&self.conn, &mut conn)?.run_to_completion(
                128,
                std::time::Duration::ZERO,
                None,
            )?;
            conn
        };
        conn.execute_batch("PRAGMA query_only=ON;")?;
        Ok(conn)
    }
    pub fn book_query(&self, query: &BookQuery) -> Result<Json, LedgerError> {
        let (sql, values) = compile(query)?;
        let conn = self.book_connection()?;
        let mut statement = conn.prepare(&sql)?;
        if !statement.readonly() {
            return Err(invalid("the book connection is read-only"));
        }
        let names = statement
            .column_names()
            .iter()
            .map(|s| s.to_string())
            .collect::<Vec<_>>();
        let mut rows = statement.query(params_from_iter(values))?;
        let mut result = Vec::new();
        while let Some(row) = rows.next()? {
            let mut object = Map::new();
            for (i, name) in names.iter().enumerate() {
                let value = match row.get_ref(i)? {
                    ValueRef::Null => Json::Null,
                    ValueRef::Integer(n) => json!(n),
                    ValueRef::Text(t) => {
                        json!(
                            std::str::from_utf8(t)
                                .map_err(|_| invalid("book text is not UTF-8"))?
                        )
                    }
                    _ => return Err(invalid("book value type")),
                };
                object.insert(name.clone(), value);
            }
            result.push(Json::Object(object));
        }
        Ok(
            json!({"rows":result,"amount_units":"minor","market_units":"basis_points","max_rows":500}),
        )
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn c1_closed_query_and_readonly_connection_reject_writes_and_bind_injection() {
        let ledger = Ledger::in_memory().unwrap();
        assert!(
            serde_json::from_value::<BookQuery>(
                json!({"view":"deals","metrics":["count"],"sql":"DELETE FROM audit_log"})
            )
            .is_err()
        );
        assert!(
            serde_json::from_value::<BookQuery>(json!({"view":"deals;DELETE","metrics":["count"]}))
                .is_err()
        );
        let query:BookQuery=serde_json::from_value(json!({"view":"deals","metrics":["count"],"filters":[{"field":"counterparty","op":"eq","value":"x'; DELETE FROM audit_log;--"}]})).unwrap();
        let (sql, params) = compile(&query).unwrap();
        assert!(!sql.contains("DELETE"));
        assert_eq!(params.len(), 2);
        assert_eq!(ledger.book_query(&query).unwrap()["rows"], json!([]));
        for sql in [
            "DELETE FROM audit_log",
            "INSERT INTO local_preferences(key,value_json) VALUES ('bad','true')",
        ] {
            let error = ledger
                .book_connection()
                .unwrap()
                .execute(sql, [])
                .unwrap_err();
            assert!(
                matches!(error, rusqlite::Error::SqliteFailure(e, _) if e.code == rusqlite::ErrorCode::ReadOnly)
            );
        }
        ledger.verify_audit().unwrap();
    }
    #[test]
    fn file_book_connection_reads_committed_data_and_rejects_mutation() {
        let mut nonce = [0; 32];
        getrandom::fill(&mut nonce).unwrap();
        let root = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("../../.build/book-tests")
            .join(H256(nonce).hex());
        std::fs::create_dir_all(&root).unwrap();
        let ledger = Ledger::open(&root.join("book.sqlite")).unwrap();
        ledger
            .conn
            .execute(
                "INSERT INTO local_preferences(key,value_json) VALUES ('fixture','true')",
                [],
            )
            .unwrap();
        let conn = ledger.book_connection().unwrap();
        assert_eq!(
            conn.query_row(
                "SELECT value_json FROM local_preferences WHERE key='fixture'",
                [],
                |r| r.get::<_, String>(0)
            )
            .unwrap(),
            "true"
        );
        let error = conn
            .execute(
                "UPDATE local_preferences SET value_json='false' WHERE key='fixture'",
                [],
            )
            .unwrap_err();
        assert!(
            matches!(error, rusqlite::Error::SqliteFailure(e, _) if e.code == rusqlite::ErrorCode::ReadOnly)
        );
        assert_eq!(
            ledger
                .conn
                .query_row(
                    "SELECT value_json FROM local_preferences WHERE key='fixture'",
                    [],
                    |r| r.get::<_, String>(0)
                )
                .unwrap(),
            "true"
        );
        ledger.verify_audit().unwrap();
    }
    #[test]
    fn query_bounds_and_recovered_metric_exclude_replay() {
        let ledger = Ledger::in_memory().unwrap();
        for view in [
            "deals",
            "paypal_calls",
            "receipts",
            "subscriptions",
            "reconciliation",
        ] {
            let q:BookQuery=serde_json::from_value(json!({"view":view,"metrics":["count","sum_amount","avg_vs_market_pct"],"limit":500})).unwrap();
            ledger.book_query(&q).unwrap();
        }
        for value in [
            json!({"view":"deals","metrics":[]}),
            json!({"view":"deals","metrics":["count"],"limit":501}),
            json!({"view":"deals","metrics":["count"],"filters":[{"field":"amount","op":"eq","value":"1.00"}]}),
        ] {
            let q: BookQuery = serde_json::from_value(value).unwrap();
            assert!(ledger.book_query(&q).is_err());
        }
        // Only S counts: R is a replayed failure, E a scripted engine's, P a PayPal-reported one
        // that was only sent, U one whose send was never confirmed.
        for (id, mode, source, state, send, amount) in [
            ("S", "sandbox", "paypal", "RECEIPTED", "confirmed", 960),
            ("R", "replay", "replay", "RECEIPTED", "confirmed", 1200),
            (
                "E",
                "scripted_engine",
                "paypal",
                "RECEIPTED",
                "confirmed",
                1500,
            ),
            (
                "P",
                "sandbox",
                "paypal",
                "AWAITING_APPROVAL",
                "confirmed",
                700,
            ),
            ("U", "sandbox", "paypal", "RECEIPTED", "unknown", 800),
        ] {
            ledger.conn.execute("INSERT INTO deals(id,kind,side,mandate_id,mandate_version,qty,unit_price_minor,currency,state,created_at,updated_at,mode,pp_order_id,receipt_evidence) VALUES (?1,'rescue','seller','fixture',1,1,?2,'USD',?4,'100','100',?3,'INV-'||?1,'paypal_verified')",rusqlite::params![id,amount,mode,state]).unwrap();
            ledger.conn.execute("INSERT INTO receipts(deal_id,capture_id,amount_minor,raw_jws,transcript_head,verified_at) VALUES (?1,'INV-'||?1,?2,'synthetic',zeroblob(32),'100')",rusqlite::params![id,amount]).unwrap();
            ledger.conn.execute("INSERT INTO rescue_cases(deal_id,source,subscription_id,recipient,offer_json,failed_payments,failed_on) VALUES (?1,?2,'I-'||?1,'s@example.com','{}',1,0)",rusqlite::params![id,source]).unwrap();
            ledger.conn.execute("INSERT INTO operations(deal_id,attempt,operation,request_id,decided_by,status,started_at) VALUES (?1,1,'invoice-send',?1||'-send','{}',?2,100)",rusqlite::params![id,send]).unwrap();
        }
        let q: BookQuery =
            serde_json::from_value(json!({"view":"receipts","metrics":["recovered_sum"]})).unwrap();
        let result = ledger.book_query(&q).unwrap();
        let rows = result["rows"].as_array().unwrap();
        assert_eq!(
            rows.iter()
                .map(|r| r["recovered_sum"].as_i64().unwrap())
                .sum::<i64>(),
            960
        );
        assert!(
            rows.iter()
                .filter(|r| r["mode"] != "sandbox")
                .all(|r| r["recovered_sum"] == 0)
        );
    }
}
#[cfg(test)]
mod rejection_tests {
    use super::*;
    #[test]
    fn rejections_name_the_rule_in_fixed_words_and_never_echo_a_value() {
        let q = |v: Json| serde_json::from_value::<BookQuery>(v).unwrap();
        assert_eq!(
            book_query_rejection(&q(json!({"view":"deals","metrics":[]}))),
            Some("metrics: 1 to 4 required")
        );
        assert_eq!(
            book_query_rejection(&q(
                json!({"view":"deals","metrics":["count"],"group_by":["kind","kind"]})
            )),
            Some("group_by: each at most once")
        );
        assert_eq!(
            book_query_rejection(&q(
                json!({"view":"paypal_calls","metrics":["recovered_sum"]})
            )),
            Some("recovered_sum is not defined on the paypal_calls view")
        );
        let secret = "x'; DROP TABLE deals;--".repeat(20);
        let r = book_query_rejection(&q(
            json!({"view":"deals","metrics":["count"],"filters":[{"field":"counterparty","op":"eq","value":secret}]}),
        ))
        .unwrap();
        assert!(r.contains("1 to 256") && !r.contains("DROP"));
        assert_eq!(
            book_query_rejection(&q(
                json!({"view":"deals","metrics":["count"],"range":{"from":"2026-10-07T00:00:00Z","to":"2026-10-06T00:00:00Z"}})
            )),
            Some("range: from must be before to")
        );
        assert_eq!(
            book_query_rejection(&q(
                json!({"view":"deals","metrics":["count","sum_amount"],"group_by":["decided_by"]})
            )),
            None
        );
    }
}
