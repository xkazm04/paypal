use base64::{Engine as _, engine::general_purpose::URL_SAFE_NO_PAD};
use ed25519_dalek::{Signature, Signer, SigningKey, VerifyingKey};
use serde::{Deserialize, Serialize};
use std::{collections::HashSet, fmt};
use table_core::{
    DealId, Delivery, H256, ItemRef, KeyId, MandatePayload, Money, Timestamp, canonical_bytes,
};
use thiserror::Error;

pub const MAX_JWS_BYTES: usize = 16 * 1024;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(try_from = "String", into = "String")]
pub struct ShortText<const N: usize>(String);
/// Invisible characters that reorder or hide text when displayed: bidi embeddings, overrides,
/// isolates and marks, and zero-width spaces. Joiners (U+200C, U+200D) stay, since emoji and
/// several scripts need them.
fn spoofing(c: char) -> bool {
    matches!(
        c,
        '\u{061C}'
            | '\u{200B}'
            | '\u{200E}'
            | '\u{200F}'
            | '\u{202A}'..='\u{202E}'
            | '\u{2060}'
            | '\u{2066}'..='\u{2069}'
            | '\u{FEFF}'
    )
}
impl<const N: usize> ShortText<N> {
    pub fn new(value: String) -> Result<Self, ProtocolError> {
        if value.is_empty()
            || value.chars().count() > N
            || value.chars().any(|c| c.is_control() || spoofing(c))
        {
            return Err(ProtocolError::Body);
        }
        Ok(Self(value))
    }
    pub fn as_str(&self) -> &str {
        &self.0
    }
}
impl<const N: usize> TryFrom<String> for ShortText<N> {
    type Error = ProtocolError;
    fn try_from(v: String) -> Result<Self, Self::Error> {
        Self::new(v)
    }
}
impl<const N: usize> From<ShortText<N>> for String {
    fn from(v: ShortText<N>) -> Self {
        v.0
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum MsgType {
    Hello,
    Listing,
    Offer,
    Counter,
    Accept,
    Settle,
    Approved,
    Receipt,
    Withdraw,
    Note,
}
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum Intent {
    Authorize,
    Capture,
}
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum ReceiptStatus {
    Completed,
    Failed,
}
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum ReasonCode {
    Price,
    Timing,
    Other,
    Deadline,
    Rounds,
    Protocol,
}
/// Owner consent to one exact signed counter. The agent envelope remains the transport
/// identity; this second signature is the owner's authority, checked against the pin.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct OwnerAccept {
    pub deal_id: DealId,
    pub offer_seq: u32,
    pub terms_hash: H256,
    pub counter_hash: H256,
    pub owner_key: [u8; 32],
    pub signature: Vec<u8>,
}
impl OwnerAccept {
    fn signing_bytes(&self) -> Result<Vec<u8>, ProtocolError> {
        Ok(canonical_bytes(&(
            "table.owner.accept.v1",
            self.deal_id,
            self.offer_seq,
            self.terms_hash,
            self.counter_hash,
            self.owner_key,
        ))?)
    }
    pub fn sign(
        deal_id: DealId,
        offer_seq: u32,
        terms_hash: H256,
        counter_hash: H256,
        owner: &SigningKey,
    ) -> Result<Self, ProtocolError> {
        let mut proof = Self {
            deal_id,
            offer_seq,
            terms_hash,
            counter_hash,
            owner_key: owner.verifying_key().to_bytes(),
            signature: Vec::new(),
        };
        proof.signature = owner.sign(&proof.signing_bytes()?).to_bytes().to_vec();
        Ok(proof)
    }
    pub fn verify(&self) -> Result<(), ProtocolError> {
        let key =
            VerifyingKey::from_bytes(&self.owner_key).map_err(|_| ProtocolError::Signature)?;
        let sig = Signature::from_slice(&self.signature).map_err(|_| ProtocolError::Signature)?;
        key.verify_strict(&self.signing_bytes()?, &sig)
            .map_err(|_| ProtocolError::Signature)
    }
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "SCREAMING_SNAKE_CASE", deny_unknown_fields)]
pub enum Body {
    Hello {
        owner_key: [u8; 32],
        agent_key: [u8; 32],
        mandate_commitment: H256,
        owner_sig_over_commitment: Vec<u8>,
        display_name: ShortText<32>,
    },
    Listing {
        item_ref: ItemRef,
        ask: Money,
        delivery: Delivery,
    },
    Offer {
        price: Money,
        delivery: Delivery,
    },
    Counter {
        price: Money,
        delivery: Delivery,
    },
    Accept {
        offer_seq: u32,
        terms_hash: H256,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        owner_accept: Option<OwnerAccept>,
    },
    Settle {
        order_id: ShortText<128>,
        approve_url: ShortText<2048>,
        amount: Money,
        invoice_id: ShortText<128>,
        intent: Intent,
        attempt: u8,
    },
    Approved {
        order_id: ShortText<128>,
    },
    Receipt {
        capture_id: ShortText<128>,
        amount: Money,
        status: ReceiptStatus,
        transcript_head: H256,
    },
    Withdraw {
        reason: ReasonCode,
    },
    /// Human-only quarantined content. Agent projections must not serialize this variant.
    Note {
        text: ShortText<280>,
    },
}
impl Body {
    pub const fn typ(&self) -> MsgType {
        match self {
            Self::Hello { .. } => MsgType::Hello,
            Self::Listing { .. } => MsgType::Listing,
            Self::Offer { .. } => MsgType::Offer,
            Self::Counter { .. } => MsgType::Counter,
            Self::Accept { .. } => MsgType::Accept,
            Self::Settle { .. } => MsgType::Settle,
            Self::Approved { .. } => MsgType::Approved,
            Self::Receipt { .. } => MsgType::Receipt,
            Self::Withdraw { .. } => MsgType::Withdraw,
            Self::Note { .. } => MsgType::Note,
        }
    }
    fn validate(&self, sender: &VerifyingKey) -> Result<(), ProtocolError> {
        match self {
            Self::Hello {
                owner_key,
                agent_key,
                mandate_commitment,
                owner_sig_over_commitment,
                ..
            } => {
                if *agent_key != sender.to_bytes() {
                    return Err(ProtocolError::Body);
                }
                let owner =
                    VerifyingKey::from_bytes(owner_key).map_err(|_| ProtocolError::Signature)?;
                let sig = Signature::from_slice(owner_sig_over_commitment)
                    .map_err(|_| ProtocolError::Signature)?;
                owner
                    .verify_strict(&mandate_commitment.0, &sig)
                    .map_err(|_| ProtocolError::Signature)?;
            }
            Self::Listing { delivery, .. }
            | Self::Offer { delivery, .. }
            | Self::Counter { delivery, .. } => {
                delivery.validate().map_err(|_| ProtocolError::Body)?
            }
            Self::Accept { offer_seq, .. } if *offer_seq == 0 => return Err(ProtocolError::Body),
            Self::Settle { attempt, .. } if !(1..=3).contains(attempt) => {
                return Err(ProtocolError::Body);
            }
            _ => {}
        }
        Ok(())
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Envelope {
    pub v: u8,
    pub typ: MsgType,
    pub deal_id: DealId,
    pub seq: u32,
    pub prev: H256,
    pub iss: KeyId,
    pub aud: KeyId,
    pub iat: Timestamp,
    pub exp: Timestamp,
    pub nonce: [u8; 16],
    pub body: Body,
}
#[derive(Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct Header {
    alg: String,
    kid: KeyId,
}

#[derive(Debug, Error)]
pub enum ProtocolError {
    #[error("invalid compact JWS shape, size or encoding")]
    Shape,
    #[error("unknown/noncanonical JSON or invalid envelope schema")]
    Schema,
    #[error("bad signature or signing key")]
    Signature,
    #[error("unexpected sender, audience or deal")]
    Binding,
    #[error("expired, future-dated or invalid lifetime")]
    Time,
    #[error("nonce reused")]
    Nonce,
    #[error("sequence gap or exhausted sequence")]
    Sequence,
    #[error("transcript head mismatch")]
    Previous,
    #[error("invalid message body")]
    Body,
    #[error("nonce store unavailable")]
    NonceStore,
    #[error(transparent)]
    Json(#[from] serde_json::Error),
}

/// Never serializable; Debug deliberately omits the private key.
pub struct AgentSigner(SigningKey);
impl fmt::Debug for AgentSigner {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("AgentSigner")
            .field("public_key", &self.public_key())
            .finish()
    }
}
impl AgentSigner {
    pub fn sign_closed(
        &self,
        mandate: &table_core::ClosedMandate,
    ) -> Result<Vec<u8>, ProtocolError> {
        Ok(self.0.sign(&mandate.signing_bytes()?).to_bytes().to_vec())
    }
    /// The caller obtains key material from the OS keychain, never from a file/webview.
    pub fn from_key(key: SigningKey) -> Self {
        Self(key)
    }
    pub fn public_key(&self) -> VerifyingKey {
        self.0.verifying_key()
    }
    pub fn key_id(&self) -> Result<KeyId, ProtocolError> {
        key_id(&self.public_key())
    }
    pub fn sign_commitment(&self, hash: H256) -> Vec<u8> {
        self.0.sign(&hash.0).to_bytes().to_vec()
    }
    pub fn sign_payload(&self, payload: &MandatePayload) -> Result<Vec<u8>, ProtocolError> {
        Ok(self.0.sign(&canonical_bytes(payload)?).to_bytes().to_vec())
    }
    pub fn sign(&self, envelope: &Envelope) -> Result<String, ProtocolError> {
        if envelope.iss != self.key_id()? || envelope.v != 1 || envelope.typ != envelope.body.typ()
        {
            return Err(ProtocolError::Binding);
        }
        envelope.body.validate(&self.public_key())?;
        let header = Header {
            alg: "EdDSA".into(),
            kid: envelope.iss.clone(),
        };
        let protected = URL_SAFE_NO_PAD.encode(canonical_bytes(&header)?);
        let payload = URL_SAFE_NO_PAD.encode(canonical_bytes(envelope)?);
        let input = format!("{protected}.{payload}");
        let sig = URL_SAFE_NO_PAD.encode(self.0.sign(input.as_bytes()).to_bytes());
        let raw = format!("{input}.{sig}");
        if raw.len() > MAX_JWS_BYTES {
            return Err(ProtocolError::Shape);
        }
        Ok(raw)
    }
}
pub fn key_id(key: &VerifyingKey) -> Result<KeyId, ProtocolError> {
    KeyId::new(H256::digest(&key.to_bytes()).hex()).map_err(|_| ProtocolError::Binding)
}
pub fn verify_mandate_signature(
    payload: &MandatePayload,
    signature: &[u8],
    owner: &VerifyingKey,
) -> Result<(), ProtocolError> {
    payload.validate().map_err(|_| ProtocolError::Body)?;
    let sig = Signature::from_slice(signature).map_err(|_| ProtocolError::Signature)?;
    owner
        .verify_strict(&canonical_bytes(payload)?, &sig)
        .map_err(|_| ProtocolError::Signature)
}

pub trait NonceLookup {
    fn contains(&self, key: &KeyId, nonce: &[u8; 16]) -> Result<bool, ProtocolError>;
}
#[derive(Debug, Default)]
pub struct MemoryNonces(HashSet<(KeyId, [u8; 16])>);
impl MemoryNonces {
    pub fn record(&mut self, key: KeyId, nonce: [u8; 16]) {
        self.0.insert((key, nonce));
    }
}
impl NonceLookup for MemoryNonces {
    fn contains(&self, key: &KeyId, nonce: &[u8; 16]) -> Result<bool, ProtocolError> {
        Ok(self.0.contains(&(key.clone(), *nonce)))
    }
}

pub struct VerifyContext<'a> {
    pub deal_id: DealId,
    pub audience: &'a KeyId,
    pub next_sender_seq: u32,
    pub previous: H256,
    pub now: Timestamp,
    pub nonces: &'a dyn NonceLookup,
}
impl fmt::Debug for VerifyContext<'_> {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("VerifyContext")
            .field("deal_id", &self.deal_id)
            .finish_non_exhaustive()
    }
}

#[derive(Debug, Clone)]
pub struct VerifiedEnvelope {
    envelope: Envelope,
    raw: String,
    hash: H256,
}
impl VerifiedEnvelope {
    pub fn envelope(&self) -> &Envelope {
        &self.envelope
    }
    pub fn raw(&self) -> &str {
        &self.raw
    }
    pub const fn hash(&self) -> H256 {
        self.hash
    }
}

/// Pure validation: never advances sequence, consumes a nonce or mutates a deal.
pub fn verify(
    raw: &str,
    sender: &VerifyingKey,
    context: &VerifyContext<'_>,
) -> Result<VerifiedEnvelope, ProtocolError> {
    if raw.is_empty() || raw.len() > MAX_JWS_BYTES || !raw.is_ascii() {
        return Err(ProtocolError::Shape);
    }
    let parts: Vec<_> = raw.split('.').collect();
    if parts.len() != 3 || parts.iter().any(|p| p.is_empty()) {
        return Err(ProtocolError::Shape);
    }
    let protected = URL_SAFE_NO_PAD
        .decode(parts[0])
        .map_err(|_| ProtocolError::Shape)?;
    let payload = URL_SAFE_NO_PAD
        .decode(parts[1])
        .map_err(|_| ProtocolError::Shape)?;
    let signature = URL_SAFE_NO_PAD
        .decode(parts[2])
        .map_err(|_| ProtocolError::Shape)?;
    let header: Header = serde_json::from_slice(&protected).map_err(|_| ProtocolError::Schema)?;
    let envelope: Envelope = serde_json::from_slice(&payload).map_err(|_| ProtocolError::Schema)?;
    if protected != canonical_bytes(&header)? || payload != canonical_bytes(&envelope)? {
        return Err(ProtocolError::Schema);
    }
    if header.alg != "EdDSA" {
        return Err(ProtocolError::Signature);
    }
    let sig = Signature::from_slice(&signature).map_err(|_| ProtocolError::Signature)?;
    let input = format!("{}.{}", parts[0], parts[1]);
    sender
        .verify_strict(input.as_bytes(), &sig)
        .map_err(|_| ProtocolError::Signature)?;
    if envelope.v != 1
        || header.kid != envelope.iss
        || envelope.iss != key_id(sender)?
        || &envelope.aud != context.audience
        || envelope.deal_id != context.deal_id
    {
        return Err(ProtocolError::Binding);
    }
    if envelope.typ != envelope.body.typ() {
        return Err(ProtocolError::Body);
    }
    let ttl = envelope
        .exp
        .checked_sub(envelope.iat)
        .ok_or(ProtocolError::Time)?;
    let max_ttl = if matches!(envelope.typ, MsgType::Offer | MsgType::Counter) {
        600
    } else {
        86400
    };
    if envelope.iat < 0
        || envelope.exp > table_core::MAX_SAFE_INTEGER
        || envelope.iat > context.now
        || envelope.exp <= context.now
        || ttl <= 0
        || ttl > max_ttl
    {
        return Err(ProtocolError::Time);
    }
    if envelope.seq == 0 || envelope.seq != context.next_sender_seq {
        return Err(ProtocolError::Sequence);
    }
    if envelope.prev != context.previous {
        return Err(ProtocolError::Previous);
    }
    if context.nonces.contains(&envelope.iss, &envelope.nonce)? {
        return Err(ProtocolError::Nonce);
    }
    envelope.body.validate(sender)?;
    if let Body::Accept {
        offer_seq,
        terms_hash,
        owner_accept: Some(proof),
    } = &envelope.body
    {
        if proof.deal_id != envelope.deal_id
            || proof.offer_seq != *offer_seq
            || proof.terms_hash != *terms_hash
        {
            return Err(ProtocolError::Binding);
        }
        proof.verify()?;
    }
    Ok(VerifiedEnvelope {
        envelope,
        raw: raw.into(),
        hash: H256::digest(raw.as_bytes()),
    })
}

/// Deliberately narrow agent history; NOTE/HELLO/SETTLE and all free text are absent.
#[derive(Debug, Clone, Serialize)]
pub struct AgentOffer {
    pub seq: u32,
    pub issuer: KeyId,
    pub price: Money,
    pub delivery: Delivery,
}
pub fn agent_offer(envelope: &VerifiedEnvelope) -> Option<AgentOffer> {
    let e = envelope.envelope();
    match &e.body {
        Body::Offer { price, delivery } | Body::Counter { price, delivery } => Some(AgentOffer {
            seq: e.seq,
            issuer: e.iss.clone(),
            price: *price,
            delivery: delivery.clone(),
        }),
        _ => None,
    }
}
