import { offerSpots } from './attendance.ts'
import { addSlot, close, rows, statement } from './store.ts'
import { weeklyWindow } from './time.ts'
import type { Guild, Weekly } from './types.ts'

export async function scheduleRounds(db: D1Database, at: number) {
  const due = await rows<Guild>(db, `
    SELECT * FROM guilds WHERE next_open_at <= ? ORDER BY next_open_at LIMIT 3
  `, at)
  for (const settings of due) {
    const weekly = JSON.parse(settings.weekly!) as Weekly
    const window = weeklyWindow(at, settings.timezone, weekly)
    const next = weeklyWindow(at, settings.timezone, weekly, true)
    const id = crypto.randomUUID()
    const gate = "weekly_version = ? AND next_open_at <= ?"
    const inserts = window.close > at && window.slots.length ? [
      statement(db, `
        INSERT INTO sessions (id, guild_id, channel_id, voice_id, week_key, title, timezone, created_at,
          deadline, duration, reminder, minimum, capacity, auto_confirm)
        SELECT ?, id, channel_id, voice_id, ?, 'Weekly game night', timezone, ?, ?, duration, reminder, minimum, ?, ?
        FROM guilds WHERE id = ? AND ${gate}
        ON CONFLICT DO NOTHING
      `, id, window.key, at, window.close, weekly.capacity, Number(weekly.auto), settings.id, settings.weekly_version, at),
      // The unique guild/week key elects one session. Only its ID gets slots.
      ...window.slots.map(time => addSlot(db, id, time, '1', at)),
    ] : []
    await db.batch([
      ...inserts,
      statement(db, `UPDATE guilds SET next_open_at = ? WHERE id = ? AND ${gate}`,
        next.open, settings.id, settings.weekly_version, at),
    ])
  }
  const expired = await rows<{ id: string }>(db, `
    SELECT id FROM sessions WHERE status = 'open' AND deadline <= ? ORDER BY deadline LIMIT 12
  `, at)
  if (expired.length) await db.batch(expired.map(item => close(db, item.id, at, '1', true)))
  const expiring = await rows<{ session_id: string }>(db, `
    SELECT session_id FROM waitlist WHERE offered_until <= ? GROUP BY session_id ORDER BY min(offered_until) LIMIT 8
  `, at)
  if (expiring.length) await db.batch(expiring.flatMap(row => offerSpots(db, row.session_id, at)))
  await statement(db, `
    DELETE FROM waitlist WHERE id IN (
      SELECT w.id FROM waitlist w JOIN sessions s ON s.id = w.session_id
      WHERE s.status = 'confirmed' AND s.starts_at <= ? LIMIT 100
    )
  `, at).run()
  await statement(db, `
    DELETE FROM interaction_receipts WHERE id IN (
      SELECT id FROM interaction_receipts WHERE created_at < ? LIMIT 100
    )
  `, at - 86400).run()
  await statement(db, `
    DELETE FROM create_drafts WHERE id IN (
      SELECT id FROM create_drafts WHERE expires_at <= ? ORDER BY expires_at LIMIT 100
    )
  `, at).run()
}
