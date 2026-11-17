import { statement } from './store.ts'
import { InputError, type Env, type GameDetails } from './types.ts'

interface RawgGame {
  id: number
  name: string
  background_image?: string
  slug?: string
  released?: string
  platforms?: { platform?: { name?: string } }[]
  genres?: { name?: string }[]
  publishers?: { name?: string }[]
}

async function request(env: Env, path: string, query?: string) {
  if (!env.RAWG_API_KEY) throw new InputError('Game search is disabled. Use a custom game name.')
  const url = new URL(`https://api.rawg.io/api/games${path}`)
  url.searchParams.set('key', env.RAWG_API_KEY)
  if (query) {
    url.searchParams.set('search', query)
    url.searchParams.set('page_size', '6')
  }
  let failure: number | 'timeout' | 'network' = 'network'
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(3500), redirect: 'manual' })
      if (response.ok) return response
      failure = response.status
      await response.body?.cancel().catch(() => undefined)
      if (response.status < 500) break
    } catch (error) {
      failure = error instanceof Error && error.name === 'TimeoutError' ? 'timeout' : 'network'
    }
  }
  // Upstream errors and request URLs may contain the API key.
  console.warn('RAWG lookup failed', failure)
  if (failure === 429) {
    throw new InputError('RAWG is limiting requests. Try again later, or nominate a custom game.')
  }
  throw new InputError('RAWG is unavailable right now. Try again later, or nominate a custom game.')
}

export async function allowRawg(env: Env, guildId: string, at: number, purpose: 'search' | 'details') {
  if (!env.RAWG_API_KEY) throw new InputError('Game search is disabled. Use a custom game name.')
  const table = purpose === 'search' ? 'search_limits' : 'rawg_detail_limits'
  const result = await statement(env.DB, `
    INSERT INTO ${table} (guild_id, next_at) VALUES (?, ?)
    ON CONFLICT(guild_id) DO UPDATE SET next_at = excluded.next_at WHERE ${table}.next_at <= ?
  `, guildId, at + 10, at).run()
  if (!result.meta.changes) throw new InputError('Please wait ten seconds between RAWG requests in this server.')
}

function clean(value: unknown, max: number) {
  // eslint-disable-next-line no-control-regex -- Strip untrusted C0 controls.
  return typeof value === 'string' ? value.replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, max) : ''
}

function labels<T>(items: T[] | undefined, getName: (entry: T) => unknown, count: number, maxLength: number) {
  if (!Array.isArray(items)) return []
  return [...new Set(items.map(item => clean(getName(item), maxLength)).filter(Boolean))].slice(0, count)
}

function pick(candidate: unknown) {
  if (!candidate || typeof candidate !== 'object') return null
  const game = candidate as RawgGame
  const name = clean(game.name, 100)
  if (!Number.isInteger(game.id) || game.id < 1 || game.id > 2147483647 || !name) return null
  let image = null
  if (typeof game.background_image === 'string' && game.background_image.length < 512) {
    try {
      const url = new URL(game.background_image)
      if (url.origin === 'https://media.rawg.io' && !url.username && !url.password) image = url.href
    } catch { /* Ignore malformed upstream images. */ }
  }
  const details: GameDetails = {}
  const platforms = labels(game.platforms, entry => entry?.platform?.name, 8, 36)
  const genres = labels(game.genres, entry => entry?.name, 3, 32)
  const [publisher] = labels(game.publishers, entry => entry?.name, 1, 60)
  if (platforms.length) details.platforms = platforms
  if (genres.length) details.genres = genres
  if (publisher) details.publisher = publisher
  if (typeof game.released === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(game.released)) details.released = game.released
  if (typeof game.slug === 'string' && /^[a-z0-9-]{1,150}$/.test(game.slug)) {
    details.sourceUrl = `https://rawg.io/games/${game.slug}`
  }
  return { id: game.id, name, image, details }
}

export async function searchRawg(env: Env, query: string) {
  const response = await request(env, '', query)
  const data = await response.json<{ results?: unknown }>().catch(() => null)
  if (!Array.isArray(data?.results)) throw new InputError('RAWG did not return search results.')
  return data.results.slice(0, 6).map(pick).filter(game => game !== null)
}

export async function rawgGame(env: Env, id: number) {
  const response = await request(env, `/${id}`)
  const game = pick(await response.json().catch(() => null))
  if (!game || game.id !== id) throw new InputError('RAWG did not return that game. Use /gamenight nominate with a custom name if needed.')
  return game
}

export async function matchRawgByName(env: Env, guildId: string, at: number, title: string) {
  if (!env.RAWG_API_KEY) return null
  const key = (name: string) => name.normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim()
  const wanted = key(title)
  if (wanted.length < 2) return null
  let results
  try {
    await allowRawg(env, guildId, at, 'search')
    results = await searchRawg(env, title)
  } catch (error) {
    if (error instanceof InputError) return null
    throw error
  }
  const matches = results.filter(game => key(game.name) === wanted)
  if (matches.length !== 1) return null
  const [matched] = matches
  try {
    await allowRawg(env, guildId, at, 'details')
    return await rawgGame(env, matched.id)
  } catch (error) {
    if (error instanceof InputError) return matched
    throw error
  }
}
