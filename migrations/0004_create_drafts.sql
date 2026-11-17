CREATE TABLE create_drafts (
  id TEXT PRIMARY KEY,
  guild_id TEXT NOT NULL REFERENCES guilds(id),
  channel_id TEXT NOT NULL,
  organizer_id TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  payload TEXT NOT NULL CHECK (json_type(payload) = 'object')
);

CREATE INDEX create_drafts_expiry ON create_drafts(expires_at);
