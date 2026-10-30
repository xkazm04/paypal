//! `cargo run -p table-sandbox`: boots the sandbox, prints where to connect, and prints each call
//! the connected agent makes until ctrl-c. `--port <n>` moves the front (default 1443).
use std::sync::atomic::Ordering;

const DEFAULT_PORT: u16 = 1443;

struct Options {
    port: u16,
    rehearse: bool,
}
fn options() -> Result<Options, String> {
    let mut args = std::env::args().skip(1);
    let mut port = DEFAULT_PORT;
    let mut rehearse = false;
    while let Some(arg) = args.next() {
        match arg.as_str() {
            "--rehearse" => rehearse = true,
            "--port" => {
                port = args
                    .next()
                    .and_then(|p| p.parse().ok())
                    .filter(|p| *p != 0)
                    .ok_or("--port needs a port number")?;
            }
            "--help" | "-h" => {
                println!("table-sandbox [--port <n>] [--rehearse]");
                println!(
                    "  --port <n>   serve the live page and /mcp on 127.0.0.1:<n> (default {DEFAULT_PORT})"
                );
                println!("  --rehearse   a scripted client (no AI) walks the judge's path once");
                std::process::exit(0);
            }
            other => return Err(format!("unknown argument: {other}")),
        }
    }
    Ok(Options { port, rehearse })
}

/// Resolves on Ctrl+C (and on Windows also Ctrl+Break, which a console host can send to a
/// process group). A signal that cannot be watched never resolves.
async fn stop() {
    let interrupt = async {
        if tokio::signal::ctrl_c().await.is_err() {
            std::future::pending::<()>().await;
        }
    };
    #[cfg(windows)]
    let brk = async {
        match tokio::signal::windows::ctrl_break() {
            Ok(mut signal) => {
                signal.recv().await;
            }
            Err(_) => std::future::pending::<()>().await,
        }
    };
    #[cfg(not(windows))]
    let brk = std::future::pending::<()>();
    tokio::select! {
        () = interrupt => {}
        () = brk => {}
    }
}

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let Options { port, rehearse } = options()?;
    let listener = tokio::net::TcpListener::bind((std::net::Ipv4Addr::LOCALHOST, port))
        .await
        .map_err(|_| format!("port {port} is taken; pass --port <n>"))?;
    let sandbox = table_sandbox::boot(port).await?;
    let app = sandbox.app.clone();
    app.echo.store(true, Ordering::Relaxed);
    let ansi = std::env::var_os("NO_COLOR").is_none()
        && std::io::IsTerminal::is_terminal(&std::io::stdout())
        && (cfg!(not(windows))
            || std::env::var_os("WT_SESSION").is_some()
            || std::env::var_os("TERM_PROGRAM").is_some());
    app.color.store(ansi, Ordering::Relaxed);
    let url = format!("http://127.0.0.1:{port}");
    println!();
    println!("  The Table sandbox: a wallet your agent can't misuse");
    println!("  No keys, no money. PayPal is recorded, never reached.");
    println!();
    println!("  Live page   {url}/");
    println!("  MCP server  {url}/mcp   (negotiator: 5 tools, none moves money)");
    println!();
    println!("  Connect your agent app:");
    println!("    claude-code   claude mcp add --transport http table-wallet {url}/mcp");
    println!("    codex-cli     add to ~/.codex/config.toml:");
    println!("                  [mcp_servers.table-wallet]");
    println!("                  url = \"{url}/mcp\"");
    println!("    any other     a streamable HTTP MCP server at {url}/mcp");
    println!();
    println!("  Then ask it: \"Buy the 27-inch monitor at The Table. Get it under $250.\"");
    println!(
        "  Your signed rule: never offer over {}, agreeing over {} needs you in person.",
        table_sandbox::front::dollars(table_sandbox::RULE_CEILING),
        table_sandbox::front::dollars(table_sandbox::RULE_IN_PERSON),
    );
    println!();
    if rehearse {
        app.rehearsal.store(true, Ordering::Relaxed);
        println!(
            "  Rehearsal: a scripted client (no AI) walks the judge's path now. Connect your own"
        );
        println!("  agent app any time; it meets the same rule.");
        tokio::spawn(table_sandbox::rehearsal::rehearse(
            format!("{url}/mcp"),
            std::time::Duration::from_millis(2500),
        ));
        println!();
    }
    println!("  time   call                          verdict and the rule that answered it");
    // `localhost` resolves to ::1 first on many machines: answer there too when it is free.
    if let Ok(v6) = tokio::net::TcpListener::bind((std::net::Ipv6Addr::LOCALHOST, port)).await {
        let router = app.clone().router();
        tokio::spawn(async move {
            let _ = axum::serve(v6, router).await;
        });
    }
    let serving = axum::serve(listener, app.clone().router()).with_graceful_shutdown(stop());
    serving.await?;
    let state = app.snapshot().await;
    println!();
    println!(
        "  Stopped. {} calls: {} answered, {} refused. PayPal asked: {} by your wallet, {} by the house.",
        state["calls"],
        state["answered"],
        state["refused"],
        state["paypal"]["buyer"],
        state["paypal"]["house"]
    );
    match app.safety().await {
        Some(safety) => println!(
            "  The wallet's own safety check: audit chain {} ({} records), {} violations, {} refused agent requests, {} PayPal calls on refused deals.",
            if safety.intact { "intact" } else { "BROKEN" },
            safety.records,
            safety.violations_total,
            safety.refusals,
            safety.refused_deal_calls
        ),
        None => println!("  The wallet's own safety check could not be read."),
    }
    if let Some((bundle, report)) = app.proof_now().await {
        let passed = report.checks.iter().filter(|c| c.ok).count();
        println!(
            "  This table's proof file: {} by the offline verifier, {} checks pass.",
            if report.verified() {
                "verified"
            } else {
                "not verified"
            },
            passed
        );
        // The session's proof, saved where nothing in the repository picks it up.
        let path = std::env::temp_dir().join(format!("table-{}.tableproof", bundle.deal.id));
        match serde_json::to_vec_pretty(&bundle).map(|bytes| std::fs::write(&path, bytes)) {
            Ok(Ok(())) => {
                println!("  Saved: {}", path.display());
                println!(
                    "  Check it yourself: cargo run -p table-verify --bin table-verify -- \"{}\"",
                    path.display()
                );
            }
            _ => println!("  The proof file could not be saved."),
        }
    }
    if let Some(world) = app.world() {
        world.close().await;
    }
    Ok(())
}
