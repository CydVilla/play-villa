import { useEffect, useState } from 'react'
import './CountdownTimer.css'

export default function CountdownTimer({ endTime }) {
  const [now, setNow] = useState(Date.now)
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [])
  const seconds = Math.max(0, Math.ceil((endTime * 1000 - now) / 1000))
  const units = [
    ['days', Math.floor(seconds / 86400)],
    ['hrs', Math.floor(seconds / 3600) % 24],
    ['min', Math.floor(seconds / 60) % 60],
    ['sec', seconds % 60],
  ]
  if (seconds === 0) return <p>Voting has closed.</p>
  return (
    <div className="countdown" role="timer" aria-label={`Voting closes in ${units.map(([unit, n]) => `${n} ${unit}`).join(', ')}`}>
      <span aria-hidden="true" className="countdown-caption">Voting closes in</span>
      <div aria-hidden="true" className="countdown-units">
        {units.map(([unit, value]) => (
          <span key={unit}><strong>{String(value).padStart(2, '0')}</strong><small>{unit}</small></span>
        ))}
      </div>
    </div>
  )
}
