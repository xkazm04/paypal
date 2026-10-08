//! The acceptance matrix (moonshot card ops-and-delivery-1): which tests carry which acceptance
//! ID, built from the text `cargo test --workspace -- --list` prints and the checked-in ID list
//! (`acceptance-ids.txt`, from design report §13 and window-duality.md §7). Pure: no IO here.
//!
//! A test carries an ID when its name (the last `::` segment) starts with a run of ID tokens
//! (`f4_w3_w11_approval_...` carries F4, W3 and W11) or names one right after an `and`
//! (`h3_two_accepts_one_order_and_h5_...` carries H3 and H5). Only IDs on the list count, so
//! `sha2_...` or `v2_...` carry nothing.

/// The checked-in acceptance ID list.
pub const ACCEPTANCE_IDS: &str = include_str!("acceptance-ids.txt");

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Criterion {
    pub id: &'static str,
    pub summary: &'static str,
    /// On §13's never-cut line: CI fails while it has no test.
    pub never_cut: bool,
}

/// Every acceptance criterion on the checked-in list, in its order.
pub fn criteria() -> Vec<Criterion> {
    ACCEPTANCE_IDS
        .lines()
        .map(str::trim)
        .filter(|line| !line.is_empty() && !line.starts_with('#'))
        .map(|line| {
            let (never_cut, line) = match line.strip_prefix('*') {
                Some(rest) => (true, rest),
                None => (false, line),
            };
            let (id, summary) = line.split_once(' ').unwrap_or((line, ""));
            Criterion {
                id,
                summary: summary.trim(),
                never_cut,
            }
        })
        .collect()
}

/// One test `--list` printed, with the binary it was listed under (a crate's unit tests, an
/// integration test file, or a crate's doc tests).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ListedTest {
    pub binary: String,
    pub name: String,
}

/// The tests in `cargo test -- --list` output. With stderr folded in (`2>&1`) each test is
/// attributed to the binary named on the `Running` / `Doc-tests` line before it.
pub fn listed_tests(text: &str) -> Vec<ListedTest> {
    let mut binary = String::from("?");
    let mut tests = Vec::new();
    for line in text.lines() {
        let trimmed = line.trim();
        if let Some(rest) = trimmed.strip_prefix("Running ") {
            binary = running_label(rest);
        } else if let Some(name) = trimmed.strip_prefix("Doc-tests ") {
            binary = format!("{} (doc)", name.trim());
        } else if let Some(name) = trimmed.strip_suffix(": test") {
            tests.push(ListedTest {
                binary: binary.clone(),
                name: name.to_owned(),
            });
        }
    }
    tests
}

/// `unittests src/lib.rs (target/debug/deps/table_core-0123abcd)` reads as `table_core`. An
/// integration test's line does not name its crate, so `tests/server.rs
/// (target/debug/deps/server-0123abcd)` reads as `server (tests/server.rs)`.
fn running_label(rest: &str) -> String {
    let (what, path) = match rest.rsplit_once(" (") {
        Some((what, path)) => (what.trim(), path.trim_end_matches(')')),
        None => (rest.trim(), ""),
    };
    let file = path.rsplit(['/', '\\']).next().unwrap_or(path);
    let file = file.strip_suffix(".exe").unwrap_or(file);
    let stem = match file.rsplit_once('-') {
        Some((stem, hash)) if !hash.is_empty() && hash.bytes().all(|b| b.is_ascii_hexdigit()) => {
            stem
        }
        _ => file,
    };
    if stem.is_empty() {
        what.to_owned()
    } else if what.starts_with("unittests") {
        stem.to_owned()
    } else {
        format!("{stem} ({what})")
    }
}

/// The acceptance IDs a test name carries (see the module docs), uppercased, in name order.
pub fn ids_of(name: &str, known: &[Criterion]) -> Vec<&'static str> {
    let last = name.rsplit("::").next().unwrap_or(name);
    if last.contains(char::is_whitespace) {
        return Vec::new();
    }
    let mut found: Vec<&'static str> = Vec::new();
    let mut in_run = true;
    for token in last.split('_') {
        let id = known
            .iter()
            .find(|c| c.id.eq_ignore_ascii_case(token))
            .map(|c| c.id);
        match id {
            Some(id) if in_run => {
                if !found.contains(&id) {
                    found.push(id);
                }
            }
            Some(_) => {}
            None => in_run = token == "and",
        }
    }
    found
}

#[derive(Debug, Clone)]
pub struct Row {
    pub criterion: Criterion,
    /// `binary: test name`, sorted.
    pub tests: Vec<String>,
}
#[derive(Debug, Clone)]
pub struct Matrix {
    pub rows: Vec<Row>,
    /// How many tests the input listed.
    pub listed: usize,
}
impl Matrix {
    pub fn build(list: &str) -> Self {
        let known = criteria();
        let tests = listed_tests(list);
        let rows = known
            .iter()
            .map(|criterion| {
                let mut found: Vec<String> = tests
                    .iter()
                    .filter(|t| ids_of(&t.name, &known).contains(&criterion.id))
                    .map(|t| format!("{}: {}", t.binary, t.name))
                    .collect();
                found.sort();
                found.dedup();
                Row {
                    criterion: criterion.clone(),
                    tests: found,
                }
            })
            .collect();
        Self {
            rows,
            listed: tests.len(),
        }
    }
    /// Never-cut IDs with no test: CI fails on any.
    pub fn missing_never_cut(&self) -> Vec<&'static str> {
        self.rows
            .iter()
            .filter(|r| r.criterion.never_cut && r.tests.is_empty())
            .map(|r| r.criterion.id)
            .collect()
    }
    /// The matrix as a GitHub job-summary markdown table.
    pub fn markdown(&self) -> String {
        let covered = self.rows.iter().filter(|r| !r.tests.is_empty()).count();
        let never: Vec<&Row> = self.rows.iter().filter(|r| r.criterion.never_cut).collect();
        let missing = self.missing_never_cut();
        let mut out = String::from("## Acceptance matrix\n\n");
        out.push_str(&format!(
            "{covered} of {} acceptance IDs carry at least one test (of {} tests listed). Never-cut IDs: {}.\n\n",
            self.rows.len(),
            self.listed,
            if missing.is_empty() {
                format!("all {} covered", never.len())
            } else {
                format!("**missing {}**", missing.join(", "))
            }
        ));
        out.push_str(
            "A test carries an ID when its name starts with it (`h1_...`, `f4_w3_...`) or names it after `and`.\n\n",
        );
        out.push_str("| ID | Never cut | Criterion | Tests |\n|---|---|---|---|\n");
        for row in &self.rows {
            let tests = if row.tests.is_empty() {
                "none".to_owned()
            } else {
                let shown: Vec<String> = row
                    .tests
                    .iter()
                    .take(6)
                    .map(|t| format!("`{}`", t.replace('|', "\\|")))
                    .collect();
                let more = row.tests.len().saturating_sub(6);
                if more > 0 {
                    format!("{} (+{more} more)", shown.join("<br>"))
                } else {
                    shown.join("<br>")
                }
            };
            out.push_str(&format!(
                "| {} | {} | {} | {} |\n",
                row.criterion.id,
                if row.criterion.never_cut { "yes" } else { "" },
                row.criterion.summary.replace('|', "\\|"),
                tests
            ));
        }
        out
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ids(name: &str) -> Vec<&'static str> {
        ids_of(name, &criteria())
    }

    #[test]
    fn the_list_holds_every_section_13_and_window_id_and_the_never_cut_set() {
        let all = criteria();
        let id_list: Vec<&str> = all.iter().map(|c| c.id).collect();
        let mut expected = Vec::new();
        for (family, last) in [
            ("H", 6),
            ("F", 5),
            ("M", 3),
            ("C", 2),
            ("S", 3),
            ("R", 3),
            ("E", 3),
            ("U", 4),
            ("W", 11),
        ] {
            for n in 1..=last {
                expected.push(format!("{family}{n}"));
            }
        }
        assert_eq!(id_list, expected);
        assert!(all.iter().all(|c| !c.summary.is_empty()));
        let never: Vec<&str> = all.iter().filter(|c| c.never_cut).map(|c| c.id).collect();
        assert_eq!(
            never,
            [
                "H1", "H2", "H3", "H4", "H5", "H6", "F1", "F2", "F3", "F4", "S1", "S2", "S3", "E1",
                "E2", "E3", "W3"
            ]
        );
    }

    /// The checked-in list does not drift from the design documents it copies.
    #[test]
    fn every_listed_id_is_stated_in_the_design_documents() {
        let root = concat!(env!("CARGO_MANIFEST_DIR"), "/../../docs/design/");
        let report = std::fs::read_to_string(format!("{root}the-table.extract.txt")).unwrap();
        let windows = std::fs::read_to_string(format!("{root}window-duality.md")).unwrap();
        assert!(report.contains("never cut mandate + signer"));
        for c in criteria() {
            let stated = if c.id.starts_with('W') {
                windows.contains(&format!("**{}** ", c.id))
            } else {
                report.contains(&format!(" {} ", c.id))
            };
            assert!(stated, "{} is not stated in the design documents", c.id);
        }
    }

    #[test]
    fn a_name_carries_its_leading_ids_and_those_after_and_only() {
        assert_eq!(
            ids("h1_m3_out_of_band_is_error_and_zero_paypal_rows"),
            ["H1", "M3"]
        );
        assert_eq!(
            ids("tests::h3_two_accepts_one_order_and_h5_seller_receives_without_owner_click"),
            ["H3", "H5"]
        );
        assert_eq!(
            ids("exact_argv_and_e3_no_stream_json_schema_conflict"),
            ["E3"]
        );
        assert_eq!(
            ids("f4_w3_w11_approval_label_token_idle_lock_and_os_reauth"),
            ["F4", "W3", "W11"]
        );
        assert!(ids("sha2_v2_roundtrip_e2e_and_s9_is_unknown").is_empty());
        assert!(ids("a_hold_mentions_s2_mid_name").is_empty());
        assert!(ids("src/lib.rs - h1 (line 3)").is_empty());
    }

    const LIST: &str = "\
    Finished `test` profile [unoptimized + debuginfo] target(s) in 0.4s
     Running unittests src/lib.rs (target/debug/deps/table_shield-0a1b2c3d4e5f6789)
tests::s2_model_can_never_lower_caution: test
tests::every_verdict_names_the_rule: test

2 tests, 0 benchmarks
     Running tests/server.rs (target/debug/deps/server-00112233aabbccdd)
h1_m3_out_of_band_is_error_and_zero_paypal_rows: test
   Doc-tests table_core
crates/table-core/src/lib.rs - f1 (line 10): test
";

    #[test]
    fn the_list_is_read_with_each_test_s_binary_and_the_matrix_names_what_is_missing() {
        let tests = listed_tests(LIST);
        assert_eq!(tests.len(), 4);
        assert_eq!(tests[0].binary, "table_shield");
        assert_eq!(tests[2].binary, "server (tests/server.rs)");
        assert_eq!(tests[3].binary, "table_core (doc)");
        let matrix = Matrix::build(LIST);
        assert_eq!(matrix.listed, 4);
        let row = |id: &str| matrix.rows.iter().find(|r| r.criterion.id == id).unwrap();
        assert_eq!(
            row("S2").tests,
            ["table_shield: tests::s2_model_can_never_lower_caution"]
        );
        assert_eq!(
            row("M3").tests,
            ["server (tests/server.rs): h1_m3_out_of_band_is_error_and_zero_paypal_rows"]
        );
        assert!(row("F1").tests.is_empty());
        let missing = matrix.missing_never_cut();
        assert!(missing.contains(&"F1") && missing.contains(&"W3"));
        assert!(!missing.contains(&"H1") && !missing.contains(&"S2"));
        assert!(!missing.contains(&"M3"));
        let markdown = matrix.markdown();
        assert!(markdown.contains("| H1 | yes |"));
        assert!(markdown.contains("**missing H2"));
        assert!(markdown.contains("| F5 |  |"));
    }
}
