import React from 'react';
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

const WinnerShowcase = ({ winner, votingEndTime }) => {
  if (!winner) {
    return (
      <div className="winner-showcase">
        <h2 className="winner-title">VOTING ENDED</h2>
        <p className="no-winner">No games were submitted for this round.</p>
      </div>
    );
  }

  const nextSaturday = new Date(votingEndTime);
  nextSaturday.setDate(nextSaturday.getDate() + 7); // Next Saturday
  const amazonLink = generateAmazonLink(winner.name);

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
          {nextSaturday.toLocaleDateString('en-US', { 
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

      <CalendarIntegration gameName={winner.name} gameDate={nextSaturday} />
    </div>
  );
};

export default WinnerShowcase;

