ALTER TABLE guilds ADD COLUMN discord_events INTEGER NOT NULL DEFAULT 0 CHECK (discord_events IN (0,1));
ALTER TABLE sessions ADD COLUMN revision INTEGER NOT NULL DEFAULT 0;
ALTER TABLE games ADD COLUMN platforms TEXT NOT NULL DEFAULT '[]' CHECK (json_type(platforms) = 'array');
ALTER TABLE games ADD COLUMN crossplay INTEGER CHECK (crossplay IN (0,1));
ALTER TABLE games ADD COLUMN min_players INTEGER CHECK (min_players BETWEEN 1 AND 99);
ALTER TABLE games ADD COLUMN max_players INTEGER CHECK (max_players BETWEEN 1 AND 99 AND (min_players IS NULL OR min_players <= max_players));
ALTER TABLE rsvps ADD COLUMN needs_reconfirm INTEGER NOT NULL DEFAULT 0 CHECK (needs_reconfirm IN (0,1));

CREATE TABLE waitlist (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT NOT NULL REFERENCES sessions(id),
  user_id TEXT NOT NULL,
  offered_at INTEGER,
  offered_until INTEGER,
  UNIQUE (session_id, user_id)
);
CREATE INDEX waitlist_queue ON waitlist(session_id, id) WHERE offered_until IS NULL;
CREATE INDEX waitlist_expiry ON waitlist(offered_until) WHERE offered_until IS NOT NULL;

DROP TRIGGER session_open_delivery;
DROP TRIGGER session_status_delivery;
DROP INDEX deliveries_pending;
ALTER TABLE deliveries RENAME TO previous_deliveries;

CREATE TABLE deliveries (
  id INTEGER PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES sessions(id),
  kind TEXT NOT NULL CHECK (kind IN ('open','closed','confirmed','cancelled','reminder','rescheduled','offer')),
  revision INTEGER NOT NULL DEFAULT 0,
  occurrence INTEGER NOT NULL DEFAULT 0,
  due_at INTEGER NOT NULL,
  next_at INTEGER NOT NULL,
  attempted_at INTEGER,
  lease_until INTEGER NOT NULL DEFAULT 0,
  claim TEXT,
  attempts INTEGER NOT NULL DEFAULT 0,
  state TEXT NOT NULL DEFAULT 'pending' CHECK (state IN ('pending','sent','skipped','blocked')),
  message_id TEXT,
  error TEXT,
  UNIQUE (session_id, kind, revision, occurrence)
);
INSERT INTO deliveries (id, session_id, kind, due_at, next_at, attempted_at, lease_until, claim, attempts, state, message_id, error)
SELECT id, session_id, kind, due_at, next_at, attempted_at, lease_until, claim, attempts, state, message_id, error
FROM previous_deliveries;
DROP TABLE previous_deliveries;
CREATE INDEX deliveries_pending ON deliveries(next_at) WHERE state = 'pending';

CREATE TABLE discord_events (
  session_id TEXT PRIMARY KEY REFERENCES sessions(id),
  event_id TEXT,
  generation INTEGER NOT NULL DEFAULT 1,
  synced INTEGER NOT NULL DEFAULT 0,
  next_at INTEGER NOT NULL,
  attempted_at INTEGER,
  lease_until INTEGER NOT NULL DEFAULT 0,
  claim TEXT,
  error TEXT
);
CREATE INDEX discord_events_pending ON discord_events(next_at) WHERE generation > synced;

CREATE TRIGGER session_open_delivery AFTER INSERT ON sessions BEGIN
  INSERT INTO deliveries (session_id, kind, due_at, next_at)
  VALUES (NEW.id, 'open', NEW.created_at, NEW.created_at);
END;

CREATE TRIGGER session_status_delivery AFTER UPDATE OF status ON sessions
WHEN NEW.status <> OLD.status BEGIN
  INSERT INTO deliveries (session_id, kind, revision, due_at, next_at)
  VALUES (NEW.id, NEW.status, NEW.revision, NEW.decided_at, NEW.decided_at);
  INSERT INTO deliveries (session_id, kind, revision, due_at, next_at)
  SELECT NEW.id, 'reminder', NEW.revision, NEW.starts_at - NEW.reminder * 60, NEW.starts_at - NEW.reminder * 60
  WHERE NEW.status = 'confirmed' AND NEW.reminder > 0 AND NEW.starts_at - NEW.reminder * 60 > NEW.decided_at;

  INSERT INTO discord_events (session_id, next_at)
  SELECT NEW.id, NEW.decided_at FROM guilds WHERE id = NEW.guild_id AND discord_events = 1 AND NEW.status = 'confirmed'
  ON CONFLICT DO NOTHING;
  UPDATE discord_events SET generation = generation + 1, next_at = NEW.decided_at
  WHERE session_id = NEW.id AND NEW.status = 'cancelled';
  DELETE FROM waitlist WHERE session_id = NEW.id AND NEW.status = 'cancelled';
END;

CREATE TRIGGER session_rescheduled AFTER UPDATE OF revision ON sessions
WHEN NEW.revision <> OLD.revision BEGIN
  UPDATE rsvps SET needs_reconfirm = 1 WHERE session_id = NEW.id AND response <> 'declined';
  DELETE FROM waitlist WHERE session_id = NEW.id;
  INSERT INTO deliveries (session_id, kind, revision, due_at, next_at)
  VALUES (NEW.id, 'rescheduled', NEW.revision, NEW.decided_at, NEW.decided_at);
  INSERT INTO deliveries (session_id, kind, revision, due_at, next_at)
  SELECT NEW.id, 'reminder', NEW.revision, NEW.starts_at - NEW.reminder * 60, NEW.starts_at - NEW.reminder * 60
  WHERE NEW.reminder > 0 AND NEW.starts_at - NEW.reminder * 60 > NEW.decided_at;
END;

CREATE TRIGGER session_event_details AFTER UPDATE OF starts_at, title, description, voice_id ON sessions
WHEN OLD.status = 'confirmed' AND NEW.status = 'confirmed'
AND (NEW.starts_at IS NOT OLD.starts_at OR NEW.title IS NOT OLD.title OR
     NEW.description IS NOT OLD.description OR NEW.voice_id IS NOT OLD.voice_id) BEGIN
  UPDATE discord_events SET generation = generation + 1, next_at = 0
  WHERE session_id = NEW.id;
END;

CREATE TRIGGER waitlist_offer_delivery AFTER UPDATE OF offered_until ON waitlist
WHEN OLD.offered_until IS NULL AND NEW.offered_until IS NOT NULL BEGIN
  INSERT INTO deliveries (session_id, kind, revision, occurrence, due_at, next_at)
  SELECT s.id, 'offer', s.revision, NEW.id, NEW.offered_at, NEW.offered_at FROM sessions s WHERE s.id = NEW.session_id;
END;
