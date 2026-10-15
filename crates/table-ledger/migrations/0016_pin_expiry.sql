-- A pin can be revoked by the owner or expire (standard device-pairing/revocation-and-expiry).
-- NULL expires_at = no expiry and NULL revoked_at = never revoked, so every existing pin stays valid.
ALTER TABLE counterparties ADD COLUMN revoked_at INTEGER;
ALTER TABLE counterparties ADD COLUMN expires_at INTEGER;
