import { discord, retrySeconds } from './discord-api.ts'
import { board } from './presentation.ts'
import { details, rows, statement } from './store.ts'
import type { BoardUpdate, Delivery, Env, Session } from './types.ts'

async function release(
  env: Env, update: BoardUpdate, synced: number, nextAt: number, error: string | null,
) {
  await statement(env.DB, `
    UPDATE board_updates SET synced = ?, next_at = ?, lease_until = 0, claim = NULL, error = ?
    WHERE session_id = ? AND claim = ?
  `, synced, nextAt, error, update.session_id, update.claim).run()
}

async function refresh(env: Env, at: number, sessionId: string) {
  const update = await statement(env.DB, `
    UPDATE board_updates SET lease_until = ?, claim = ?, attempts = attempts + 1
    WHERE session_id = ? AND generation > synced AND next_at <= ? AND lease_until <= ?
    RETURNING *
  `, at + 45, crypto.randomUUID(), sessionId, at, at).first<BoardUpdate>()
  if (!update) return false
  const item = await statement(env.DB, 'SELECT * FROM sessions WHERE id = ?', sessionId).first<Session>()
  if (!item) {
    await release(env, update, update.generation, 0, null)
    return true
  }
  // Only the newest board for this revision is edited. Older boards keep their
  // snapshot, so a closed or rescheduled night never shows two live tallies.
  const delivery = await statement(env.DB, `
    SELECT * FROM deliveries WHERE session_id = ? AND revision = ? AND kind NOT IN ('reminder', 'offer', 'last-call')
    ORDER BY id DESC LIMIT 1
  `, sessionId, item.revision).first<Delivery>()
  if (delivery?.state === 'pending') {
    // The post renders current totals. Recheck after it records its message ID.
    await release(env, update, update.synced, at + 15, null)
    return true
  }
  if (delivery?.state !== 'sent' || !delivery.message_id) {
    await release(env, update, update.generation, 0, 'There is no posted board to refresh.')
    return true
  }
  let response: Response
  try {
    response = await discord(`/channels/${item.channel_id}/messages/${delivery.message_id}`, {
      token: env.DISCORD_BOT_TOKEN,
      method: 'PATCH',
      body: board(await details(env.DB, item), at, delivery),
    })
  } catch {
    await release(env, update, update.synced, at + 60, 'Discord did not confirm the board refresh.')
    return true
  }
  if (response.ok || response.status === 404) {
    await release(env, update, update.generation, 0, response.ok ? null : 'The Discord board no longer exists.')
  } else if (response.status === 429) {
    await release(env, update, update.synced, at + await retrySeconds(response), 'Discord rate limit.')
  } else {
    const delay = response.status >= 500 ? 60 : Math.min(3600, 30 * 2 ** Math.min(update.attempts, 7))
    await release(env, update, update.synced, at + delay, `Discord HTTP ${response.status}.`)
  }
  return true
}

export async function refreshBoards(env: Env, at: number, sessionId: string | null = null) {
  if (!env.DISCORD_BOT_TOKEN || !env.DISCORD_APPLICATION_ID) return
  const filter = sessionId ? 'AND session_id = ?' : ''
  for (let count = 0; count < 3; count++) {
    const pending = await rows<{ session_id: string }>(env.DB, `
      SELECT session_id FROM board_updates
      WHERE generation > synced AND next_at <= ? AND lease_until <= ? ${filter}
      ORDER BY next_at, session_id LIMIT 1
    `, at, at, ...(sessionId ? [sessionId] : []))
    if (!pending.length || !await refresh(env, at, pending[0].session_id)) return
  }
}
