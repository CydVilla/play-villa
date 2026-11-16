import { calendar } from '../calendar'
import './CalendarIntegration.css'

export default function CalendarIntegration({ event }) {
  const { data, google } = calendar(event)
  function download() {
    const url = URL.createObjectURL(new Blob([data], { type: 'text/calendar;charset=utf-8' }))
    const link = document.createElement('a')
    link.href = url
    link.download = 'play-villa-game-night.ics'
    link.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }
  return (
    <div className="calendar-buttons">
      <button type="button" className="calendar-btn" onClick={download}>Download .ics</button>
      <a className="calendar-btn" href={google} target="_blank" rel="noopener noreferrer">Google Calendar ↗</a>
    </div>
  )
}
