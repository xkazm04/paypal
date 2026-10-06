use crate::Error;
use table_core::{DealId, H256, Timestamp};
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
    pub(crate) expires: Timestamp,
    pub(crate) at: Timestamp,
}
impl ApprovalSession {
    /// Check a re-auth request before invoking the OS. A pending prompt grants no authority.
    pub fn begin_unlock(&self, label: &str, token: &str) -> Result<u64, Error> {
        if label != "approval" || token != self.token {
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
        Ok(Self {
            token: H256(bytes).hex(),
            last_activity: now,
            locked: true,
            generation: 0,
        })
    }
    pub fn token(&self, label: &str) -> Result<&str, Error> {
        if label != "approval" {
            return Err(Error::Permission);
        }
        Ok(&self.token)
    }
    pub fn locked(&mut self, now: Timestamp) -> bool {
        if now < self.last_activity || now.saturating_sub(self.last_activity) >= 900 {
            self.locked = true;
        }
        self.locked
    }
    /// Seconds until the idle lock, or None while locked. Reading it never refreshes activity.
    pub fn lock_in(&mut self, now: Timestamp) -> Option<i64> {
        if self.locked(now) {
            return None;
        }
        Some(900_i64.saturating_sub(now.saturating_sub(self.last_activity)))
    }
    pub fn check(&mut self, label: &str, token: &str, now: Timestamp) -> Result<(), Error> {
        if label != "approval" || token != self.token {
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
        if label != "approval" || token != self.token {
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
            expires: now.saturating_add(60),
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
}
