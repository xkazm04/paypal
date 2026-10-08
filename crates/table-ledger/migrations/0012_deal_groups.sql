-- 0012 (user_version 12). Shop around (theme T8): one buyer intent as a group of tables with
-- different paired sellers, same item, same signed mandate. At most one table of a group ever
-- agrees: `winner` is claimed in the same transaction that records the agreeing ACCEPT, and the
-- trigger below refuses any grouped deal reaching AGREED unless it is the group's winner. Every
-- other table is then withdrawn with a signed WITHDRAW (no money moves).
CREATE TABLE deal_groups (
  id TEXT PRIMARY KEY NOT NULL,
  mandate_id TEXT NOT NULL,
  item_ref TEXT NOT NULL,
  opened_at INTEGER NOT NULL,
  winner TEXT REFERENCES deals(id)
);
CREATE TRIGGER deal_groups_no_delete BEFORE DELETE ON deal_groups
BEGIN SELECT RAISE(ABORT,'deal groups are kept'); END;
-- A group is won once, by one of its own tables; nothing else about it ever changes.
CREATE TRIGGER deal_groups_won_once BEFORE UPDATE ON deal_groups
WHEN OLD.winner IS NOT NULL OR NEW.winner IS NULL OR NEW.id IS NOT OLD.id
  OR NEW.mandate_id IS NOT OLD.mandate_id OR NEW.item_ref IS NOT OLD.item_ref
  OR NEW.opened_at IS NOT OLD.opened_at
  OR NOT EXISTS (SELECT 1 FROM deals WHERE id = NEW.winner AND group_id = NEW.id)
BEGIN SELECT RAISE(ABORT,'a deal group is won once, by one of its tables'); END;
ALTER TABLE deals ADD COLUMN group_id TEXT;
CREATE INDEX deals_group ON deals(group_id) WHERE group_id IS NOT NULL;
-- A deal joins at most one group, once, and never leaves it.
CREATE TRIGGER deals_group_once BEFORE UPDATE OF group_id ON deals
WHEN OLD.group_id IS NOT NULL OR NEW.group_id IS NULL
  OR NOT EXISTS (SELECT 1 FROM deal_groups WHERE id = NEW.group_id)
BEGIN SELECT RAISE(ABORT,'a deal joins one group, once'); END;
-- The at-most-one-agreement rule, below every Rust path: a grouped deal reaches AGREED only as
-- its group's winner.
CREATE TRIGGER deals_group_agrees_once BEFORE UPDATE OF state ON deals
WHEN NEW.group_id IS NOT NULL AND NEW.state = 'AGREED' AND OLD.state IS NOT 'AGREED'
  AND NOT EXISTS (SELECT 1 FROM deal_groups WHERE id = NEW.group_id AND winner = NEW.id)
BEGIN SELECT RAISE(ABORT,'another table in this group already agreed'); END;
