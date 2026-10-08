//! `cargo test --workspace -- --list 2>&1 | acceptance-matrix`: prints the acceptance matrix
//! (which tests carry which §13 / window acceptance ID) as markdown on stdout. Exit 0 when every
//! never-cut ID has a test, 1 when one has none, 2 when the input lists no test.
use std::{io::Read, process::ExitCode};

fn main() -> ExitCode {
    let mut bytes = Vec::new();
    if std::io::stdin().read_to_end(&mut bytes).is_err() {
        eprintln!("cannot read the test list from stdin");
        return ExitCode::from(2);
    }
    let matrix = table_verify::acceptance::Matrix::build(&String::from_utf8_lossy(&bytes));
    if matrix.listed == 0 {
        eprintln!("no tests in the input: pipe `cargo test --workspace -- --list 2>&1` into it");
        return ExitCode::from(2);
    }
    print!("{}", matrix.markdown());
    let missing = matrix.missing_never_cut();
    if missing.is_empty() {
        ExitCode::SUCCESS
    } else {
        eprintln!(
            "never-cut acceptance IDs with no test: {}",
            missing.join(", ")
        );
        ExitCode::from(1)
    }
}
