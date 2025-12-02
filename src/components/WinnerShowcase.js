import React, { useState, useEffect, useCallback } from 'react';
import './WinnerShowcase.css';
import CalendarIntegration from './CalendarIntegration';

// Generate Amazon affiliate link for a game
const generateAmazonLink = (gameName) => {
  const storeId = process.env.REACT_APP_AMAZON_STORE_ID;
  if (!storeId) return null;
  
  // Clean game name for search
  const searchQuery = encodeURIComponent(gameName + ' video game');
  return `https://www.amazon.com/s?k=${searchQuery}&tag=${storeId}`;
};

// Get next Sunday at midnight (when voting resets)
const getNextSunday = (fromDate) => {
  const date = new Date(fromDate);
  const day = date.getDay(); // 0 = Sunday, 6 = Saturday
  const daysUntilSunday = day === 0 ? 7 : (7 - day); // Next Sunday, or 7 days if today is Sunday
  const nextSunday = new Date(date);
  nextSunday.setDate(date.getDate() + daysUntilSunday);
  nextSunday.setHours(0, 0, 0, 0);
  return nextSunday;
};

const WinnerShowcase = ({ winner, votingEndTime }) => {
  const [timeUntilReset, setTimeUntilReset] = useState({ days: 0, hours: 0, minutes: 0, seconds: 0 });

  const calculateTimeUntilReset = useCallback(() => {
    const now = new Date();
    const resetTime = getNextSunday(now);
    const difference = resetTime - now;

    if (difference <= 0) {
      return { days: 0, hours: 0, minutes: 0, seconds: 0 };
    }

    return {
      days: Math.floor(difference / (1000 * 60 * 60 * 24)),
      hours: Math.floor((difference % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60)),
      minutes: Math.floor((difference % (1000 * 60 * 60)) / (1000 * 60)),
      seconds: Math.floor((difference % (1000 * 60)) / 1000)
    };
  }, []);

  useEffect(() => {
    setTimeUntilReset(calculateTimeUntilReset());
    const timer = setInterval(() => {
      setTimeUntilReset(calculateTimeUntilReset());
    }, 1000);
    return () => clearInterval(timer);
  }, [calculateTimeUntilReset]);

  const formatTime = (value) => {
    return value.toString().padStart(2, '0');
  };

  if (!winner) {
    return (
      <div className="winner-showcase">
        <h2 className="winner-title">VOTING ENDED</h2>
        <p className="no-winner">No games were submitted for this round.</p>
      </div>
    );
  }

  // votingEndTime is already Saturday at midnight (the play date)
  const playDate = new Date(votingEndTime);
  const amazonLink = generateAmazonLink(winner.name);
  const resetTime = getNextSunday(new Date());

  return (
    <div className="winner-showcase">
      <div className="winner-announcement">
        <h2 className="winner-label">WINNER</h2>
        <h1 className="winner-name glitch-winner" data-text={winner.name}>
          {winner.name}
        </h1>
      </div>

      {winner.image && (
        <div className="winner-image-container">
          <img src={winner.image} alt={winner.name} className="winner-image" />
          <div className="image-scanner"></div>
        </div>
      )}

      <div className="winner-info">
        <div className="vote-count-display">
          <span className="vote-count-number">{winner.votes}</span>
          <span className="vote-count-text">VOTES</span>
        </div>
        <p className="play-date">
          PLAY ALL DAY SATURDAY
        </p>
        <p className="play-date-full">
          {playDate.toLocaleDateString('en-US', { 
            weekday: 'long', 
            year: 'numeric', 
            month: 'long', 
            day: 'numeric'
          })}
        </p>
      </div>

      {amazonLink && (
        <div className="amazon-link-section">
          <a
            href={amazonLink}
            target="_blank"
            rel="noopener noreferrer sponsored"
            className="amazon-button"
          >
            <span className="amazon-icon">🛒</span>
            GET {winner.name.toUpperCase()} ON AMAZON
          </a>
          <p className="affiliate-disclosure">(Affiliate link - supports Play Villa)</p>
        </div>
      )}

      <div className="reset-countdown">
        <h3 className="reset-countdown-label">NEXT VOTING STARTS IN</h3>
        <div className="reset-countdown-display">
          <div className="reset-time-unit">
            <div className="reset-time-value">{formatTime(timeUntilReset.days)}</div>
            <div className="reset-time-label">DAYS</div>
          </div>
          <div className="reset-time-separator">:</div>
          <div className="reset-time-unit">
            <div className="reset-time-value">{formatTime(timeUntilReset.hours)}</div>
            <div className="reset-time-label">HOURS</div>
          </div>
          <div className="reset-time-separator">:</div>
          <div className="reset-time-unit">
            <div className="reset-time-value">{formatTime(timeUntilReset.minutes)}</div>
            <div className="reset-time-label">MIN</div>
          </div>
          <div className="reset-time-separator">:</div>
          <div className="reset-time-unit">
            <div className="reset-time-value">{formatTime(timeUntilReset.seconds)}</div>
            <div className="reset-time-label">SEC</div>
          </div>
        </div>
        <p className="reset-date">
          Voting resets: {resetTime.toLocaleDateString('en-US', { 
            weekday: 'long', 
            month: 'long', 
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit'
          })}
        </p>
      </div>

      <div className="discord-invite">
        <h3 className="discord-title">JOIN THE COMMUNITY</h3>
        <a 
          href="https://discord.gg/Nh7RYw2zJD" 
          target="_blank"
          rel="noopener noreferrer"
          className="discord-button"
        >
          <span className="discord-icon">💬</span>
          JOIN DISCORD
        </a>
      </div>

      <CalendarIntegration gameName={winner.name} gameDate={playDate} />
    </div>
  );
};

export default WinnerShowcase;

