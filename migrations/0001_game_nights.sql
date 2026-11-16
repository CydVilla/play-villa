CREATE TABLE guilds (
  id TEXT PRIMARY KEY,
  channel_id TEXT NOT NULL,
  timezone TEXT NOT NULL DEFAULT 'UTC',
  voice_id TEXT,
  organizer_role TEXT,
  minimum INTEGER NOT NULL DEFAULT 2 CHECK (minimum BETWEEN 1 AND 25),
  reminder INTEGER NOT NULL DEFAULT 60 CHECK (reminder BETWEEN 0 AND 10080),
  duration INTEGER NOT NULL DEFAULT 120 CHECK (duration BETWEEN 15 AND 480),
  weekly TEXT CHECK (weekly IS NULL OR json_valid(weekly)),
  weekly_version TEXT,
  next_open_at INTEGER,
  CHECK ((weekly IS NULL) = (next_open_at IS NULL))
);
CREATE INDEX guilds_next_weekly ON guilds(next_open_at) WHERE next_open_at IS NOT NULL;

CREATE TABLE sessions (
  id TEXT PRIMARY KEY,
  guild_id TEXT NOT NULL REFERENCES guilds(id),
  channel_id TEXT NOT NULL,
  voice_id TEXT,
  organizer_id TEXT,
  week_key TEXT,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  timezone TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','closed','confirmed','cancelled')),
  created_at INTEGER NOT NULL,
  deadline INTEGER NOT NULL,
  duration INTEGER NOT NULL CHECK (duration BETWEEN 15 AND 480),
  reminder INTEGER NOT NULL CHECK (reminder BETWEEN 0 AND 10080),
  minimum INTEGER NOT NULL CHECK (minimum BETWEEN 1 AND 25),
  capacity INTEGER CHECK (capacity BETWEEN 1 AND 99),
  auto_confirm INTEGER NOT NULL DEFAULT 0 CHECK (auto_confirm IN (0,1)),
  game_id INTEGER,
  starts_at INTEGER,
  decided_at INTEGER,
  UNIQUE (guild_id, week_key),
  FOREIGN KEY (id, game_id) REFERENCES games(session_id, id),
  FOREIGN KEY (id, starts_at) REFERENCES slots(session_id, starts_at),
  CHECK (status <> 'confirmed' OR (game_id IS NOT NULL AND starts_at IS NOT NULL))
);
CREATE INDEX sessions_guild ON sessions(guild_id, created_at DESC);
CREATE INDEX sessions_deadline ON sessions(deadline) WHERE status = 'open';

CREATE TABLE games (
  id INTEGER PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES sessions(id),
  name TEXT NOT NULL,
  name_key TEXT NOT NULL,
  rawg_id INTEGER,
  image TEXT,
  UNIQUE (session_id, id),
  UNIQUE (session_id, name_key),
  UNIQUE (session_id, rawg_id)
);

CREATE TABLE slots (
  session_id TEXT NOT NULL REFERENCES sessions(id),
  starts_at INTEGER NOT NULL,
  PRIMARY KEY (session_id, starts_at)
);

CREATE TABLE votes (
  session_id TEXT NOT NULL REFERENCES sessions(id),
  user_id TEXT NOT NULL,
  game_id INTEGER NOT NULL,
  PRIMARY KEY (session_id, user_id),
  FOREIGN KEY (session_id, game_id) REFERENCES games(session_id, id)
);
CREATE INDEX votes_game ON votes(session_id, game_id);

CREATE TABLE availability (
  session_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  starts_at INTEGER NOT NULL,
  PRIMARY KEY (session_id, user_id, starts_at),
  FOREIGN KEY (session_id, starts_at) REFERENCES slots(session_id, starts_at)
);
CREATE INDEX availability_slot ON availability(session_id, starts_at);

CREATE TABLE rsvps (
  session_id TEXT NOT NULL REFERENCES sessions(id),
  user_id TEXT NOT NULL,
  response TEXT NOT NULL CHECK (response IN ('going','maybe','declined')),
  PRIMARY KEY (session_id, user_id)
);
CREATE INDEX rsvps_response ON rsvps(session_id, response);

CREATE TABLE search_limits (
  guild_id TEXT PRIMARY KEY REFERENCES guilds(id),
  next_at INTEGER NOT NULL
);

CREATE TABLE interaction_receipts (
  id TEXT PRIMARY KEY,
  claim TEXT NOT NULL UNIQUE,
  created_at INTEGER NOT NULL
);
CREATE INDEX receipts_age ON interaction_receipts(created_at);

CREATE TABLE deliveries (
  id INTEGER PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES sessions(id),
  kind TEXT NOT NULL CHECK (kind IN ('open','closed','confirmed','cancelled','reminder')),
  due_at INTEGER NOT NULL,
  next_at INTEGER NOT NULL,
  attempted_at INTEGER,
  lease_until INTEGER NOT NULL DEFAULT 0,
  claim TEXT,
  attempts INTEGER NOT NULL DEFAULT 0,
  state TEXT NOT NULL DEFAULT 'pending' CHECK (state IN ('pending','sent','skipped','blocked')),
  message_id TEXT,
  error TEXT,
  UNIQUE (session_id, kind)
);
CREATE INDEX deliveries_pending ON deliveries(next_at) WHERE state = 'pending';

CREATE VIEW game_tally AS
SELECT g.*, (SELECT count(*) FROM votes v WHERE v.session_id = g.session_id AND v.game_id = g.id) AS votes
FROM games g;

CREATE VIEW slot_tally AS
SELECT s.*, (
  SELECT count(*) FROM availability a
  WHERE a.session_id = s.session_id AND a.starts_at = s.starts_at
  AND NOT EXISTS (
    SELECT 1 FROM rsvps r WHERE r.session_id = a.session_id AND r.user_id = a.user_id AND r.response = 'declined'
  )
) AS available FROM slots s;

CREATE TRIGGER session_open_delivery AFTER INSERT ON sessions BEGIN
  INSERT INTO deliveries (session_id, kind, due_at, next_at)
  VALUES (NEW.id, 'open', NEW.created_at, NEW.created_at);
END;

CREATE TRIGGER session_status_delivery AFTER UPDATE OF status ON sessions
WHEN NEW.status <> OLD.status BEGIN
  INSERT INTO deliveries (session_id, kind, due_at, next_at)
  VALUES (NEW.id, NEW.status, NEW.decided_at, NEW.decided_at);
  INSERT INTO deliveries (session_id, kind, due_at, next_at)
  SELECT NEW.id, 'reminder', max(NEW.decided_at, NEW.starts_at - NEW.reminder * 60),
         max(NEW.decided_at, NEW.starts_at - NEW.reminder * 60)
  WHERE NEW.status = 'confirmed' AND NEW.reminder > 0
  AND NEW.starts_at - NEW.reminder * 60 > NEW.decided_at;
END;
