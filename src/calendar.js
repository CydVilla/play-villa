const format = seconds => new Date(seconds * 1000).toISOString().replace(/[-:]/g, '').replace('.000', '')
const escape = value => value.replace(/\\/g, '\\\\').replace(/\r\n?|\n/g, '\\n').replace(/[;,]/g, '\\$&')

function fold(line) {
  const encoder = new TextEncoder()
  const result = []
  let part = ''
  let bytes = 0
  for (const char of line) {
    const length = encoder.encode(char).length
    if (bytes + length > 75) {
      result.push(part)
      part = ' '
      bytes = 1
    }
    part += char
    bytes += length
  }
  return [...result, part].join('\r\n')
}

export function calendar({ id, start, duration, decidedAt, summary, location, description }) {
  const end = start + duration * 60
  const data = [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Play Villa//Game Nights//EN', 'CALSCALE:GREGORIAN',
    'BEGIN:VEVENT', `UID:${id}@play-villa`, `DTSTAMP:${format(decidedAt)}`,
    `DTSTART:${format(start)}`, `DTEND:${format(end)}`, `SUMMARY:${escape(summary)}`,
    `DESCRIPTION:${escape(description)}`, `LOCATION:${escape(location)}`, 'END:VEVENT', 'END:VCALENDAR', '',
  ].map(fold).join('\r\n')
  const google = new URL('https://calendar.google.com/calendar/render')
  google.search = new URLSearchParams({
    action: 'TEMPLATE', text: summary, dates: `${format(start)}/${format(end)}`, details: description, location,
  })
  return { data, google: google.href }
}
