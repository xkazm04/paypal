use crate::Error;
use subtle::{Choice, ConstantTimeEq};
use table_core::{DealId, H256, Timestamp};
/// How long an owner ticket is valid after it was minted. A spent-ticket entry older than this
/// names a ticket `validate` already refuses, so it may be forgotten.
pub(crate) const TICKET_SECS: i64 = 60;
/// Idle time after which the approval window locks and needs the OS re-auth again. `locked`
/// enforces it and `lock_in` counts down to it, so the two read one number.
pub(crate) const IDLE_LOCK_SECS: i64 = 900;
pub trait NativeReauth {
    fn authenticate(&self) -> Result<(), Error>;
}
#[derive(Debug)]
pub struct ReauthUnavailable;
impl NativeReauth for ReauthUnavailable {
    fn authenticate(&self) -> Result<(), Error> {
        Err(Error::Unavailable)
    }
}
pub struct ApprovalSession {
    token: String,
    last_activity: Timestamp,
    locked: bool,
    generation: u64,
    session_id: [u8; 16],
}
impl std::fmt::Debug for ApprovalSession {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("ApprovalSession")
            .field("locked", &self.locked)
            .finish_non_exhaustive()
    }
}
#[derive(Debug)]
pub struct OwnerTicket {
    pub(crate) attempt: u8,
    pub(crate) deal: DealId,
    pub(crate) hash: H256,
    pub(crate) generation: u64,
    pub(crate) session_id: [u8; 16],
    pub(crate) expires: Timestamp,
    pub(crate) at: Timestamp,
}
impl ApprovalSession {
    /// Constant-time token comparison. Both sides are padded to a fixed width, so neither the
    /// content nor the length of a guess decides how long the comparison runs.
    fn token_matches(&self, presented: &str) -> bool {
        const WIDTH: usize = 128;
        let (mut a, mut b) = ([0u8; WIDTH], [0u8; WIDTH]);
        for (slot, byte) in a.iter_mut().zip(self.token.as_bytes()) {
            *slot = *byte;
        }
        for (slot, byte) in b.iter_mut().zip(presented.as_bytes()) {
            *slot = *byte;
        }
        let same_len = Choice::from(u8::from(
            self.token.len() == presented.len() && presented.len() <= WIDTH,
        ));
        bool::from(a.ct_eq(&b) & same_len)
    }
    /// Check a re-auth request before invoking the OS. A pending prompt grants no authority.
    pub fn begin_unlock(&self, label: &str, token: &str) -> Result<u64, Error> {
        if label != "approval" || !self.token_matches(token) {
            return Err(Error::Permission);
        }
        Ok(self.generation)
    }

    /// Only a trusted Rust OS broker can supply `native`; never expose this as IPC.
    pub fn finish_unlock(
        &mut self,
        label: &str,
        token: &str,
        generation: u64,
        native: &dyn NativeReauth,
        now: Timestamp,
    ) -> Result<(), Error> {
        if generation != self.generation {
            return Err(Error::Permission);
        }
        self.unlock(label, token, native, now)
    }
    pub fn new(now: Timestamp) -> Result<Self, Error> {
        let mut bytes = [0; 32];
        getrandom::fill(&mut bytes).map_err(|_| Error::Unavailable)?;
        let mut session_id = [0; 16];
        getrandom::fill(&mut session_id).map_err(|_| Error::Unavailable)?;
        Ok(Self {
            token: H256(bytes).hex(),
            last_activity: now,
            locked: true,
            generation: 0,
            session_id,
        })
    }
    pub fn token(&self, label: &str) -> Result<&str, Error> {
        if label != "approval" {
            return Err(Error::Permission);
        }
        Ok(&self.token)
    }
    pub fn locked(&mut self, now: Timestamp) -> bool {
        if now < self.last_activity || now.saturating_sub(self.last_activity) >= IDLE_LOCK_SECS {
            self.locked = true;
        }
        self.locked
    }
    /// Seconds until the idle lock, or None while locked. Reading it never refreshes activity.
    pub fn lock_in(&mut self, now: Timestamp) -> Option<i64> {
        if self.locked(now) {
            return None;
        }
        Some(IDLE_LOCK_SECS.saturating_sub(now.saturating_sub(self.last_activity)))
    }
    pub fn check(&mut self, label: &str, token: &str, now: Timestamp) -> Result<(), Error> {
        if label != "approval" || !self.token_matches(token) {
            return Err(Error::Permission);
        }
        if self.locked(now) {
            return Err(Error::Locked);
        }
        self.last_activity = now;
        Ok(())
    }
    pub fn unlock(
        &mut self,
        label: &str,
        token: &str,
        native: &dyn NativeReauth,
        now: Timestamp,
    ) -> Result<(), Error> {
        if label != "approval" || !self.token_matches(token) {
            return Err(Error::Permission);
        }
        native.authenticate()?;
        self.generation = self.generation.checked_add(1).ok_or(Error::Invalid)?;
        self.last_activity = now;
        self.locked = false;
        Ok(())
    }
    pub fn ticket(
        &mut self,
        label: &str,
        token: &str,
        deal: DealId,
        hash: H256,
        attempt: u8,
        now: Timestamp,
    ) -> Result<OwnerTicket, Error> {
        self.check(label, token, now)?;
        if !(1..=3).contains(&attempt) {
            return Err(Error::Invalid);
        }
        Ok(OwnerTicket {
            attempt,
            deal,
            hash,
            generation: self.generation,
            session_id: self.session_id,
            expires: now.saturating_add(TICKET_SECS),
            at: now,
        })
    }
    pub(crate) fn validate(
        &mut self,
        ticket: &OwnerTicket,
        deal: DealId,
        hash: H256,
        attempt: u8,
        now: Timestamp,
    ) -> Result<(), Error> {
        if self.locked(now) {
            return Err(Error::Locked);
        }
        if ticket.attempt != attempt
            || ticket.deal != deal
            || ticket.hash != hash
            || ticket.generation != self.generation
            || ticket.session_id != self.session_id
            || ticket.expires <= now
        {
            return Err(Error::Permission);
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    #![allow(clippy::unwrap_used)]
    use super::*;
    struct Reauth;
    impl NativeReauth for Reauth {
        fn authenticate(&self) -> Result<(), Error> {
            Ok(())
        }
    }
    #[test]
    fn token_comparison_accepts_only_the_exact_token() {
        let session = ApprovalSession::new(100).unwrap();
        let token = session.token("approval").unwrap().to_owned();
        assert!(session.begin_unlock("approval", &token).is_ok());
        assert!(session.begin_unlock("approval", "").is_err());
        assert!(session.begin_unlock("approval", &token[1..]).is_err());
        assert!(
            session
                .begin_unlock("approval", &format!("{token}0"))
                .is_err()
        );
        assert!(
            session
                .begin_unlock("approval", &token.replace(&token[..1], "z"))
                .is_err()
        );
        assert!(
            session
                .begin_unlock("approval", &format!("{token}{}", "0".repeat(400)))
                .is_err()
        );
        assert!(session.begin_unlock("main", &token).is_err());
    }
    #[test]
    fn owner_tickets_bind_terms_deal_attempt_expiry_and_session_generation() {
        let mut session = ApprovalSession::new(100).unwrap();
        let token = session.token("approval").unwrap().to_owned();
        let id: DealId = "01ARZ3NDEKTSV4RRFFQ69G5FAV".parse().unwrap();
        let other: DealId = "01ARZ3NDEKTSV4RRFFQ69G5FAW".parse().unwrap();
        session.unlock("approval", &token, &Reauth, 100).unwrap();
        let ticket = session
            .ticket("approval", &token, id, H256::ZERO, 1, 100)
            .unwrap();
        assert!(session.validate(&ticket, id, H256::ZERO, 1, 159).is_ok());
        assert!(
            session
                .validate(&ticket, other, H256::ZERO, 1, 159)
                .is_err()
        );
        assert!(
            session
                .validate(&ticket, id, H256([1; 32]), 1, 159)
                .is_err()
        );
        assert!(session.validate(&ticket, id, H256::ZERO, 2, 159).is_err());
        assert!(session.validate(&ticket, id, H256::ZERO, 1, 160).is_err());
        session.unlock("approval", &token, &Reauth, 150).unwrap();
        assert!(session.validate(&ticket, id, H256::ZERO, 1, 159).is_err());
    }
    #[test]
    fn the_idle_countdown_reaches_zero_exactly_when_the_window_locks() {
        let mut session = ApprovalSession::new(100).unwrap();
        let token = session.token("approval").unwrap().to_owned();
        session.unlock("approval", &token, &Reauth, 100).unwrap();
        assert_eq!(session.lock_in(100), Some(IDLE_LOCK_SECS));
        let last = 100 + IDLE_LOCK_SECS - 1;
        assert_eq!(session.lock_in(last), Some(1));
        assert!(!session.locked(last));
        assert!(session.locked(100 + IDLE_LOCK_SECS));
        assert_eq!(session.lock_in(100 + IDLE_LOCK_SECS), None);
    }
    #[test]
    fn owner_ticket_from_another_session_is_refused() {
        let mut minting = ApprovalSession::new(100).unwrap();
        let mut other = ApprovalSession::new(100).unwrap();
        let id: DealId = "01ARZ3NDEKTSV4RRFFQ69G5FAV".parse().unwrap();
        for session in [&mut minting, &mut other] {
            let token = session.token("approval").unwrap().to_owned();
            session.unlock("approval", &token, &Reauth, 100).unwrap();
        }
        let token = minting.token("approval").unwrap().to_owned();
        let ticket = minting
            .ticket("approval", &token, id, H256::ZERO, 1, 100)
            .unwrap();
        assert_eq!(minting.generation, other.generation);
        assert!(minting.validate(&ticket, id, H256::ZERO, 1, 120).is_ok());
        assert!(other.validate(&ticket, id, H256::ZERO, 1, 120).is_err());
    }
}
