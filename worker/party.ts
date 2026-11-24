import { escapeText } from './discord-api.ts'
import { InputError, type Game, type GameTags } from './types.ts'

const platformNames = new Map([
  ['pc', 'PC'], ['xbox', 'Xbox'], ['playstation', 'PlayStation'], ['switch', 'Switch'], ['mobile', 'Mobile'],
])

// Accepts the names members actually type: PS5, Xbox Series X/S, PC (Steam), Game Pass, Nintendo Switch, iOS.
const platformAliases: [RegExp, string][] = [
  [/\b(pc|steam|windows|win|mac|macos|linux|epic)\b/, 'pc'],
  [/xbox|game ?pass|\bseries [xs]\b/, 'xbox'],
  [/playstation|\bps ?[1-5]?\b|\bpsn\b|\bvita\b/, 'playstation'],
  [/switch|nintendo|\bwii\b|\b3ds\b/, 'switch'],
  [/\b(mobile|ios|iphone|ipad|android|phone)\b/, 'mobile'],
]

// Returns recognised platform keys in the order typed, plus any entries it couldn't place.
export function readPlatforms(input: string) {
  const keys: string[] = []
  const unknown: string[] = []
  for (const part of input.toLowerCase().split(/[,+&;]|\band\b/).map(text => text.trim()).filter(Boolean)) {
    const found = platformAliases.map(([pattern, key]) => ({ key, at: part.search(pattern) }))
      .filter(match => match.at >= 0).sort((x, y) => x.at - y.at)
    if (found.length) keys.push(...found.map(match => match.key))
    else unknown.push(part)
  }
  return { keys: [...new Set(keys)], unknown }
}

export function parsePlatforms(input: string) {
  const { keys, unknown } = readPlatforms(input)
  if (unknown.length) throw new InputError('Use platforms from PC, Xbox, PlayStation, Switch and Mobile, separated by commas.')
  return keys
}

export function partyLabel(game: GameTags) {
  const platforms = (JSON.parse(game.platforms) as string[]).map(name => platformNames.get(name)).join(', ')
  const size = game.max_players !== null ? `${game.min_players ?? 1}–${game.max_players} players`
    : game.min_players !== null ? `${game.min_players}+ players` : ''
  return [platforms, game.crossplay === 1 ? 'crossplay' : game.crossplay === 0 ? 'no crossplay' : '', size]
    .filter(Boolean).join(' · ')
}

export function shortlist(games: Game[], platforms: string[], crossplay: boolean, players: number | null, surprise: boolean) {
  const eligible = games.filter(game =>
    platforms.every(name => (JSON.parse(game.platforms) as string[]).includes(name)) &&
    (!crossplay || game.crossplay === 1) &&
    (players === null || (game.max_players !== null && players >= (game.min_players ?? 1) && players <= game.max_players)),
  )
  if (!eligible.length) return 'No nominated games match. Ask an organizer to tag games or loosen your filters.'
  const describe = (game: Game) => {
    const tags = partyLabel(game)
    return `**${escapeText(game.name)}**${tags ? ` · ${tags}` : ''}`
  }
  if (surprise) {
    const random = crypto.getRandomValues(new Uint32Array(1))[0] / 4294967296
    return `🎲 Surprise pick · ${describe(eligible[Math.floor(random * eligible.length)])}`
  }
  return eligible.map(describe).join('\n').slice(0, 1900)
}
