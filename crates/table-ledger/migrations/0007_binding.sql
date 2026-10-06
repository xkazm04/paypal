-- Identifier-only binding facts per PayPal call (custom_id = terms hash, invoice_id, payee
-- merchant id, amount), kept apart from body_redacted so a stored order can re-prove the
-- Order::verify bindings later. Never names, emails, addresses or links. NULL for older rows.
ALTER TABLE paypal_calls ADD COLUMN binding_json TEXT;
