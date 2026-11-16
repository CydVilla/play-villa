ALTER TABLE games ADD COLUMN game_details TEXT NOT NULL DEFAULT '{}' CHECK (json_type(game_details) = 'object');

CREATE TABLE rawg_detail_limits (
  guild_id TEXT PRIMARY KEY REFERENCES guilds(id),
  next_at INTEGER NOT NULL
);
