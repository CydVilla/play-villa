import { InputError, type Weekly } from './types.ts'

const dayMinutes = 1440
const weekMinutes = 7 * dayMinutes
const daySeconds = dayMinutes * 60
const weekdays = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun']
const formatters = new Map<string, Intl.DateTimeFormat>()

function formatter(zone: string) {
  let result = formatters.get(zone)
  if (!result) {
    result = new Intl.DateTimeFormat('en-CA', {
      timeZone: zone, hourCycle: 'h23',
      year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
    })
    if (formatters.size >= 32) formatters.clear()
    formatters.set(zone, result)
  }
  return result
}

export function canonicalZone(value: string) {
  try {
    if (!/^(UTC|[a-z_]+(?:\/[a-z0-9_+-]+)+)$/i.test(value)) throw new RangeError()
    return formatter(value).resolvedOptions().timeZone
  } catch {
    throw new InputError('Use UTC or an IANA time zone such as America/New_York.')
  }
}

function localSeconds(epoch: number, zone: string) {
  const parts = Object.fromEntries(formatter(zone).formatToParts(epoch * 1000).map(p => [p.type, Number(p.value)]))
  return Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute) / 1000
}

function resolveLocal(wall: number, zone: string, recurring: boolean) {
  const offsets = new Set([-daySeconds, 0, daySeconds].map(delta => {
    const sample = wall + delta
    return localSeconds(sample, zone) - sample
  }))
  const candidates = [...offsets].map(offset => wall - offset).sort((a, b) => a - b)
  const exact = candidates.filter(epoch => localSeconds(epoch, zone) === wall)
  if (exact.length === 1 || (recurring && exact.length)) return exact[0]
  if (recurring) {
    const forward = candidates
      .map(epoch => ({ epoch, delta: localSeconds(epoch, zone) - wall }))
      .filter(candidate => candidate.delta > 0)
      .sort((a, b) => a.delta - b.delta)[0]
    if (forward) return forward.epoch
  }
  throw new InputError('That local time is ambiguous or skipped by a clock change. Enter an explicit UTC offset, such as -04:00.')
}

export function parseTime(value: string, zone: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(Z|[+-]\d{2}:\d{2})?$/.exec(value.trim())
  if (!match) throw new InputError('Enter a time as YYYY-MM-DD HH:MM or use an ISO time with Z or a UTC offset.')
  const [, year, month, day, hour, minute, offset] = match
  const epoch = Date.UTC(+year, +month - 1, +day, +hour, +minute) / 1000
  if (new Date(epoch * 1000).toISOString().slice(0, 16) !== `${year}-${month}-${day}T${hour}:${minute}`) {
    throw new InputError('Enter a valid calendar date and time.')
  }
  if (!offset) return resolveLocal(epoch, zone, false)
  if (offset === 'Z') return epoch
  const hours = Number(offset.slice(1, 3))
  const minutes = Number(offset.slice(4))
  if (hours > 23 || minutes > 59) throw new InputError('Enter a valid UTC offset.')
  return epoch - (offset[0] === '+' ? 1 : -1) * (hours * 60 + minutes) * 60
}

export function parseFuture(value: string, zone: string, now: number) {
  const epoch = parseTime(value, zone)
  if (epoch <= now || epoch > now + 90 * daySeconds) throw new InputError('Choose a future time within 90 days.')
  return epoch
}

function weeklyMinute(value: string) {
  const match = /^(mon|tue|wed|thu|fri|sat|sun)\s+(\d{2}):(\d{2})$/i.exec(value.trim())
  if (!match || Number(match[2]) > 23 || Number(match[3]) > 59) {
    throw new InputError('Use weekday and 24-hour time, such as fri 20:00.')
  }
  return weekdays.indexOf(match[1].toLowerCase()) * dayMinutes + Number(match[2]) * 60 + Number(match[3])
}

export function parseWeekly(open: string, close: string, slots: string, auto: boolean, capacity: number | null): Weekly {
  const opening = weeklyMinute(open)
  const relative = (value: string) => (weeklyMinute(value) - opening + weekMinutes) % weekMinutes
  const closing = relative(close)
  const times = [...new Set(slots.split(',').map(relative))].sort((a, b) => a - b)
  if (!closing || times[0] <= closing || times.length > 10) {
    throw new InputError('Enter 1–10 slots after the deadline and before the next weekly opening.')
  }
  return { open: opening, close: closing, slots: times, auto, capacity }
}

export function weeklyWindow(reference: number, zone: string, weekly: Weekly, next = false) {
  const wall = localSeconds(reference, zone)
  const date = new Date(wall * 1000)
  const monday = Math.floor(wall / daySeconds) * daySeconds - ((date.getUTCDay() + 6) % 7) * daySeconds
  let start = monday + weekly.open * 60
  if (resolveLocal(start, zone, true) > reference) start -= 7 * daySeconds
  if (next) start += 7 * daySeconds
  const close = resolveLocal(start + weekly.close * 60, zone, true)
  return {
    key: new Date(start * 1000).toISOString().slice(0, 10),
    open: resolveLocal(start, zone, true),
    close,
    slots: [...new Set(weekly.slots.map(slot => resolveLocal(start + slot * 60, zone, true)))].filter(slot => slot > close),
  }
}
