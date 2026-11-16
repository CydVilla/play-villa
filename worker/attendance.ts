import { statement } from './store.ts'
import type { RSVP } from './types.ts'

export function offerSpots(db: D1Database, id: string, at: number, gate = '1', revision: number | null = null) {
  return [
    statement(db, `
      DELETE FROM waitlist WHERE session_id = ? AND offered_until <= ? AND ${gate}
      AND EXISTS (SELECT 1 FROM sessions s WHERE s.id = waitlist.session_id AND (? IS NULL OR s.revision = ?))
    `, id, at, revision, revision),
    statement(db, `
      WITH vacant AS (
        SELECT s.starts_at, coalesce(s.capacity, 2147483647) -
          (SELECT count(*) FROM rsvps r WHERE r.session_id = s.id AND r.response = 'going' AND r.needs_reconfirm = 0) -
          (SELECT count(*) FROM waitlist w WHERE w.session_id = s.id AND w.offered_until > ?) AS seats
        FROM sessions s WHERE s.id = ? AND s.status = 'confirmed' AND s.starts_at > ? AND (? IS NULL OR s.revision = ?) AND ${gate}
      )
      UPDATE waitlist SET offered_at = ?, offered_until = min((SELECT starts_at FROM vacant), ?)
      WHERE id IN (SELECT id FROM waitlist WHERE session_id = ? AND offered_until IS NULL ORDER BY id
        LIMIT max(0, coalesce((SELECT seats FROM vacant), 0)))
    `, at, id, at, revision, revision, at, at + 1800, id),
  ]
}

export function attendance(db: D1Database, id: string, revision: number, user: string, response: RSVP, at: number, gate: string) {
  const write = statement(db, `
    INSERT INTO rsvps (session_id, user_id, response, needs_reconfirm)
    SELECT s.id, ?, ?, 0 FROM sessions s
    WHERE s.id = ? AND s.revision = ? AND s.status <> 'cancelled' AND ${gate}
    AND CASE WHEN s.status = 'confirmed' THEN s.starts_at + s.duration * 60
      ELSE (SELECT max(starts_at) FROM slots WHERE session_id = s.id) END > ?
    AND (? <> 'going' OR (
      NOT EXISTS (SELECT 1 FROM waitlist WHERE session_id = s.id AND user_id = ? AND offered_until IS NULL)
      AND (s.capacity IS NULL OR s.capacity >
        (SELECT count(*) FROM rsvps r WHERE r.session_id = s.id AND r.response = 'going'
          AND r.needs_reconfirm = 0 AND r.user_id <> ?)
        + (SELECT count(*) FROM waitlist w WHERE w.session_id = s.id AND w.offered_until > ? AND w.user_id <> ?))
    ))
    ON CONFLICT(session_id, user_id) DO UPDATE SET response = excluded.response, needs_reconfirm = 0
  `, user, response, id, revision, at, response, user, user, at, user)

  const queue = response === 'going' ? statement(db, `
    INSERT INTO waitlist (session_id, user_id)
    SELECT id, ? FROM sessions WHERE id = ? AND revision = ? AND status = 'confirmed'
    AND capacity IS NOT NULL AND starts_at > ? AND ${gate}
    AND NOT EXISTS (SELECT 1 FROM rsvps WHERE session_id = sessions.id AND user_id = ?
      AND response = 'going' AND needs_reconfirm = 0)
    ON CONFLICT DO NOTHING
  `, user, id, revision, at, user) : null

  const leave = statement(db, `
    DELETE FROM waitlist WHERE session_id = ? AND user_id = ? AND ${gate}
    AND EXISTS (SELECT 1 FROM sessions WHERE id = waitlist.session_id AND revision = ?)
    AND (? <> 'going' OR EXISTS (SELECT 1 FROM rsvps WHERE session_id = ? AND user_id = ?
      AND response = 'going' AND needs_reconfirm = 0))
  `, id, user, revision, response, id, user)

  const clearPrior = statement(db, `
    DELETE FROM rsvps WHERE session_id = ? AND user_id = ? AND ${gate}
    AND EXISTS (SELECT 1 FROM sessions WHERE id = rsvps.session_id AND revision = ?)
    AND EXISTS (SELECT 1 FROM waitlist WHERE session_id = rsvps.session_id AND user_id = rsvps.user_id)
  `, id, user, revision)

  return [
    ...offerSpots(db, id, at, gate, revision), write, leave,
    ...(queue ? [queue, clearPrior] : []),
    ...offerSpots(db, id, at, gate, revision),
  ]
}

export function reschedule(db: D1Database, id: string, revision: number, start: number, at: number, gate: string) {
  return [
    statement(db, `
      INSERT INTO slots (session_id, starts_at)
      SELECT id, ? FROM sessions WHERE id = ? AND revision = ? AND status = 'confirmed'
      AND starts_at > ? AND starts_at <> ? AND ${gate}
      ON CONFLICT DO NOTHING
    `, start, id, revision, at, start),
    statement(db, `
      UPDATE sessions SET starts_at = ?, decided_at = ?, revision = revision + 1
      WHERE id = ? AND revision = ? AND status = 'confirmed' AND starts_at > ? AND starts_at <> ? AND ${gate}
    `, start, at, id, revision, at, start),
  ]
}
