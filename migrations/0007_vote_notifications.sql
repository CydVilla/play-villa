-- Optional role mentioned when voting opens, and a last call before voting closes.
-- Nights already open keep last_call = 0, so the upgrade sends no surprise reminders.
ALTER TABLE guilds ADD COLUMN notify_role TEXT;
ALTER TABLE guilds ADD COLUMN last_call INTEGER NOT NULL DEFAULT 180 CHECK (last_call BETWEEN 0 AND 10080);
ALTER TABLE sessions ADD COLUMN last_call INTEGER NOT NULL DEFAULT 0 CHECK (last_call BETWEEN 0 AND 10080);

-- Rebuild the outbox to allow the 'last-call' kind. Triggers that write to it are
-- dropped first so the rename cannot rewrite them to point at the old table.
DROP TRIGGER session_open_delivery;
DROP TRIGGER session_status_delivery;
DROP TRIGGER session_rescheduled;
DROP TRIGGER waitlist_offer_delivery;
DROP INDEX deliveries_pending;
ALTER TABLE deliveries RENAME TO previous_deliveries;

CREATE TABLE deliveries (
  id INTEGER PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES sessions(id),
  kind TEXT NOT NULL CHECK (kind IN ('open','closed','confirmed','cancelled','reminder','rescheduled','offer','last-call')),
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
INSERT INTO deliveries SELECT id, session_id, kind, revision, occurrence, due_at, next_at, attempted_at,
  lease_until, claim, attempts, state, message_id, error FROM previous_deliveries;
DROP TABLE previous_deliveries;
CREATE INDEX deliveries_pending ON deliveries(next_at) WHERE state = 'pending';

CREATE TRIGGER session_open_delivery AFTER INSERT ON sessions BEGIN
  INSERT INTO deliveries (session_id, kind, due_at, next_at)
  VALUES (NEW.id, 'open', NEW.created_at, NEW.created_at);
  -- A last call is keyed by the deadline it announces. One that would fall before the
  -- night opens is left out, since the opening post already covers it.
  INSERT INTO deliveries (session_id, kind, occurrence, due_at, next_at)
  SELECT NEW.id, 'last-call', NEW.deadline, NEW.deadline - NEW.last_call * 60, NEW.deadline - NEW.last_call * 60
  WHERE NEW.last_call > 0 AND NEW.deadline - NEW.last_call * 60 > NEW.created_at;
END;

-- A new deadline gets its own last call; the delivery for the old deadline is skipped
-- when it comes due. No second one is queued when a last call already went out inside
-- the new window.
CREATE TRIGGER session_deadline_last_call AFTER UPDATE OF deadline ON sessions
WHEN NEW.deadline <> OLD.deadline AND NEW.status = 'open' AND NEW.last_call > 0 BEGIN
  INSERT INTO deliveries (session_id, kind, occurrence, due_at, next_at)
  SELECT NEW.id, 'last-call', NEW.deadline, NEW.deadline - NEW.last_call * 60, NEW.deadline - NEW.last_call * 60
  WHERE NEW.deadline - NEW.last_call * 60 > NEW.created_at
  AND NOT EXISTS (
    SELECT 1 FROM deliveries WHERE session_id = NEW.id AND kind = 'last-call' AND state = 'sent'
    AND attempted_at >= NEW.deadline - NEW.last_call * 60
  )
  ON CONFLICT DO NOTHING;
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

CREATE TRIGGER waitlist_offer_delivery AFTER UPDATE OF offered_until ON waitlist
WHEN OLD.offered_until IS NULL AND NEW.offered_until IS NOT NULL BEGIN
  INSERT INTO deliveries (session_id, kind, revision, occurrence, due_at, next_at)
  SELECT s.id, 'offer', s.revision, NEW.id, NEW.offered_at, NEW.offered_at FROM sessions s WHERE s.id = NEW.session_id;
END;
