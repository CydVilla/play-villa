export interface Env {
  DB: D1Database
  DISCORD_APPLICATION_ID?: string
  DISCORD_PUBLIC_KEY?: string
  DISCORD_BOT_TOKEN?: string
  DISCORD_GUILD_ID?: string
  PUBLIC_GUILD_ID?: string
  PUBLIC_CHANNEL_ID?: string
  WEB_ORIGIN?: string
  RAWG_API_KEY?: string
}

export interface Weekly {
  open: number
  close: number
  slots: number[]
  auto: boolean
  capacity: number | null
}

export interface Guild {
  id: string
  channel_id: string
  timezone: string
  voice_id: string | null
  organizer_role: string | null
  minimum: number
  reminder: number
  duration: number
  weekly: string | null
  weekly_version: string | null
  next_open_at: number | null
}

export interface Session {
  id: string
  guild_id: string
  channel_id: string
  voice_id: string | null
  organizer_id: string | null
  week_key: string | null
  title: string
  description: string
  timezone: string
  status: 'open' | 'closed' | 'confirmed' | 'cancelled'
  created_at: number
  deadline: number
  duration: number
  reminder: number
  minimum: number
  capacity: number | null
  game_id: number | null
  starts_at: number | null
  decided_at: number | null
}

export interface Game {
  id: number
  name: string
  rawg_id: number | null
  image: string | null
  votes: number
}

export interface Slot {
  starts_at: number
  available: number
}

export type RSVP = 'going' | 'maybe' | 'declined'

export interface Delivery {
  id: number
  session_id: string
  kind: 'open' | 'closed' | 'confirmed' | 'cancelled' | 'reminder'
  due_at: number
  next_at: number
  attempted_at: number | null
  lease_until: number
  claim: string | null
  attempts: number
  state: 'pending' | 'sent' | 'skipped' | 'blocked'
  message_id: string | null
}

export type Param = string | number | null

export const nowSeconds = () => Math.floor(Date.now() / 1000)
export const snowflake = (value: unknown): value is string => typeof value === 'string' && /^\d{17,20}$/.test(value)

export class InputError extends Error {}
