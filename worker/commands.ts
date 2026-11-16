type Option = {
  type: number
  name: string
  description: string
  required?: boolean
  options?: Option[]
  channel_types?: number[]
  min_value?: number
  max_value?: number
  max_length?: number
  autocomplete?: boolean
}

const string = (name: string, description: string, required = false, max_length = 120): Option =>
  ({ type: 3, name, description, required, max_length })
const integer = (name: string, description: string, min_value: number, max_value: number): Option =>
  ({ type: 4, name, description, min_value, max_value })
const bool = (name: string, description: string): Option => ({ type: 5, name, description })
const channel = (name: string, description: string, channel_types: number[]): Option =>
  ({ type: 7, name, description, channel_types })
const session = { ...string('session', 'Choose a game night', true, 50), autocomplete: true }
const sub = (name: string, description: string, ...options: Option[]): Option =>
  ({ type: 1, name, description, options })

export const gameNightCommand = {
  type: 1, name: 'gamenight', description: 'Plan and vote on game nights',
  integration_types: [0], contexts: [0],
  options: [
    sub('configure', 'Set the announcement channel and organizer permissions',
      channel('channel', 'Text channel for game nights', [0, 5]),
      string('timezone', 'IANA time zone such as America/New_York', false, 100),
      channel('voice', 'Voice channel for confirmed sessions', [2, 13]),
      { type: 8, name: 'organizer_role', description: 'Role permitted to create and manage all game nights' },
      bool('clear_voice', 'Remove the current voice channel'),
      bool('clear_role', 'Remove the organizer role'),
      integer('minimum', 'Availability needed for automatic confirmation', 1, 25),
      integer('reminder', 'Minutes before play to send a reminder; zero disables', 0, 10080),
      integer('duration', 'Game night duration in minutes', 15, 480)),
    sub('weekly', 'Configure the recurring round in server local time',
      bool('enabled', 'Turn weekly rounds on or off'),
      string('open', 'Example: mon 18:00'),
      string('close', 'Example: thu 18:00'),
      string('slots', 'Example: fri 20:00, sat 20:00', false, 250),
      bool('auto', 'Confirm when there are votes and enough participants'),
      integer('capacity', 'Maximum number of Going RSVPs', 0, 99)),
    sub('create', 'Propose a game night and open voting',
      string('game', 'Game or activity to propose first', true, 100),
      string('time', 'YYYY-MM-DD HH:MM in server time, or add a UTC offset', true, 30),
      string('alternatives', 'Comma-separated alternate dates and times', false, 300),
      string('deadline', 'Voting deadline before the first slot', false, 30),
      string('description', 'Details for the group', false, 400),
      integer('capacity', 'Maximum number of Going RSVPs', 1, 99)),
    sub('show', 'Show the current game night, votes, availability and attendance', session),
    sub('nominate', 'Add a custom game or choose a RAWG result',
      session, string('game', 'Name of a custom game', false, 100),
      integer('rawg_id', 'Game ID from /gamenight search', 1, 2147483647)),
    sub('search', 'Search RAWG for games to nominate', string('query', 'Game name', true, 80)),
    sub('propose-time', 'Add a time for members to consider',
      session, string('time', 'YYYY-MM-DD HH:MM in session time, or add a UTC offset', true, 30)),
    sub('edit', 'Update game night details or extend/change an open deadline',
      session, string('title', 'New game night title', false, 100),
      string('description', 'New description', false, 400),
      bool('clear_description', 'Remove the description'),
      string('deadline', 'New voting deadline before the first slot', false, 30),
      integer('capacity', 'Maximum Going RSVPs; zero removes the limit', 0, 99),
      channel('voice', 'Change the voice channel', [2, 13]),
      bool('clear_voice', 'Remove the voice channel')),
    sub('close', 'Close voting and publish the recommendations', session),
    sub('confirm', 'Confirm the suggested game and time, or override them',
      session,
      { ...string('game', 'Choose a nominated game to override the recommendation', false, 20), autocomplete: true },
      { ...string('time', 'Choose a proposed time to override the recommendation', false, 20), autocomplete: true }),
    sub('cancel', 'Cancel this game night', session),
    sub('delivery-status', 'Check a game night’s announcements and reminder status', session),
  ],
}
