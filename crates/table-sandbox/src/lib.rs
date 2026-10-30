//! table-sandbox: hand your own agent a wallet it can't misuse.
//!
//! Boots the real wallet actor the way the desktop shell does (`apps/desktop/src-tauri/src/native.rs`)
//! and serves its loopback MCP server, with every edge that could reach money or a secret swapped
//! for something in memory:
//!
//! - an in-memory SQLite ledger and an in-memory vault (no keychain, no file);
//! - PayPal clients whose transport records and refuses (nothing leaves the process);
//! - the house seller (`services/house-seller`) in process, behind its own deployed router, as the
//!   counterparty, reached through the wallet's real relay pump;
//! - an owner rule signed at boot by a throwaway owner key, and no owner present: anything that
//!   needs the owner in person cannot happen here.
//!
//! The outside agent has its own engine slot ([`engine::OutsideAgent`], `EngineId::Outside`, which
//! no window can select). The front ([`front`]) carries its MCP calls to the wallet's own loopback
//! server under the run's grant, and journals each call with the rule that answered it.
pub mod engine;
pub mod front;
pub mod journal;
pub mod market;
pub mod paypal;
pub mod rehearsal;
pub mod relay;

use ed25519_dalek::{Signer, SigningKey};
use std::sync::Arc;
use table_core::*;
use table_proto::AgentSigner;
use table_runtime::vault::{MemoryVault, Vault, VaultCredentials};

/// The demo item: a release-owned id, never a title.
pub const ITEM: &str = "monitor-27";
/// Who the house is paid as, in its release and in the buyer's payee rule.
pub const HOUSE_PAYEE: &str = "house-seller";
/// The house's opening ask and the lowest it will go, in cents, over six rounds.
pub const HOUSE_ASK: i64 = 32_900;
pub const HOUSE_FLOOR: i64 = 23_900;
pub const HOUSE_ROUNDS: u8 = 6;
/// How long each table stays open: long enough for a deliberate agent app to haggle six rounds
/// (the hosted house gives a buyer five minutes).
pub const TABLE_SECS: i64 = 15 * 60;
/// The owner's signed rule for the buyer's agent, in cents. Rule 4's band must hold the house's
/// opening listing for its table to be joined at all, so the band is the outer fence: no offer
/// above its ceiling is ever signed, in at most six offers (a buyer's floor is only where the
/// owner wants the agent to start). Rule 6 is the
/// inner one: the agent may agree alone only up to the in-person line, which sits under the
/// house's floor, so any agreement here waits for the owner and no payment can start.
pub const RULE_FLOOR: i64 = 10_000;
pub const RULE_CEILING: i64 = 34_000;
pub const RULE_IN_PERSON: i64 = 20_000;
pub const RULE_ROUNDS: u8 = 6;
/// Rule 3: the most any one deal may be.
pub const RULE_PER_DEAL: i64 = 40_000;

#[derive(Debug)]
pub enum BootError {
    /// A step of the assembly failed; the text names the step, never a secret.
    Step(&'static str),
    /// A wallet step refused, with the wallet's own fixed message.
    Wallet(&'static str, String),
}
impl std::fmt::Display for BootError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Step(step) => write!(f, "sandbox boot failed at: {step}"),
            Self::Wallet(step, message) => write!(f, "sandbox boot failed at: {step}: {message}"),
        }
    }
}
impl std::error::Error for BootError {}
fn step<T, E>(result: Result<T, E>, name: &'static str) -> Result<T, BootError> {
    result.map_err(|_| BootError::Step(name))
}

fn wallet<T>(
    result: Result<T, table_client::CommandError>,
    name: &'static str,
) -> Result<T, BootError> {
    result.map_err(|e| BootError::Wallet(name, e.message))
}

fn money(cents: i64) -> Result<Money, BootError> {
    step(Money::new(cents, Currency::USD), "money")
}
fn random_hex() -> Result<String, BootError> {
    let mut bytes = [0; 32];
    step(getrandom::fill(&mut bytes), "random")?;
    Ok(H256(bytes).hex())
}
fn random_key() -> Result<SigningKey, BootError> {
    let mut seed = [0; 32];
    step(getrandom::fill(&mut seed), "random")?;
    Ok(SigningKey::from_bytes(&seed))
}
/// A throwaway sandbox credential pair, minted per boot: never valid at PayPal, and only ever
/// read by a client whose transport records instead of sending.
fn throwaway_credentials(vault: &dyn Vault) -> Result<(), BootError> {
    let pair = (random_hex()?, random_hex()?);
    let bytes = step(serde_json::to_vec(&pair), "credentials")?;
    step(vault.write("paypal.sandbox", &bytes), "credentials")
}

/// The house's signed rule: sell one monitor, from its ask down to its floor over six rounds.
fn house_clauses(now: Timestamp) -> Result<Vec<Clause>, BootError> {
    Ok(vec![
        Clause::Roles {
            roles: vec![Role::Sell],
        },
        Clause::Counterparties {
            rule: CpRule::Paired,
        },
        Clause::PerDeal {
            kind: DealKind::Haggle,
            max_amount: money(HOUSE_ASK)?,
            categories: vec![Category::Office],
        },
        Clause::Band {
            item_refs: vec![step(ItemRef::new(ITEM), "item")?],
            floor: Some(money(HOUSE_FLOOR)?),
            ceiling: Some(money(HOUSE_ASK)?),
            max_rounds: HOUSE_ROUNDS,
            deadline: now.saturating_add(30 * 86_400),
        },
        Clause::Velocity {
            max_deals_day: 1000,
            max_total_day: money(100_000_000)?,
        },
        Clause::HumanPresentOver {
            amount: money(HOUSE_ASK.saturating_add(1))?,
        },
        Clause::Payees {
            payees: vec![step(PayeeRef::new(HOUSE_PAYEE), "payee")?],
        },
    ])
}
/// The owner's signed rule for their buyer agent.
pub fn owner_clauses(now: Timestamp) -> Result<Vec<Clause>, BootError> {
    Ok(vec![
        Clause::Roles {
            roles: vec![Role::Buy],
        },
        Clause::Counterparties {
            rule: CpRule::Paired,
        },
        Clause::PerDeal {
            kind: DealKind::Haggle,
            max_amount: money(RULE_PER_DEAL)?,
            categories: vec![Category::Office],
        },
        Clause::Band {
            item_refs: vec![step(ItemRef::new(ITEM), "item")?],
            floor: Some(money(RULE_FLOOR)?),
            ceiling: Some(money(RULE_CEILING)?),
            max_rounds: RULE_ROUNDS,
            deadline: now.saturating_add(86_400),
        },
        Clause::Velocity {
            max_deals_day: 5,
            max_total_day: money(RULE_PER_DEAL)?,
        },
        Clause::HumanPresentOver {
            amount: money(RULE_IN_PERSON)?,
        },
        Clause::Payees {
            payees: vec![step(PayeeRef::new(HOUSE_PAYEE), "payee")?],
        },
        // Rule 9: the wallet may keep the monitor's market price fresh (sample prices here). It
        // reads prices only; it grants no money authority.
        Clause::MarketWatch {
            items: vec![WatchedItem {
                item_ref: step(ItemRef::new(ITEM), "item")?,
                product_id: market::PRODUCT.into(),
            }],
            max_refreshes_day: 50,
        },
    ])
}

/// No owner is present in the sandbox: every in-person check fails, so nothing that needs the
/// owner (signing, releasing money, confirming) can happen after boot.
#[derive(Debug)]
struct NoOwnerPresent;
#[async_trait::async_trait]
impl table_runtime::reauth::OsReauth for NoOwnerPresent {
    fn supported(&self) -> bool {
        false
    }
    async fn authenticate(&self, _: isize) -> Result<(), table_client::CommandError> {
        Err(table_client::CommandError {
            code: table_client::ErrorCode::Permission,
            message: "No owner is present in the sandbox".into(),
        })
    }
}
/// The house writes operator lines; the sandbox keeps the judge's terminal for the agent's calls.
#[derive(Debug)]
struct Quiet;
impl house_seller::Log for Quiet {
    fn line(&self, _: &str) {}
}

/// What each wallet's PayPal client tried to send, across every table this sandbox opened.
#[derive(Debug, Clone, Default)]
pub struct Recorders {
    pub buyer: Arc<paypal::Recorder>,
    pub house: Arc<paypal::Recorder>,
}

/// One table's world: a fresh house seller and a fresh buyer wallet, paired, the owner's rule
/// signed, the house's table joined, the outside agent's slot seated and the wallet's loopback
/// MCP server serving. `number` counts the tables this sandbox opened.
pub struct World {
    pub number: u32,
    pub actor: table_runtime::ActorHandle,
    pub slot: Arc<engine::Slot>,
    pub deal_id: DealId,
    deal: Arc<std::sync::Mutex<Deal>>,
    house: tokio::sync::Mutex<Option<house_seller::House>>,
    listener: tokio::task::JoinHandle<()>,
}
impl std::fmt::Debug for World {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("World")
            .field("number", &self.number)
            .field("deal", &self.deal_id)
            .finish_non_exhaustive()
    }
}
impl Drop for World {
    fn drop(&mut self) {
        self.listener.abort();
    }
}
impl World {
    /// The deal as the wallet last published it.
    pub fn deal(&self) -> Option<Deal> {
        self.deal.lock().ok().map(|d| d.clone())
    }
    /// The deal as the house seller's own ledger holds it (trusted Rust inspection, never served
    /// whole: the page reads only its state).
    pub async fn house_deal(&self) -> Option<Deal> {
        let house = self.house.lock().await;
        house.as_ref()?.handle.snapshot(self.deal_id).await.ok()
    }
    /// Ends the live run and stops the house (its tick in flight finishes first).
    pub async fn close(&self) {
        if let Some(live) = self.slot.live() {
            self.slot.end(live.run);
        }
        if let Some(house) = self.house.lock().await.take() {
            house.drain().await;
        }
    }
    pub async fn open(number: u32, recorders: &Recorders) -> Result<Self, BootError> {
        let clock: Arc<dyn Clock> = Arc::new(table_runtime::SystemClock);
        let now = clock.now();

        // The house: its own keys, its signed rule and the release that pins both.
        let house_owner = random_key()?;
        let house_agent = random_key()?;
        let payload = MandatePayload {
            id: MandateId(ulid::Ulid::new()),
            version: 1,
            agent_key: house_agent.verifying_key().to_bytes(),
            clauses: house_clauses(now)?,
            not_before: now.saturating_sub(60),
            expires: now.saturating_add(30 * 86_400),
        };
        step(payload.validate(), "house rule")?;
        let mandate = OpenMandate {
            owner_sig: step(
                AgentSigner::from_key(house_owner.clone()).sign_payload(&payload),
                "house rule signature",
            )?,
            payload,
        };
        let commitment = step(mandate.payload.hash(), "house rule hash")?;
        let release = table_proto::HouseRelease {
            owner_key: house_owner.verifying_key().to_bytes(),
            agent_key: house_agent.verifying_key().to_bytes(),
            payee: step(PayeeRef::new(HOUSE_PAYEE), "payee")?,
            mandate_commitment: commitment,
            owner_signature: house_owner.sign(&commitment.0).to_bytes().to_vec(),
        };
        let house_vault = Arc::new(MemoryVault::default());
        throwaway_credentials(house_vault.as_ref())?;
        let store = Arc::new(rendezvous::MemoryStore::new(clock.clone()));
        let seller = step(
            house_seller::Seller::new(house_seller::SellerParts {
                ledger: step(table_ledger::Ledger::in_memory(), "house ledger")?,
                owner: house_owner,
                agent: house_agent,
                release: release.clone(),
                mandate,
                api: Arc::new(table_paypal::Client::sandbox(
                    Arc::new(paypal::Recording(recorders.house.clone())),
                    Arc::new(VaultCredentials(house_vault)),
                    clock.clone(),
                    Arc::new(paypal::NoDelay),
                )),
                clock: clock.clone(),
                relay: store.clone(),
            }),
            "house seller",
        )?
        .with_log(Arc::new(Quiet))
        .with_table_secs(TABLE_SECS);
        let house = house_seller::start(seller);
        let house_routes = house_seller::router(store, house.handle.clone());

        // The buyer: the desktop's assembly with in-memory edges.
        let vault = Arc::new(MemoryVault::default());
        throwaway_credentials(vault.as_ref())?;
        // The market watch runs only while a market key is stored; the sample market never reads
        // this throwaway one.
        step(
            vault.write("channel3", random_hex()?.as_bytes()),
            "market key",
        )?;
        let api = Arc::new(table_paypal::Client::sandbox(
            Arc::new(paypal::Recording(recorders.buyer.clone())),
            Arc::new(VaultCredentials(vault.clone())),
            clock.clone(),
            Arc::new(paypal::NoDelay),
        ));
        let mut runtime = step(
            table_runtime::Runtime::new(
                step(table_ledger::Ledger::in_memory(), "wallet ledger")?,
                vault,
                Arc::new(NoOwnerPresent),
                api.clone(),
                clock.clone(),
            ),
            "wallet",
        )?
        .with_secondary(api)
        .with_relay(Arc::new(relay::InProcessRelay(house_routes)));
        runtime.attach_market(Arc::new(market::SampleMarket(clock.clone())));
        runtime.sandbox_pin_house(release);
        let request = wallet(
            runtime.sandbox_house_request(step(PayeeRef::new("sandbox-buyer"), "payee")?),
            "house request",
        )?;
        let response = step(house.handle.table(request).await, "house table")?;
        let deal = wallet(
            runtime.sandbox_join_house_table(
                response,
                owner_clauses(now)?,
                now.saturating_add(86_400),
            ),
            "join the house table",
        )?;
        let slot = Arc::new(engine::Slot::default());
        runtime.sandbox_engine(
            Arc::new(engine::OutsideAgent(slot.clone())),
            engine::OutsideAgent::info(),
        );
        let (actor, mut events) = wallet(
            table_runtime::spawn_networked(runtime).await,
            "wallet MCP server",
        )?;
        let deal_id = deal.id;
        let held = Arc::new(std::sync::Mutex::new(deal));
        let published = held.clone();
        let listener = tokio::spawn(async move {
            use tokio::sync::broadcast::error::RecvError;
            loop {
                match events.recv().await {
                    Ok(table_runtime::WalletEvent::Deal(changed)) if changed.deal.id == deal_id => {
                        if let Ok(mut deal) = published.lock() {
                            *deal = changed.deal;
                        }
                    }
                    Ok(_) | Err(RecvError::Lagged(_)) => {}
                    Err(RecvError::Closed) => break,
                }
            }
        });
        Ok(Self {
            number,
            actor,
            slot,
            deal_id,
            deal: held,
            house: tokio::sync::Mutex::new(Some(house)),
            listener,
        })
    }
}

/// A booted sandbox: the front's state, holding the live world.
#[derive(Debug)]
pub struct Sandbox {
    pub app: Arc<front::App>,
}

/// Assembles everything; `port` is where the front will be served (its Host allowlist).
pub async fn boot(port: u16) -> Result<Sandbox, BootError> {
    let recorders = Recorders::default();
    let world = World::open(1, &recorders).await?;
    let app = front::App::new(world, recorders, port).map_err(|_| BootError::Step("front"))?;
    Ok(Sandbox { app })
}
