CREATE TABLE board_updates (
  session_id TEXT PRIMARY KEY REFERENCES sessions(id),
  generation INTEGER NOT NULL DEFAULT 1,
  synced INTEGER NOT NULL DEFAULT 0,
  next_at INTEGER NOT NULL DEFAULT 0,
  lease_until INTEGER NOT NULL DEFAULT 0,
  claim TEXT,
  attempts INTEGER NOT NULL DEFAULT 0,
  error TEXT
);
CREATE INDEX board_updates_pending ON board_updates(next_at) WHERE generation > synced;

CREATE TRIGGER game_board_update_insert AFTER INSERT ON games BEGIN
  INSERT INTO board_updates (session_id) VALUES (NEW.session_id)
  ON CONFLICT(session_id) DO UPDATE SET generation = board_updates.generation + 1, next_at = 0, error = NULL;
END;
CREATE TRIGGER game_board_update_change AFTER UPDATE ON games BEGIN
  INSERT INTO board_updates (session_id) VALUES (NEW.session_id)
  ON CONFLICT(session_id) DO UPDATE SET generation = board_updates.generation + 1, next_at = 0, error = NULL;
END;
CREATE TRIGGER game_board_update_delete AFTER DELETE ON games BEGIN
  INSERT INTO board_updates (session_id) VALUES (OLD.session_id)
  ON CONFLICT(session_id) DO UPDATE SET generation = board_updates.generation + 1, next_at = 0, error = NULL;
END;

CREATE TRIGGER slot_board_update_insert AFTER INSERT ON slots BEGIN
  INSERT INTO board_updates (session_id) VALUES (NEW.session_id)
  ON CONFLICT(session_id) DO UPDATE SET generation = board_updates.generation + 1, next_at = 0, error = NULL;
END;
CREATE TRIGGER slot_board_update_delete AFTER DELETE ON slots BEGIN
  INSERT INTO board_updates (session_id) VALUES (OLD.session_id)
  ON CONFLICT(session_id) DO UPDATE SET generation = board_updates.generation + 1, next_at = 0, error = NULL;
END;

CREATE TRIGGER vote_board_update_insert AFTER INSERT ON votes BEGIN
  INSERT INTO board_updates (session_id) VALUES (NEW.session_id)
  ON CONFLICT(session_id) DO UPDATE SET generation = board_updates.generation + 1, next_at = 0, error = NULL;
END;
CREATE TRIGGER vote_board_update_change AFTER UPDATE ON votes BEGIN
  INSERT INTO board_updates (session_id) VALUES (NEW.session_id)
  ON CONFLICT(session_id) DO UPDATE SET generation = board_updates.generation + 1, next_at = 0, error = NULL;
END;
CREATE TRIGGER vote_board_update_delete AFTER DELETE ON votes BEGIN
  INSERT INTO board_updates (session_id) VALUES (OLD.session_id)
  ON CONFLICT(session_id) DO UPDATE SET generation = board_updates.generation + 1, next_at = 0, error = NULL;
END;

CREATE TRIGGER availability_board_update_insert AFTER INSERT ON availability BEGIN
  INSERT INTO board_updates (session_id) VALUES (NEW.session_id)
  ON CONFLICT(session_id) DO UPDATE SET generation = board_updates.generation + 1, next_at = 0, error = NULL;
END;
CREATE TRIGGER availability_board_update_delete AFTER DELETE ON availability BEGIN
  INSERT INTO board_updates (session_id) VALUES (OLD.session_id)
  ON CONFLICT(session_id) DO UPDATE SET generation = board_updates.generation + 1, next_at = 0, error = NULL;
END;

CREATE TRIGGER rsvp_board_update_insert AFTER INSERT ON rsvps BEGIN
  INSERT INTO board_updates (session_id) VALUES (NEW.session_id)
  ON CONFLICT(session_id) DO UPDATE SET generation = board_updates.generation + 1, next_at = 0, error = NULL;
END;
CREATE TRIGGER rsvp_board_update_change AFTER UPDATE ON rsvps BEGIN
  INSERT INTO board_updates (session_id) VALUES (NEW.session_id)
  ON CONFLICT(session_id) DO UPDATE SET generation = board_updates.generation + 1, next_at = 0, error = NULL;
END;
CREATE TRIGGER rsvp_board_update_delete AFTER DELETE ON rsvps BEGIN
  INSERT INTO board_updates (session_id) VALUES (OLD.session_id)
  ON CONFLICT(session_id) DO UPDATE SET generation = board_updates.generation + 1, next_at = 0, error = NULL;
END;

CREATE TRIGGER waitlist_board_update_insert AFTER INSERT ON waitlist BEGIN
  INSERT INTO board_updates (session_id) VALUES (NEW.session_id)
  ON CONFLICT(session_id) DO UPDATE SET generation = board_updates.generation + 1, next_at = 0, error = NULL;
END;
CREATE TRIGGER waitlist_board_update_change AFTER UPDATE ON waitlist BEGIN
  INSERT INTO board_updates (session_id) VALUES (NEW.session_id)
  ON CONFLICT(session_id) DO UPDATE SET generation = board_updates.generation + 1, next_at = 0, error = NULL;
END;
CREATE TRIGGER waitlist_board_update_delete AFTER DELETE ON waitlist BEGIN
  INSERT INTO board_updates (session_id) VALUES (OLD.session_id)
  ON CONFLICT(session_id) DO UPDATE SET generation = board_updates.generation + 1, next_at = 0, error = NULL;
END;

CREATE TRIGGER session_board_update AFTER UPDATE OF title, description, deadline, capacity, voice_id ON sessions
WHEN NEW.status = OLD.status BEGIN
  INSERT INTO board_updates (session_id) VALUES (NEW.id)
  ON CONFLICT(session_id) DO UPDATE SET generation = board_updates.generation + 1, next_at = 0, error = NULL;
END;
