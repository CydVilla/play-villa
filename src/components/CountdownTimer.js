import React, { useState, useEffect } from 'react';
import './CountdownTimer.css';

const CountdownTimer = ({ endTime }) => {
  const [timeLeft, setTimeLeft] = useState(calculateTimeLeft());

  function calculateTimeLeft() {
    const now = new Date().getTime();
    const end = new Date(endTime).getTime();
    const difference = end - now;

    if (difference <= 0) {
      return { days: 0, hours: 0, minutes: 0, seconds: 0 };
    }

    return {
      days: Math.floor(difference / (1000 * 60 * 60 * 24)),
      hours: Math.floor((difference % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60)),
      minutes: Math.floor((difference % (1000 * 60 * 60)) / (1000 * 60)),
      seconds: Math.floor((difference % (1000 * 60)) / 1000)
    };
  }

  useEffect(() => {
    const timer = setInterval(() => {
      setTimeLeft(calculateTimeLeft());
    }, 1000);

    return () => clearInterval(timer);
  }, [endTime]);

  const formatTime = (value) => {
    return value.toString().padStart(2, '0');
  };

  return (
    <div className="countdown-container">
      <h3 className="countdown-label">VOTING ENDS IN</h3>
      <div className="countdown-display">
        <div className="time-unit">
          <div className="time-value">{formatTime(timeLeft.days)}</div>
          <div className="time-label">DAYS</div>
        </div>
        <div className="time-separator">:</div>
        <div className="time-unit">
          <div className="time-value">{formatTime(timeLeft.hours)}</div>
          <div className="time-label">HOURS</div>
        </div>
        <div className="time-separator">:</div>
        <div className="time-unit">
          <div className="time-value">{formatTime(timeLeft.minutes)}</div>
          <div className="time-label">MIN</div>
        </div>
        <div className="time-separator">:</div>
        <div className="time-unit">
          <div className="time-value">{formatTime(timeLeft.seconds)}</div>
          <div className="time-label">SEC</div>
        </div>
      </div>
      <div className="countdown-date">
        {new Date(endTime).toLocaleDateString('en-US', { 
          weekday: 'long', 
          year: 'numeric', 
          month: 'long', 
          day: 'numeric',
          hour: '2-digit',
          minute: '2-digit'
        })}
      </div>
    </div>
  );
};

export default CountdownTimer;

