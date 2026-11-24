-- Lets the member who suggested a game update its platforms and note while voting is open.
-- Earlier nominations stay NULL, so only organizers can edit them.
ALTER TABLE games ADD COLUMN nominated_by TEXT;
