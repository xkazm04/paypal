-- When a route last changed generation (a relay reset); 0 until the first adoption.
ALTER TABLE relay_routes ADD COLUMN generation_at INTEGER NOT NULL DEFAULT 0;
