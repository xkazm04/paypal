//! Public read routes of the glass-box HOUSE (T9). Each serves the actor's published snapshot (or,
//! for a prefix, asks the actor to sign one); none reads the ledger, writes, or reaches PayPal.
use crate::{Error, HouseHandle, PAGE_MAX};
use axum::{
    Json,
    extract::{Query, State},
    http::{HeaderValue, StatusCode, header},
    response::{IntoResponse, Response},
};
use serde::Deserialize;
use table_core::DealId;

/// Default deals per ledger page.
const PAGE_DEFAULT: usize = 50;
const SCOREBOARD_HTML: &str = include_str!("scoreboard/index.html");
const SCOREBOARD_CSS: &str = include_str!("scoreboard/scoreboard.css");
const SCOREBOARD_JS: &str = include_str!("scoreboard/scoreboard.js");
/// The scoreboard loads only its own stylesheet and script and reads only this origin.
const SCOREBOARD_CSP: &str = "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";

/// Public, credential-free JSON any origin may read; never cached as stale truth.
fn public(mut response: Response) -> Response {
    let headers = response.headers_mut();
    headers.insert(header::CACHE_CONTROL, HeaderValue::from_static("no-store"));
    headers.insert(
        header::ACCESS_CONTROL_ALLOW_ORIGIN,
        HeaderValue::from_static("*"),
    );
    response
}
fn status(error: &Error) -> StatusCode {
    match error {
        Error::Invalid => StatusCode::BAD_REQUEST,
        Error::Full => StatusCode::TOO_MANY_REQUESTS,
        _ => StatusCode::SERVICE_UNAVAILABLE,
    }
}

pub(crate) async fn head(State(house): State<HouseHandle>) -> Response {
    match house.published() {
        Some(p) => public(Json(p.view.head.clone()).into_response()),
        None => StatusCode::SERVICE_UNAVAILABLE.into_response(),
    }
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct PrefixQuery {
    rows: u64,
}
pub(crate) async fn prefix(
    State(house): State<HouseHandle>,
    Query(query): Query<PrefixQuery>,
) -> Response {
    match house.prefix(query.rows).await {
        Ok(prefix) => public(Json(prefix).into_response()),
        Err(e) => status(&e).into_response(),
    }
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct LedgerQuery {
    before: Option<DealId>,
    limit: Option<usize>,
}
pub(crate) async fn ledger(
    State(house): State<HouseHandle>,
    Query(query): Query<LedgerQuery>,
) -> Response {
    match house.published() {
        Some(p) => public(
            Json(p.page(
                query.before,
                query.limit.unwrap_or(PAGE_DEFAULT).min(PAGE_MAX),
            ))
            .into_response(),
        ),
        None => StatusCode::SERVICE_UNAVAILABLE.into_response(),
    }
}

fn asset(body: &'static str, content_type: &'static str) -> Response {
    let mut response = body.into_response();
    let headers = response.headers_mut();
    headers.insert(header::CONTENT_TYPE, HeaderValue::from_static(content_type));
    headers.insert(
        header::CONTENT_SECURITY_POLICY,
        HeaderValue::from_static(SCOREBOARD_CSP),
    );
    headers.insert(
        header::X_CONTENT_TYPE_OPTIONS,
        HeaderValue::from_static("nosniff"),
    );
    headers.insert(
        header::CACHE_CONTROL,
        HeaderValue::from_static("public, max-age=300"),
    );
    response
}
pub(crate) async fn scoreboard() -> Response {
    asset(SCOREBOARD_HTML, "text/html; charset=utf-8")
}
pub(crate) async fn scoreboard_css() -> Response {
    asset(SCOREBOARD_CSS, "text/css; charset=utf-8")
}
pub(crate) async fn scoreboard_js() -> Response {
    asset(SCOREBOARD_JS, "text/javascript; charset=utf-8")
}
