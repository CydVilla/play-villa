import { syncEvents } from './events.ts'
import { deliverPending } from './delivery.ts'
import { mentions, patchReply } from './discord-api.ts'
import { autocomplete, handleInteraction, updatesCreatePreview, type Interaction } from './interactions.ts'
import { publicSchedule } from './public.ts'
import { scheduleRounds } from './schedule.ts'
import { signedBody } from './signature.ts'
import { nowSeconds, snowflake, type Env } from './types.ts'

export default {
  async fetch(request, env, ctx) {
    const path = new URL(request.url).pathname
    const at = nowSeconds()
    if (path === '/health' && request.method === 'GET') return Response.json({ ok: true })
    if (path === '/api/schedule' && request.method === 'GET') {
      try {
        return await publicSchedule(env, request, at)
      } catch {
        return Response.json({ error: 'The schedule is temporarily unavailable.' }, { status: 503 })
      }
    }
    if (path !== '/discord/interactions') return new Response('Not found', { status: 404 })
    if (request.method !== 'POST') return new Response('Method not allowed', { status: 405, headers: { Allow: 'POST' } })

    const raw = await signedBody(request, env.DISCORD_PUBLIC_KEY, at)
    if (raw === null) return new Response('Invalid signature', { status: 401 })
    let interaction: Interaction
    try {
      interaction = JSON.parse(raw)
    } catch {
      return new Response('Invalid interaction', { status: 400 })
    }
    if (!interaction || !snowflake(env.DISCORD_APPLICATION_ID) || interaction.application_id !== env.DISCORD_APPLICATION_ID) {
      return new Response('Invalid application', { status: 401 })
    }
    if (interaction.type === 1) return Response.json({ type: 1 })
    if (interaction.type === 4) {
      // Discord has no deferred response for autocomplete. Return empty choices
      // if D1 is slow, so the client can retry on its next keystroke.
      const choices = await Promise.race([
        autocomplete(env, interaction, at).catch(() => []),
        new Promise<[]>(resolve => setTimeout(() => resolve([]), 1700)),
      ])
      return Response.json({ type: 8, data: { choices } })
    }
    if (![2, 3].includes(interaction.type) || !snowflake(interaction.id) ||
      typeof interaction.token !== 'string' || !/^[!-~]{1,512}$/.test(interaction.token)) {
      return new Response('Unsupported interaction', { status: 400 })
    }
    ctx.waitUntil((async () => {
      const { message, notify } = await handleInteraction(env, interaction, at)
      const tasks = [patchReply(env, interaction.token, message)]
      if (notify) tasks.push(deliverPending(env, nowSeconds(), notify), syncEvents(env, nowSeconds(), notify))
      await Promise.allSettled(tasks)
    })())
    return Response.json(updatesCreatePreview(interaction) ? { type: 6 }
      : { type: 5, data: { flags: 64, allowed_mentions: mentions } })
  },

  async scheduled(_controller, env) {
    const at = nowSeconds()
    try {
      await scheduleRounds(env.DB, at)
    } finally {
      await Promise.all([deliverPending(env, at), syncEvents(env, at)])
    }
  },
} satisfies ExportedHandler<Env>
