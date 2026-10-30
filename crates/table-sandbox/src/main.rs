//! `cargo run -p table-sandbox`: boots the sandbox, prints where to connect, and prints each call
//! the connected agent makes until ctrl-c. `--port <n>` moves the front (default 1443).
use std::sync::atomic::Ordering;

const DEFAULT_PORT: u16 = 1443;

fn port() -> Result<u16, String> {
    let mut args = std::env::args().skip(1);
    let mut port = DEFAULT_PORT;
    while let Some(arg) = args.next() {
        match arg.as_str() {
            "--port" => {
                port = args
                    .next()
                    .and_then(|p| p.parse().ok())
                    .filter(|p| *p != 0)
                    .ok_or("--port needs a port number")?;
            }
            "--help" | "-h" => {
                println!("table-sandbox [--port <n>]  (default {DEFAULT_PORT})");
                std::process::exit(0);
            }
            other => return Err(format!("unknown argument: {other}")),
        }
    }
    Ok(port)
}

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let port = port()?;
    let listener = tokio::net::TcpListener::bind((std::net::Ipv4Addr::LOCALHOST, port))
        .await
        .map_err(|_| format!("port {port} is taken; pass --port <n>"))?;
    let sandbox = table_sandbox::boot(port).await?;
    let app = sandbox.app.clone();
    app.echo.store(true, Ordering::Relaxed);
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
    println!("  time   call                          verdict and the rule that answered it");
    let serving = axum::serve(listener, app.clone().router()).with_graceful_shutdown(async {
        let _ = tokio::signal::ctrl_c().await;
    });
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
    if let Some(world) = app.world() {
        world.close().await;
    }
    Ok(())
}
