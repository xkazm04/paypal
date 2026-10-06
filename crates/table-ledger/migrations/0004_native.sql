CREATE TABLE local_preferences (
    key TEXT PRIMARY KEY NOT NULL,
    value_json TEXT NOT NULL CHECK(json_valid(value_json))
);
CREATE TABLE deal_context (
    deal_id TEXT PRIMARY KEY NOT NULL REFERENCES deals(id),
    category_json TEXT NOT NULL CHECK(json_valid(category_json)),
    browser_handoff INTEGER NOT NULL DEFAULT 0 CHECK(browser_handoff IN (0,1))
);
