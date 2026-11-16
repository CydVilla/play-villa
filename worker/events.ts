import { channelLink, discord, retrySeconds } from './discord-api.ts'
import { rows, statement } from './store.ts'
import { snowflake, type Env, type Session } from './types.ts'

interface EventJob {
  session_id: string
  event_id: string | null
  generation: number
  attempted_at: number | null
  claim: string
}

interface DiscordEvent {
  id: string
  creator_id?: string
  description?: string
  status?: number
}

async function finish(
  env: Env, job: EventJob, eventId: string | null, next: number | null, error: string | null,
  attemptedAt = job.attempted_at,
) {
  await statement(env.DB, `
    UPDATE discord_events SET event_id = ?, lease_until = 0, claim = NULL, attempted_at = ?, error = ?,
      synced = CASE WHEN ? IS NULL THEN ? ELSE synced END,
      next_at = CASE WHEN generation = ? THEN coalesce(?, 0) ELSE next_at END
    WHERE session_id = ? AND claim = ?
  `, eventId, attemptedAt, error, next, job.generation, job.generation, next, job.session_id, job.claim).run()
}

async function syncOne(env: Env, id: string, at: number) {
  const job = await statement(env.DB, `
    UPDATE discord_events SET lease_until = ?, claim = ? WHERE session_id = ?
    AND generation > synced AND next_at <= ? AND lease_until <= ? RETURNING *
  `, at + 45, crypto.randomUUID(), id, at, at).first<EventJob>()
  if (!job) return
  const item = await statement(env.DB, 'SELECT * FROM sessions WHERE id = ?', id).first<Session>()
  if (!item) return
  const path = `/guilds/${item.guild_id}/scheduled-events`
  const marker = `Play Villa session ${id}`
  const token = env.DISCORD_BOT_TOKEN

  try {
    if (job.attempted_at && !job.event_id) {
      // Discord Events has no create idempotency key. Reconcile before any possible retry.
      const response = await discord(path, { token })
      if (response.ok) {
        const events = await response.json<DiscordEvent[]>()
        const existing = events.find(event => event.creator_id === env.DISCORD_APPLICATION_ID &&
          event.description?.endsWith(marker) && snowflake(event.id))
        if (existing) return finish(env, job, existing.id, at, null, null)
      }
      const delay = response.status === 429 ? await retrySeconds(response) : 60
      return finish(env, job, null, at - job.attempted_at >= 1800 ? null : at + delay,
        'Event creation could not be verified. Check Discord Events for the session marker.')
    }

    if (item.status === 'cancelled') {
      if (!job.event_id) return finish(env, job, null, null, null, null)
      const target = `${path}/${job.event_id}`
      const current = await discord(target, { token })
      if (current.status === 404) return finish(env, job, null, null, null, null)
      if (!current.ok) return retry(env, job, current, at)
      const event = await current.json<DiscordEvent>()
      if (event.status === 3 || event.status === 4) return finish(env, job, null, null, null, null)
      const response = await discord(target, { method: 'PATCH', token, body: { status: event.status === 2 ? 3 : 4 } })
      if (!response.ok && response.status !== 404) return retry(env, job, response, at)
      return finish(env, job, null, null, null, null)
    }

    if (item.status !== 'confirmed' || !item.starts_at || item.starts_at <= at) {
      return finish(env, job, job.event_id, null, null, null)
    }

    const game = await statement(env.DB, 'SELECT name FROM games WHERE session_id = ? AND id = ?', id, item.game_id)
      .first<string>('name')
    const body = {
      name: (game ?? item.title).slice(0, 100),
      description: [item.description, marker].filter(Boolean).join('\n\n'),
      privacy_level: 2,
      entity_type: 3,
      entity_metadata: { location: channelLink(item.guild_id, item.voice_id ?? item.channel_id) },
      scheduled_start_time: new Date(item.starts_at * 1000).toISOString(),
      scheduled_end_time: new Date((item.starts_at + item.duration * 60) * 1000).toISOString(),
    }
    if (job.event_id) {
      const response = await discord(`${path}/${job.event_id}`, { method: 'PATCH', token, body })
      if (response.status === 404) return finish(env, job, null, null, 'The Discord Event was removed.', null)
      if (!response.ok) return retry(env, job, response, at)
      return finish(env, job, job.event_id, null, null, null)
    }

    const marked = await statement(env.DB, `
      UPDATE discord_events SET attempted_at = ? WHERE session_id = ? AND claim = ? AND generation = ? AND lease_until > ?
    `, at, id, job.claim, job.generation, at).run()
    if (!marked.meta.changes) return finish(env, job, null, at, null, null)
    job.attempted_at = at
    const response = await discord(path, { method: 'POST', token, body })
    if (!response.ok) return retry(env, job, response, at)
    const created = await response.json<DiscordEvent>()
    if (!snowflake(created.id)) return finish(env, job, null, at + 60, 'Discord did not return the event ID.')
    return finish(env, job, created.id, null, null, null)
  } catch {
    const next = job.attempted_at && at - job.attempted_at >= 1800 ? null : at + 60
    return finish(env, job, job.event_id, next, 'Discord Events did not confirm the request.')
  }
}

async function retry(env: Env, job: EventJob, response: Response, at: number) {
  const delay = response.status === 429 ? await retrySeconds(response) : response.status === 403 ? 300 : 60
  const next = response.status === 400 ? null : at + delay
  const attempted = response.status >= 500 ? job.attempted_at : null
  return finish(env, job, job.event_id, next, `Discord Events HTTP ${response.status}.`, attempted)
}

export async function syncEvents(env: Env, at: number, sessionId?: string) {
  if (!env.DISCORD_BOT_TOKEN || !env.DISCORD_APPLICATION_ID) return
  const pending = await rows<{ session_id: string }>(env.DB, `
    SELECT session_id FROM discord_events WHERE generation > synced AND next_at <= ? AND lease_until <= ?
    ${sessionId ? 'AND session_id = ?' : ''} ORDER BY next_at LIMIT 3
  `, at, at, ...(sessionId ? [sessionId] : []))
  for (const job of pending) await syncOne(env, job.session_id, at)
}
